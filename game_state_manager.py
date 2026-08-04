import json
import random
import time
import os
import logging
import asyncio
import aiofiles
from typing import Any, Dict, List, Optional, Union

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment
from db import db, WORLD_SNAPSHOT_VERSION  # noqa: F401  (re-exported for callers/tests)
from tools.fa_runtime import fa_runtime
from game_definitions import GameDefinitionsManager
from entity_placement_manager import EntityPlacementManager
from privacy_logging import describe_collection, describe_text
from game_messages import msg as localized_msg
from gen_image import (
    attach_art_to_definitions,
    generate_world_art,
    is_world_art_enabled,
)

logger = logging.getLogger()

# Use random map (for testing)
USE_RANDOM_MAP = False
WORLD_TRANSLATION_CACHE_VERSION = 5


class GameStateManager:
    """Manages game state initialization, persistence, and message creation."""

    def __init__(self, seed: int, theme_desc: str, do_web_search: bool = False,
                 language: str = "en", generator_id: Optional[str] = None,
                 owner_id: Optional[str] = None, visibility: Optional[str] = None):
        self.random = random.Random(seed)
        self.error_message = None
        self.item_sequence_cnt = 0
        self.enemy_sequence_cnt = 0
        self.event_history = []
        self.language = language
        self.last_described_ct = None

        # Model definitions
        lo_model = GenAIModel(
            model_name=os.getenv("LOW_SPEC_MODEL_NAME", "gpt-4.1-mini"),
            base_url=os.getenv("LOW_SPEC_MODEL_BASE_URL"),
            api_key=os.getenv("LOW_SPEC_MODEL_API_KEY"),
        )
        hi_model = GenAIModel(
            model_name=os.getenv("HIGH_SPEC_MODEL_NAME", "gpt-4.1-mini"),
            base_url=os.getenv("HIGH_SPEC_MODEL_BASE_URL"),
            api_key=os.getenv("HIGH_SPEC_MODEL_API_KEY"),
        )

        # GenAI instance, with low and high spec models
        self.gen_ai = GenAI(lo_model=lo_model, hi_model=hi_model)

        # Initialize the definitions manager
        self.definitions = GameDefinitionsManager(self.gen_ai, language)

        # Initialize the entity placement manager
        self.entity_manager = EntityPlacementManager(self.random, self.definitions, self.gen_ai)

        self.generator_id = generator_id
        self.loaded_from_generator = False
        self.theme_desc = theme_desc
        self.theme_desc_better = None
        self.do_web_search = do_web_search
        self.owner_id = owner_id
        self.visibility = visibility

        # Raw tile summaries as returned by the model, kept so they can be
        # persisted into the world snapshot alongside the map and placements.
        self._generated_tile_info: List[dict] = []
        self._snapshot_tile_info_by_language: Dict[str, List[dict]] = {}

        # Awaited once per forge milestone when set; see report_progress.
        self.on_progress = None

    @classmethod
    async def create(cls, seed: int, theme_desc: str, do_web_search: bool = False,
                    language: str = "en", generator_id: Optional[str] = None,
                    owner_id: Optional[str] = None, visibility: Optional[str] = None,
                    on_progress=None):
        """Factory method to create and initialize a GameStateManager."""
        manager = cls(seed, theme_desc, do_web_search, language, generator_id, owner_id, visibility)
        manager.on_progress = on_progress

        if generator_id:
            generator_data = db.get_generator(generator_id)
            if not generator_data:
                raise ValueError(f"Generator with ID {generator_id} not found")
            await manager.load_generator_world(generator_id, generator_data, language)

        # Set the theme description and language
        logger.info(
            "Setting theme description (%s) with language: %s",
            describe_text(manager.theme_desc),
            language,
        )
        manager.theme_desc_better = await manager.gen_ai.set_theme_description(
            theme_desc=manager.theme_desc,
            theme_desc_better=manager.theme_desc_better,
            do_web_search=do_web_search,
            language=language
        )

        summary = "\n".join((manager.theme_desc_better or "").split("\n")[1:]).strip()
        await manager.report_progress(
            "theme",
            title=manager.gen_ai.game_title or "",
            summary=summary,
        )

        # Initialize these after setting the theme description
        if not generator_id:
            async def run_parallel_init():
                # Run all initializations concurrently
                await asyncio.gather(
                    manager.initialize_player_defs(),
                    manager.initialize_item_defs(),
                    manager.initialize_enemy_defs(),
                    manager.initialize_celltype_defs()
                )

            await run_parallel_init()

            logger.info(
                "Generated world definitions (players=%s, items=%s, enemies=%s, terrain=%s)",
                describe_collection(manager.definitions.player_defs),
                describe_collection(manager.definitions.item_defs),
                describe_collection(manager.definitions.enemy_defs),
                describe_collection(manager.definitions.celltype_defs),
            )

            # Save the generator if it was newly created
            manager.definitions.save_generator(
                theme_desc, manager.theme_desc_better,
                owner_id=manager.owner_id,
                visibility=manager.visibility or "unlisted",
            )
            manager.generator_id = db.save_generator(
                theme_desc=theme_desc,
                theme_desc_better=manager.theme_desc_better,
                language=manager.language,
                player_defs=manager.definitions.player_defs,
                item_defs=manager.definitions.item_defs,
                enemy_defs=manager.definitions.enemy_defs,
                celltype_defs=manager.definitions.celltype_defs,
                owner_id=manager.owner_id,
                visibility=manager.visibility or "unlisted",
            )
            logger.info(f"Saved generator with ID: {manager.generator_id}")

            await manager.report_progress(
                "cast",
                world_id=manager.generator_id,
                enemies=[
                    {"id": enemy.get("enemy_id"), "name": enemy.get("name")}
                    for enemy in (manager.definitions.enemy_defs or [])
                    if isinstance(enemy, dict)
                ],
                player={"id": "player", "name": (manager.definitions.player_defs or [{}])[0].get("name")},
                item_count=len(manager.definitions.item_defs or []),
                terrain_count=len(manager.definitions.celltype_defs or []),
            )

            await manager.generate_and_attach_world_art()

        return manager

    async def report_progress(self, stage: str, **fields) -> None:
        """Emit one forge milestone, never letting it break the forge.

        The reveal is decoration; a client that has disconnected or a serializer
        that chokes must not cost someone the World they are paying for.
        """
        callback = getattr(self, "on_progress", None)
        if not callback:
            return

        try:
            await callback({"stage": stage, **fields})
        except Exception as exc:
            logger.debug("Progress callback failed at stage '%s': %s", stage, exc)

    async def generate_and_attach_world_art(self) -> None:
        """Generate this World's art bundle and attach it to the definitions.

        Runs after the generator is saved because assets are stored under the
        World id. The updated definitions are written back with a targeted
        update rather than `save_generator`, whose id is a hash of the
        definitions and would therefore change once art URLs are attached.

        Any failure leaves the World fully playable on its icon fallback, so
        this never blocks a forge.
        """
        if not is_world_art_enabled() or not self.generator_id:
            return

        try:
            manifest = await self.gen_ai.gen_visual_manifest(
                self.definitions.player_defs,
                self.definitions.enemy_defs,
                self.definitions.celltype_defs,
            )
            if not manifest:
                logger.warning("No usable visual manifest; skipping art for %s", self.generator_id)
                return

            # Persist before generating. The manifest is this World's art
            # direction, and it is needed later for cover cards, remixes, and
            # any asset added after the forge, none of which could match the
            # World without it.
            db.save_generator_visual_manifest(
                generator_id=self.generator_id,
                manifest=manifest,
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            art = await generate_world_art(
                manifest,
                self.generator_id,
                on_progress=lambda fields: self.report_progress(**fields),
            )
            characters = art.get("characters") or {}
            if not characters:
                logger.warning("No art generated for %s", self.generator_id)
                return

            attach_art_to_definitions(
                art,
                self.definitions.player_defs,
                self.definitions.enemy_defs,
                self.definitions.celltype_defs,
            )
            db.update_generator_definitions(
                generator_id=self.generator_id,
                player_defs=self.definitions.player_defs,
                enemy_defs=self.definitions.enemy_defs,
                celltype_defs=self.definitions.celltype_defs,
            )

            # Re-save the manifest carrying the cover, so the gallery can find
            # a World's card without probing the filesystem.
            if art.get("cover"):
                db.save_generator_visual_manifest(
                    generator_id=self.generator_id,
                    manifest={**manifest, "cover_url": art["cover"]},
                    snapshot_version=WORLD_SNAPSHOT_VERSION,
                )

            logger.info("Attached art for %s entities in %s", len(characters), self.generator_id)
        except Exception as exc:
            logger.error("World art generation failed for %s: %s", self.generator_id, exc)

    async def load_generator_world(self, generator_id: str, generator_data: Dict, language: str):
        logger.info(f"Loaded generator with ID: {generator_id}")
        source_language = generator_data.get('language') or language
        active_data = generator_data

        if source_language != language:
            translated_data = db.get_generator_translation(
                generator_id,
                language,
                WORLD_TRANSLATION_CACHE_VERSION
            )
            if translated_data:
                logger.info(f"Loaded cached generator translation: {generator_id} ({language})")
            else:
                logger.info(f"Translating generator {generator_id} to language: {language}")
                world_definition = {
                    "theme_desc_better": generator_data['theme_desc_better'],
                    "player_defs": generator_data['player_defs'],
                    "item_defs": generator_data['item_defs'],
                    "enemy_defs": generator_data['enemy_defs'],
                    "celltype_defs": generator_data['celltype_defs'],
                }
                translated_data = await self.gen_ai.translate_world_definition(
                    world_definition=world_definition,
                    source_language=source_language,
                    target_language=language,
                )
                db.save_generator_translation(
                    generator_id=generator_id,
                    language=language,
                    theme_desc_better=translated_data['theme_desc_better'],
                    player_defs=translated_data['player_defs'],
                    item_defs=translated_data['item_defs'],
                    enemy_defs=translated_data['enemy_defs'],
                    celltype_defs=translated_data['celltype_defs'],
                    translation_version=WORLD_TRANSLATION_CACHE_VERSION,
                )

            active_data = {
                **generator_data,
                **translated_data,
                "language": language,
            }

        self.definitions.load_from_generator_data(generator_id, active_data)
        self.theme_desc = generator_data['theme_desc']
        self.theme_desc_better = active_data['theme_desc_better']
        self.language = language
        self.generator_id = generator_id
        self.loaded_from_generator = True

    def get_game_title(self):
        """Get the game title from the AI generator."""
        return self.gen_ai.game_title

    def msg(self, key: str, **params) -> str:
        return localized_msg(getattr(self, "language", "en"), key, **params)

    async def make_defs_from_json(self, filename: str, transform_fn=None):
        """Load and transform JSON definitions from file."""
        try:
            async with aiofiles.open(filename, 'r') as f:
                data = await f.read()
                if transform_fn:
                    return await transform_fn(data)
                else:
                    return json.loads(data)
        except FileNotFoundError:
            self.log_error(f"{filename} file not found.")
            return {} if transform_fn else []
        except json.JSONDecodeError:
            self.log_error(f"Invalid JSON in {filename} file.")
            return {} if transform_fn else []

    async def initialize_player_defs(self):
        """Initialize player definitions from JSON sample."""
        result = await self.make_defs_from_json(
            'game_players.json',
            transform_fn=self.gen_ai.gen_players_from_json_sample
        )
        self.definitions.player_defs = result["player_defs"]

    async def initialize_item_defs(self):
        """Initialize item definitions from JSON sample."""
        result = await self.make_defs_from_json(
            'game_items.json',
            transform_fn=self.gen_ai.gen_game_items_from_json_sample
        )
        self.definitions.item_defs = result["item_defs"]

    async def initialize_enemy_defs(self):
        """Initialize enemy definitions from JSON sample."""
        result = await self.make_defs_from_json(
            'game_enemies.json',
            transform_fn=self.gen_ai.gen_game_enemies_from_json_sample
        )
        self.definitions.enemy_defs = result["enemy_defs"]

    async def initialize_celltype_defs(self):
        """Initialize cell type definitions from JSON sample."""
        result = await self.make_defs_from_json(
            'game_celltypes.json',
            transform_fn=self.gen_ai.gen_game_celltypes_from_json_sample
        )
        self.definitions.celltype_defs = result["celltype_defs"]

    def make_random_map(self):
        """Generate a playable map from either list- or mapping-based definitions."""
        raw_defs = self.definitions.celltype_defs
        cell_types = []

        if isinstance(raw_defs, dict):
            for cell_id, cell_def in raw_defs.items():
                if not isinstance(cell_def, dict):
                    continue
                normalized = dict(cell_def)
                normalized.setdefault('id', str(cell_id))
                cell_types.append(normalized)
        elif isinstance(raw_defs, list):
            cell_types = [dict(cell_def) for cell_def in raw_defs if isinstance(cell_def, dict)]

        if not cell_types:
            cell_types = [
                {
                    'id': 'open-ground',
                    'name': 'Open Ground',
                    'description': 'A quiet stretch of open ground.',
                    'map_color': '#49614f',
                    'font_awesome_icon': 'fa-solid fa-location-dot',
                },
                {
                    'id': 'woodland',
                    'name': 'Woodland',
                    'description': 'Dense cover closes in around the path.',
                    'map_color': '#355a47',
                    'font_awesome_icon': 'fa-solid fa-tree',
                },
                {
                    'id': 'high-ground',
                    'name': 'High Ground',
                    'description': 'Broken stone rises above the surrounding area.',
                    'map_color': '#665846',
                    'font_awesome_icon': 'fa-solid fa-mountain',
                },
                {
                    'id': 'water',
                    'name': 'Water',
                    'description': 'Dark water cuts across the route.',
                    'map_color': '#31566d',
                    'font_awesome_icon': 'fa-solid fa-water',
                },
            ]

        return [[self.random.choice(cell_types)
                for _ in range(self.state.map_width)]
               for _ in range(self.state.map_height)]

    def make_fallback_placements(self):
        """Place saved-world entities deterministically when model placement is unavailable."""
        return self.ensure_entity_placement_density([])

    def ensure_entity_placement_density(self, placements: List[dict]) -> List[dict]:
        """Fill sparse model output so a run has a reliable gameplay rhythm."""
        start_x, start_y = self.state.player_pos
        candidates = sorted(
            (
                (abs(x - start_x) + abs(y - start_y), y, x)
                for y in range(self.state.map_height)
                for x in range(self.state.map_width)
                if (x, y) != (start_x, start_y)
            )
        )
        normalized = [dict(placement) for placement in placements if isinstance(placement, dict)]
        occupied = {
            (placement.get('x'), placement.get('y'))
            for placement in normalized
            if isinstance(placement.get('x'), int)
            and isinstance(placement.get('y'), int)
            and 0 <= placement['x'] < self.state.map_width
            and 0 <= placement['y'] < self.state.map_height
        }

        def reserve_position(avoid_start_zone=False, target_distance=None):
            eligible = []
            for distance, y, x in candidates:
                if (x, y) in occupied:
                    continue
                if avoid_start_zone and abs(x - start_x) <= 1 and abs(y - start_y) <= 1:
                    continue
                distance_error = abs(distance - target_distance) if target_distance is not None else 0
                eligible.append((distance_error, distance, y, x))
            if not eligible:
                return None
            _, _, y, x = min(eligible)
            occupied.add((x, y))
            return x, y

        max_distance = max(1, (self.state.map_width - 1) + (self.state.map_height - 1))

        def paced_distance(index, target_count, minimum):
            if target_count <= 1:
                return minimum
            return round(minimum + index * (max_distance - minimum) / (target_count - 1))

        raw_enemy_defs = getattr(self.definitions, "enemy_defs", [])
        enemy_defs = raw_enemy_defs if isinstance(raw_enemy_defs, list) else []
        enemy_ids = [
            enemy_def['enemy_id']
            for enemy_def in enemy_defs
            if isinstance(enemy_def, dict) and enemy_def.get('enemy_id')
        ]
        raw_item_defs = getattr(self.definitions, "item_defs", [])
        item_defs = raw_item_defs if isinstance(raw_item_defs, list) else []
        item_ids = [
            item_def['id']
            for item_def in item_defs
            if isinstance(item_def, dict) and item_def.get('id')
        ]

        area = self.state.map_width * self.state.map_height
        enemy_target = min(8, max(len(enemy_ids), area // 12)) if enemy_ids else 0
        item_target = min(6, max(len(item_ids), area // 16)) if item_ids else 0

        valid_enemy_count = sum(
            1
            for placement in normalized
            if placement.get('type') == 'enemy'
            and placement.get('entity_id') in enemy_ids
            and isinstance(placement.get('x'), int)
            and isinstance(placement.get('y'), int)
        )
        for index in range(valid_enemy_count, enemy_target):
            position = reserve_position(
                avoid_start_zone=True,
                target_distance=paced_distance(index, enemy_target, 2),
            )
            if position is None:
                break
            normalized.append({
                'type': 'enemy',
                'entity_id': enemy_ids[index % len(enemy_ids)],
                'x': position[0],
                'y': position[1],
            })

        valid_item_count = sum(
            1
            for placement in normalized
            if placement.get('type') == 'item'
            and placement.get('entity_id') in item_ids
            and isinstance(placement.get('x'), int)
            and isinstance(placement.get('y'), int)
        )
        for index in range(valid_item_count, item_target):
            position = reserve_position(
                target_distance=paced_distance(index, item_target, 1),
            )
            if position is None:
                break
            normalized.append({
                'type': 'item',
                'entity_id': item_ids[index % len(item_ids)],
                'x': position[0],
                'y': position[1],
            })

        return normalized

    async def initialize_game_placements(self, snapshot_placements: Optional[List[dict]] = None):
        """Generate entity placements (both enemies and items).

        Snapshot placements are used verbatim: they were already densified and
        sanitized when the world was first built, and re-running that here would
        drift the layout away from what the snapshot recorded.
        """
        if snapshot_placements:
            self.entity_placements = list(snapshot_placements)
            self.entity_manager.entity_placements = list(self.entity_placements)
            return

        try:
            self.entity_placements = await self.entity_manager.generate_placements(
                self.state.cell_types,
                self.state.map_width,
                self.state.map_height
            )
        except Exception as exc:
            logger.error("Failed to generate entity placements: %s", exc)
            self.entity_placements = []

        if not self.entity_placements:
            logger.warning("Using deterministic fallback entity placements")
            self.entity_placements = self.make_fallback_placements()
        else:
            self.entity_placements = self.ensure_entity_placement_density(self.entity_placements)

        # Keep the placement processor in sync when the fallback path supplied
        # the list instead of the model-backed generator.
        self.entity_manager.entity_placements = list(self.entity_placements)

    def initialize_story_placements(self) -> None:
        """Place reusable, structured story opportunities across the map."""
        available_terrain_ids = {
            self._cell_id(cell)
            for row in self.state.cell_types
            for cell in row
        }
        templates = [
            template
            for template in self._story_templates()
            if template.get("terrain_id") in available_terrain_ids
        ][:6]
        if not templates:
            templates = [
                template
                for template in self._fallback_story_templates()
                if template.get("terrain_id") in available_terrain_ids
            ][:6]
        occupied = {
            (placement.get('x'), placement.get('y'))
            for placement in self.entity_placements
            if isinstance(placement, dict)
        }
        start_x, start_y = self.state.player_pos
        story_placements = []
        remaining_templates = list(templates)

        for index in range(len(templates)):
            target_distance = 1 + (index * 2)
            candidates = []

            for template_index, template in enumerate(remaining_templates):
                terrain_id = template.get("terrain_id")
                for y in range(self.state.map_height):
                    for x in range(self.state.map_width):
                        if (x, y) == (start_x, start_y) or (x, y) in occupied:
                            continue
                        if self._cell_id(self.state.cell_types[y][x]) != terrain_id:
                            continue
                        distance = abs(x - start_x) + abs(y - start_y)
                        candidates.append((
                            abs(distance - target_distance),
                            distance,
                            template_index,
                            y,
                            x,
                        ))

            if not candidates:
                break

            _, _, template_index, y, x = min(candidates)
            template = remaining_templates.pop(template_index)

            occupied.add((x, y))
            story = dict(template)
            story.update({
                "type": "story",
                "instance_id": f"{template['id']}:{x}:{y}",
                "x": x,
                "y": y,
                "status": "available",
            })
            story_placements.append(story)

        self.state.story_placements = story_placements
        self.state.current_story = None
        self.state.resolved_story_ids = []

    def _story_templates(self) -> List[Dict[str, Any]]:
        templates = []
        for terrain_index, cell_def in enumerate(self._celltype_definition_list()):
            terrain_id = self._cell_id(cell_def) or f"terrain-{terrain_index}"
            raw_encounters = cell_def.get("encounters", []) if isinstance(cell_def, dict) else []
            if not isinstance(raw_encounters, list):
                continue
            for encounter_index, raw_encounter in enumerate(raw_encounters):
                normalized = self._normalize_story_template(
                    raw_encounter,
                    terrain_id,
                    encounter_index,
                )
                if normalized:
                    templates.append(normalized)

        if templates:
            return templates
        return self._fallback_story_templates()

    def _normalize_story_template(
            self,
            raw_encounter: Any,
            terrain_id: str,
            encounter_index: int,
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(raw_encounter, dict):
            return None

        encounter_id = raw_encounter.get("id")
        title = raw_encounter.get("title")
        description = raw_encounter.get("description")
        choices = raw_encounter.get("choices")
        if not isinstance(encounter_id, str) or not encounter_id.strip():
            encounter_id = f"{terrain_id}-story-{encounter_index}"
        if not isinstance(title, str) or not title.strip():
            return None
        if not isinstance(description, str) or not description.strip():
            return None
        if not isinstance(choices, list):
            return None

        normalized_choices = []
        for choice_index, raw_choice in enumerate(choices[:3]):
            if not isinstance(raw_choice, dict):
                continue
            choice_id = raw_choice.get("id")
            label = raw_choice.get("label")
            result = raw_choice.get("result")
            if not isinstance(choice_id, str) or not choice_id.strip():
                choice_id = f"choice-{choice_index}"
            if not isinstance(label, str) or not label.strip():
                continue
            if not isinstance(result, str) or not result.strip():
                continue
            normalized_choices.append({
                "id": choice_id,
                "label": label,
                "result": result,
                "effect": self._normalize_story_effect(raw_choice.get("effect")),
            })

        if len(normalized_choices) < 2:
            return None

        icon = raw_encounter.get("font_awesome_icon")
        if not isinstance(icon, str) or not icon.strip():
            icon = "fa-solid fa-diamond"

        resolved_description = raw_encounter.get("resolved_description")
        if not isinstance(resolved_description, str):
            resolved_description = ""

        return {
            "id": encounter_id,
            "terrain_id": terrain_id,
            "title": title,
            "description": description,
            "resolved_description": resolved_description,
            "font_awesome_icon": icon,
            "choices": normalized_choices,
        }

    def _normalize_story_effect(self, raw_effect: Any) -> Dict[str, Any]:
        if not isinstance(raw_effect, dict):
            return {}

        effect = {}
        health = raw_effect.get("health")
        if isinstance(health, int) and not isinstance(health, bool):
            effect["health"] = max(-50, min(50, health))

        xp = raw_effect.get("xp")
        if isinstance(xp, int) and not isinstance(xp, bool):
            effect["xp"] = max(0, min(100, xp))

        item_ids = {
            item.get("id")
            for item in getattr(self.definitions, "item_defs", [])
            if isinstance(item, dict)
        }
        item_id = raw_effect.get("item_id")
        if isinstance(item_id, str) and item_id in item_ids:
            effect["item_id"] = item_id

        enemy_ids = {
            enemy.get("enemy_id")
            for enemy in getattr(self.definitions, "enemy_defs", [])
            if isinstance(enemy, dict)
        }
        combat_enemy_id = raw_effect.get("combat_enemy_id")
        if isinstance(combat_enemy_id, str) and combat_enemy_id in enemy_ids:
            effect["combat_enemy_id"] = combat_enemy_id

        return effect

    def _fallback_story_templates(self) -> List[Dict[str, Any]]:
        templates = []
        cell_defs = self._celltype_definition_list()
        if not cell_defs:
            seen_ids = set()
            for row in getattr(self.state, "cell_types", []):
                for cell in row:
                    if not isinstance(cell, dict):
                        continue
                    terrain_id = self._cell_id(cell)
                    if not terrain_id or terrain_id in seen_ids:
                        continue
                    seen_ids.add(terrain_id)
                    cell_defs.append(dict(cell))

        for index, cell_def in enumerate(cell_defs[:6]):
            terrain_id = self._cell_id(cell_def) or f"terrain-{index}"
            terrain_name = self._cell_name(cell_def)
            terrain_description = self._cell_description(cell_def)
            templates.append({
                "id": f"fallback-story-{terrain_id}",
                "terrain_id": terrain_id,
                "title": self.msg("story.fallback_title", terrain=terrain_name),
                "description": self.msg(
                    "story.fallback_description",
                    description=terrain_description,
                ),
                "resolved_description": self.msg("story.fallback_resolved"),
                "font_awesome_icon": "fa-solid fa-magnifying-glass",
                "choices": [
                    {
                        "id": "investigate",
                        "label": self.msg("story.fallback_investigate"),
                        "result": self.msg("story.fallback_investigate_result"),
                        "effect": {"xp": 4},
                    },
                    {
                        "id": "take_risk",
                        "label": self.msg("story.fallback_risk"),
                        "result": self.msg("story.fallback_risk_result"),
                        "effect": {"health": -5, "xp": 9},
                    },
                ],
            })
        return templates

    def _celltype_definition_list(self) -> List[Dict[str, Any]]:
        raw_defs = getattr(self.definitions, "celltype_defs", [])
        if isinstance(raw_defs, list):
            return [cell for cell in raw_defs if isinstance(cell, dict)]
        if isinstance(raw_defs, dict):
            normalized = []
            for cell_id, cell in raw_defs.items():
                if not isinstance(cell, dict):
                    continue
                cell_copy = dict(cell)
                cell_copy.setdefault("id", str(cell_id))
                normalized.append(cell_copy)
            return normalized
        return []

    def _cell_id(self, cell: Any) -> str:
        if isinstance(cell, dict):
            value = cell.get("id")
            return str(value) if value is not None else ""
        return str(cell) if cell is not None else ""

    def initialize_objective(self) -> None:
        player = self.state.player if isinstance(self.state.player, dict) else {}
        custom_objective = player.get("objective") if isinstance(player.get("objective"), dict) else {}
        custom_title = custom_objective.get("title")
        custom_description = custom_objective.get("description")
        if not isinstance(custom_title, str) or not custom_title.strip():
            custom_title = ""
        if not isinstance(custom_description, str) or not custom_description.strip():
            custom_description = ""
        enemy_target = sum(
            1
            for placement in self.entity_placements
            if placement.get("type") == "enemy"
        )

        if enemy_target:
            kind = "enemies"
            target = enemy_target
            default_title = self.msg("objective.default_title")
            default_description = self.msg("objective.default_description")
        else:
            kind = "stories"
            target = len(self.state.story_placements)
            default_title = self.msg("objective.story_title")
            default_description = self.msg("objective.story_description")

        self.state.objective = {
            "kind": kind,
            "title": custom_title or default_title,
            "description": custom_description or default_description,
            "current": 0,
            "target": target,
            "completed": False,
        }
        self.update_objective_progress()

    def update_objective_progress(self) -> None:
        objective = getattr(self.state, "objective", {})
        if not isinstance(objective, dict) or not objective:
            return

        if objective.get("kind") == "enemies":
            enemy_positions = {
                (placement.get("x"), placement.get("y"))
                for placement in self.entity_placements
                if placement.get("type") == "enemy"
            }
            defeated_positions = {
                (enemy.get("x"), enemy.get("y"))
                for enemy in self.state.defeated_enemies
            }
            current = len(enemy_positions & defeated_positions)
        else:
            current = len(self.state.resolved_story_ids)

        target = objective.get("target", 0)
        objective["current"] = min(current, target) if isinstance(target, int) else current
        objective["completed"] = bool(target and current >= target)
        if objective.get("kind") == "stories" and objective["completed"]:
            self.state.game_won = True

    def _opening_line(self) -> str:
        """The line shown when a run starts, in the World's own voice.

        `theme_desc_better` is title on the first line and summary after it. The
        summary is already generated, already translated with the rest of the
        world, and already reviewed as `generated_title_and_summary`, so reusing
        it costs nothing and adds no moderation surface.
        """
        summary = "\n".join(
            (getattr(self, "theme_desc_better", None) or "").split("\n")[1:]
        ).strip()
        return summary or self.msg("run.started")

    def _map_csv_from_cell_types(self) -> str:
        """Serialize the map as cell-type ids, which stay language-independent."""
        return "\n".join(
            ",".join(self._cell_id(cell) for cell in row)
            for row in self.state.cell_types
        )

    def _cell_types_from_map_csv(self, map_csv: Optional[str]) -> Optional[List[List[dict]]]:
        """Rehydrate a map from cell-type ids against the active definitions.

        Returns None when the snapshot no longer matches the current
        definitions or map dimensions, so the caller falls back to generation.
        """
        celltype_defs = getattr(self.definitions, "celltype_defs", None) or []
        by_id = {
            str(ct.get("id")): ct
            for ct in celltype_defs
            if isinstance(ct, dict) and ct.get("id") is not None
        }
        if not by_id:
            return None

        rows = [row.strip() for row in (map_csv or "").split("\n") if row.strip()]
        if len(rows) != self.state.map_height:
            logger.warning(
                "Snapshot map height %s does not match %s; regenerating",
                len(rows), self.state.map_height
            )
            return None

        out_map = []
        for row in rows:
            cell_ids = [cell.strip() for cell in row.split(",")]
            if len(cell_ids) != self.state.map_width:
                logger.warning(
                    "Snapshot map width %s does not match %s; regenerating",
                    len(cell_ids), self.state.map_width
                )
                return None
            rehydrated = [by_id.get(cell_id) for cell_id in cell_ids]
            if any(cell is None for cell in rehydrated):
                logger.warning("Snapshot map references unknown cell types; regenerating")
                return None
            out_map.append(rehydrated)

        return out_map

    def _load_world_snapshot(self) -> Optional[Dict[str, Any]]:
        """Load the persisted playable snapshot for this world, when usable."""
        generator_id = getattr(self, "generator_id", None)
        if not generator_id:
            return None

        try:
            snapshot = db.get_generator_world(generator_id, WORLD_SNAPSHOT_VERSION)
        except Exception as exc:
            logger.error("Failed to load world snapshot: %s", exc)
            return None

        if not snapshot:
            return None

        cell_types = self._cell_types_from_map_csv(snapshot.get("map_csv"))
        if cell_types is None:
            return None

        tile_info_by_language = snapshot.get("tile_info_by_language") or {}
        self._snapshot_tile_info_by_language = dict(tile_info_by_language)

        return {
            "cell_types": cell_types,
            "entity_placements": snapshot.get("entity_placements") or [],
            "tile_info": tile_info_by_language.get(getattr(self, "language", "en")) or [],
        }

    def _save_world_snapshot(self) -> None:
        """Persist the playable snapshot so replays skip map/placement generation."""
        generator_id = getattr(self, "generator_id", None)
        if not generator_id or not self.state or not self.state.cell_types:
            return

        language = getattr(self, "language", "en")
        tile_info_by_language = dict(getattr(self, "_snapshot_tile_info_by_language", {}))
        generated_tile_info = getattr(self, "_generated_tile_info", None)
        if generated_tile_info:
            tile_info_by_language[language] = generated_tile_info

        try:
            db.save_generator_world(
                generator_id=generator_id,
                language=language,
                map_csv=self._map_csv_from_cell_types(),
                entity_placements=getattr(self, "entity_placements", []) or [],
                tile_info_by_language=tile_info_by_language,
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )
            self._snapshot_tile_info_by_language = tile_info_by_language
        except Exception as exc:
            logger.error("Failed to save world snapshot: %s", exc)

    async def initialize_tile_info(self, snapshot_tiles: Optional[List[dict]] = None):
        """Prebuild fast tile summaries so movement never waits on narration."""
        generated_tiles = list(snapshot_tiles or [])
        generator = getattr(self.gen_ai, "gen_tile_quick_info", None)

        if not generated_tiles and callable(generator):
            try:
                generated_tiles = await generator(
                    self.state.cell_types,
                    self.entity_placements,
                    getattr(self.definitions, "enemy_defs", []),
                    getattr(self.definitions, "item_defs", []),
                    self.state.map_width,
                    self.state.map_height
                )
            except Exception as e:
                logger.error(f"Failed to generate tile quick info: {str(e)}")

        self._generated_tile_info = generated_tiles
        self.state.tile_info = self._normalize_tile_info(generated_tiles)

    def _normalize_tile_info(self, generated_tiles: List[dict]) -> List[List[Dict[str, Any]]]:
        generated_by_pos = {}
        for tile in generated_tiles or []:
            if not isinstance(tile, dict):
                continue
            x = tile.get("x")
            y = tile.get("y")
            if isinstance(x, int) and isinstance(y, int):
                generated_by_pos[(x, y)] = tile

        return [
            [
                self._compose_tile_info(x, y, generated_by_pos.get((x, y), {}))
                for x in range(self.state.map_width)
            ]
            for y in range(self.state.map_height)
        ]

    def _compose_tile_info(self, x: int, y: int, generated: Dict[str, Any]) -> Dict[str, Any]:
        cell = self.state.cell_types[y][x]
        placement = self._placement_at(x, y)
        label = self._clean_generated_text(generated.get("label"), self._cell_name(cell))
        quick_desc = self._clean_generated_text(generated.get("quick_desc"), "")
        inspect_desc = self._clean_generated_text(generated.get("inspect_desc"), "")

        info = {
            "x": x,
            "y": y,
            "label": label,
            "quick_desc": quick_desc or self._fallback_quick_desc(cell, placement),
            "inspect_desc": inspect_desc or self._fallback_inspect_desc(cell, placement),
            "terrain_name": self._cell_name(cell),
            "terrain_icon": self._cell_icon(cell),
            "danger_level": "safe",
            "hint": self.msg("tile.clear"),
            "entity_type": "",
            "entity_name": "",
            "entity_icon": "",
            "entity_status": "",
            "tags": [],
        }

        if not placement:
            return info

        entity_id = placement.get("entity_id")
        if placement.get("type") == "enemy":
            enemy_def = self._enemy_def(entity_id)
            entity_name = enemy_def.get("name", entity_id or "Enemy")
            info.update({
                "danger_level": self._danger_level_for_enemy(enemy_def),
                "hint": self.msg("tile.hostile", entity=entity_name),
                "entity_type": "enemy",
                "entity_name": entity_name,
                "entity_icon": enemy_def.get("font_awesome_icon", ""),
                "entity_status": "active",
                "tags": ["enemy"],
            })
        elif placement.get("type") == "item":
            item_def = self._item_def(entity_id)
            entity_name = item_def.get("name", entity_id or "Item")
            info.update({
                "danger_level": "reward",
                "hint": self.msg("tile.reward", entity=entity_name),
                "entity_type": "item",
                "entity_name": entity_name,
                "entity_icon": fa_runtime.get_valid_icon(
                    item_def.get("font_awesome_icon", "fa-solid fa-box"),
                    "item"
                ) or "fa-solid fa-box",
                "entity_status": "available",
                "tags": ["item"],
            })
        elif placement.get("type") == "story":
            entity_name = placement.get("title") or self.msg("story.opportunity")
            info.update({
                "quick_desc": placement.get("description") or info["quick_desc"],
                "inspect_desc": placement.get("description") or info["inspect_desc"],
                "danger_level": "story",
                "hint": self.msg("story.opportunity_title", title=entity_name),
                "entity_type": "story",
                "entity_name": entity_name,
                "entity_icon": placement.get("font_awesome_icon", "fa-solid fa-diamond"),
                "entity_status": placement.get("status", "available"),
                "tags": ["story"],
            })

        return info

    def _clean_generated_text(self, value: Any, fallback: str) -> str:
        if not isinstance(value, str):
            return fallback
        cleaned = " ".join(value.split()).strip()
        return cleaned or fallback

    def _cell_name(self, cell: Any) -> str:
        if isinstance(cell, dict):
            return cell.get("name", "Unknown")
        if isinstance(cell, str):
            return cell
        return "Unknown"

    def _cell_description(self, cell: Any) -> str:
        if isinstance(cell, dict):
            return cell.get("description") or self._cell_name(cell)
        return self._cell_name(cell)

    def _cell_icon(self, cell: Any) -> str:
        if isinstance(cell, dict):
            return cell.get("font_awesome_icon", "")
        return ""

    def _fallback_quick_desc(self, cell: Any, placement: Optional[dict]) -> str:
        name = self._cell_name(cell)
        if placement and placement.get("type") == "enemy":
            return self.msg("tile.hostile_presence", terrain=name)
        if placement and placement.get("type") == "item":
            item = self._item_def(placement.get("entity_id"))
            return self.msg(
                "tile.item_nearby",
                terrain=name,
                item=item.get('name', self.msg("tile.useful_item")),
            )
        if placement and placement.get("type") == "story":
            return placement.get("description") or self.msg("story.opportunity")
        return self.msg("tile.clear_quick", terrain=name)

    def _fallback_inspect_desc(self, cell: Any, placement: Optional[dict]) -> str:
        description = self._cell_description(cell) or self._fallback_quick_desc(cell, placement)
        if placement and placement.get("type") == "enemy":
            enemy = self._enemy_def(placement.get("entity_id"))
            return self.msg(
                "tile.enemy_controls",
                description=description,
                enemy=enemy.get('name', self.msg("tile.an_enemy")),
            )
        if placement and placement.get("type") == "item":
            item = self._item_def(placement.get("entity_id"))
            return self.msg(
                "tile.item_recoverable",
                description=description,
                item=item.get('name', self.msg("tile.an_item")),
            )
        if placement and placement.get("type") == "story":
            return placement.get("description") or description
        return description

    def _placement_at(self, x: int, y: int) -> Optional[dict]:
        entity_placement = next(
            (
                placement
                for placement in getattr(self, "entity_placements", [])
                if placement.get("x") == x and placement.get("y") == y
            ),
            None
        )
        if entity_placement:
            return entity_placement
        return next(
            (
                placement
                for placement in getattr(self.state, "story_placements", [])
                if placement.get("x") == x and placement.get("y") == y
            ),
            None,
        )

    def _enemy_def(self, enemy_id: Optional[str]) -> Dict[str, Any]:
        return next(
            (
                enemy
                for enemy in getattr(self.definitions, "enemy_defs", [])
                if enemy.get("enemy_id") == enemy_id
            ),
            {}
        )

    def _item_def(self, item_id: Optional[str]) -> Dict[str, Any]:
        return next(
            (
                item
                for item in getattr(self.definitions, "item_defs", [])
                if item.get("id") == item_id
            ),
            {}
        )

    def _danger_level_for_enemy(self, enemy_def: Dict[str, Any]) -> str:
        attack_max = enemy_def.get("attack", {}).get("max", 0)
        hp_max = enemy_def.get("hp", {}).get("max", 0)
        if attack_max >= self.state.player_max_hp * 0.25 or hp_max >= self.state.player_attack * 5:
            return "deadly"
        if attack_max >= self.state.player_max_hp * 0.12 or hp_max >= self.state.player_attack * 3:
            return "risky"
        return "guarded"

    def get_tile_info(self, x: int, y: int) -> Optional[Dict[str, Any]]:
        if not self.state or not self.state.tile_info:
            return None
        if y < 0 or y >= len(self.state.tile_info):
            return None
        if x < 0 or x >= len(self.state.tile_info[y]):
            return None
        return self.state.tile_info[y][x]

    def get_current_tile_info(self) -> Optional[Dict[str, Any]]:
        x, y = self.state.player_pos
        return self.get_tile_info(x, y)

    def format_tile_message(self, tile_info: Optional[Dict[str, Any]]) -> str:
        if not tile_info:
            return ""

        label = tile_info.get("label") or tile_info.get("terrain_name") or self.msg("tile.area")
        quick_desc = tile_info.get("quick_desc") or ""
        hint = tile_info.get("hint") or ""
        clear_hint = self.msg("tile.clear")

        parts = [label]
        if (
            quick_desc
            and quick_desc != label
            and not quick_desc.startswith(label)
        ):
            parts.append(quick_desc)
        if hint and hint != clear_hint and hint not in quick_desc:
            parts.append(hint)
        return " ".join(parts)

    async def initialize_game(self):
        """Initialize the game state and return initial message."""
        # Read config.json using async file operations
        try:
            async with aiofiles.open('game_config.json', 'r') as f:
                content = await f.read()
                config = json.loads(content)
        except FileNotFoundError:
            self.log_error("game_config.json file not found.")
            config = {}
        except json.JSONDecodeError:
            self.log_error("Invalid JSON in game_config.json file.")
            config = {}

        map_config = config.get('map_size', {}) if isinstance(config.get('map_size'), dict) else {}
        player_config = config.get('player', {}) if isinstance(config.get('player'), dict) else {}
        map_width = config.get('map_width', map_config.get('width', 10))
        map_height = config.get('map_height', map_config.get('height', 10))
        player_start_x = config.get('player_start_x', 0)
        player_start_y = config.get('player_start_y', 0)

        # Initialize game state. Support both the legacy flat config and the
        # current grouped map/player sections.
        self.state = GameState(
            player_pos=(player_start_x, player_start_y),
            player_pos_prev=(player_start_x, player_start_y),
            player_hp=config.get('player_hp', player_config.get('base_hp', 100)),
            player_max_hp=config.get('player_max_hp', player_config.get('max_hp', 100)),
            player_attack=config.get('player_attack', player_config.get('base_attack', 10)),
            player_defense=config.get('player_defense', player_config.get('base_defense', 5)),
            map_width=map_width,
            map_height=map_height,
            cell_types=[],  # Initialize empty, will be set below
            explored=[[False for _ in range(map_width)]
                     for _ in range(map_height)],
            inventory=[],
            equipment=Equipment(),
            in_combat=False,
            current_enemy=None,
            enemies=[],
            defeated_enemies=[],
            story_placements=[],
            current_story=None,
            resolved_story_ids=[],
            objective={},
            combat_source="",
            game_over=False,
            game_won=False,
            temporary_effects={},
            game_title=self.gen_ai.game_title or "Unknown Game",  # Set the AI-generated title
            player=self.definitions.player_defs[0] if hasattr(self.definitions, 'player_defs') and self.definitions.player_defs else {}
        )

        # Reuse the persisted playable snapshot when this world already has one,
        # so replays skip map, placement, and tile-info generation entirely.
        snapshot = self._load_world_snapshot()
        if snapshot:
            logger.info("Reusing persisted world snapshot for generator %s", self.generator_id)
        else:
            # Without a snapshot this is several model calls, and the client
            # would otherwise sit on "Game ready!" for a minute or more.
            await self.report_progress("building")

        # Initialize cell types after state is created
        if USE_RANDOM_MAP:
            self.state.cell_types = self.make_random_map()
        elif snapshot:
            self.state.cell_types = snapshot["cell_types"]
        else:
            config_cell_types = config.get('cell_types', [])
            if config_cell_types and len(config_cell_types) == self.state.map_height:
                # Validate that each row has the correct width
                valid_map = True
                for row in config_cell_types:
                    if len(row) != self.state.map_width:
                        valid_map = False
                        break

                if valid_map:
                    self.state.cell_types = config_cell_types
                else:
                    logger.warning("Invalid cell_types in config, generating random map")
                    self.state.cell_types = self.make_random_map()
            else:
                # Generate AI map or fallback to random
                try:
                    if self.definitions.celltype_defs:
                        self.state.cell_types = await self.gen_ai.gen_game_map_from_celltypes(
                            self.definitions.celltype_defs,
                            self.state.map_width,
                            self.state.map_height
                        )
                    else:
                        logger.warning("No celltype definitions available, using random map")
                        self.state.cell_types = self.make_random_map()
                except Exception as e:
                    logger.error(f"Failed to generate AI map: {str(e)}. Falling back to random map.")
                    self.state.cell_types = self.make_random_map()

        # Generate entity placements
        await self.initialize_game_placements(snapshot["entity_placements"] if snapshot else None)

        # Process the entity placements to populate enemies and items
        self.entity_placements = self.entity_manager.process_placements(self.state)

        # Add paced, choice-driven opportunities independently of combat/item
        # placement so sparse maps still offer meaningful decisions.
        self.initialize_story_placements()
        self.initialize_objective()

        if not snapshot:
            await self.report_progress("populating")

        # Prebuild fast, tappable tile summaries after placements are sanitized.
        await self.initialize_tile_info(snapshot["tile_info"] if snapshot else None)

        # Persist the snapshot whenever this run produced anything new, so the
        # next run of this world reuses it instead of calling the model again.
        self._save_world_snapshot()

        # Set initial position as explored
        x, y = self.state.player_pos
        self.state.explored[y][x] = True

        # Pass the opening line as both raw and description so the websocket
        # handler does not send it through gen_adapt_sentence. This was the last
        # model call left in a run.
        opening = self._opening_line()
        return await self.create_message(opening, opening)

    def events_reset(self):
        """Reset the event history."""
        self.event_history = []

    def events_add(self, action: str, event_dict: dict):
        """Add an event to the history."""
        event_dict['action'] = action
        event_dict['timestamp'] = time.time()
        self.event_history.append(event_dict)

    async def create_message(self, description_raw: str, description: str = ""):
        """Create a message with game state."""
        # Check if state is initialized
        if not hasattr(self, 'state') or self.state is None:
            return {
                'type': 'error',
                'message': description_raw,
                'description': description
            }

        return {
            'type': 'update',
            'state': self.state.model_dump(),
            'description_raw': description_raw,
            'description': description
        }

    async def create_message_room(self):
        """Create a message with room description."""
        tile_message = self.format_tile_message(self.get_current_tile_info())
        if tile_message:
            return await self.create_message(tile_message, tile_message)

        room_description = await self._gen_room_description()
        return await self.create_message(room_description, room_description)

    async def create_message_description(self, message):
        """Create or enhance message description using AI."""
        if not message.get('description') or message.get('description') == "":
            if message.get('description_raw'):
                adapted_description = await self._gen_adapt_sentence(message['description_raw'])
                message['description'] = adapted_description
            else:
                message['description'] = ""
        return message

    async def _gen_adapt_sentence(self, original_sentence: str) -> str:
        """Generate an adapted sentence using AI."""
        try:
            return await self.gen_ai.gen_adapt_sentence(self.state, self.event_history, original_sentence)
        except Exception as e:
            self.log_error(f"Exception in _gen_adapt_sentence: {str(e)}")
            return original_sentence

    async def _gen_room_description(self) -> str:
        """Generate a room description using AI."""
        try:
            return await self.gen_ai.gen_room_description(self.state, self.event_history)
        except Exception as e:
            self.log_error(f"Exception in _gen_room_description: {str(e)}")
            return "Error generating room description!"

    def log_error(self, error_message):
        """Log an error message."""
        logger.error(error_message)
        self.error_message = error_message

    def count_explored_tiles(self) -> int:
        """Count the number of explored tiles."""
        return sum(sum(1 for cell in row if cell) for row in self.state.explored)

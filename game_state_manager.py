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
from db import db
from tools.fa_runtime import fa_runtime
from game_definitions import GameDefinitionsManager
from entity_placement_manager import EntityPlacementManager
from privacy_logging import describe_collection, describe_text
from game_messages import msg as localized_msg

logger = logging.getLogger()

# Use random map (for testing)
USE_RANDOM_MAP = False
WORLD_TRANSLATION_CACHE_VERSION = 4


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

    @classmethod
    async def create(cls, seed: int, theme_desc: str, do_web_search: bool = False,
                    language: str = "en", generator_id: Optional[str] = None,
                    owner_id: Optional[str] = None, visibility: Optional[str] = None):
        """Factory method to create and initialize a GameStateManager."""
        manager = cls(seed, theme_desc, do_web_search, language, generator_id, owner_id, visibility)

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

        return manager

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
        start_x, start_y = self.state.player_pos
        candidates = sorted(
            (
                (abs(x - start_x) + abs(y - start_y), y, x)
                for y in range(self.state.map_height)
                for x in range(self.state.map_width)
                if (x, y) != (start_x, start_y)
            )
        )
        occupied = set()
        placements = []

        def reserve_position(avoid_start_zone=False):
            for _, y, x in candidates:
                if (x, y) in occupied:
                    continue
                if avoid_start_zone and abs(x - start_x) <= 1 and abs(y - start_y) <= 1:
                    continue
                occupied.add((x, y))
                return x, y
            return None

        enemy_defs = self.definitions.enemy_defs if isinstance(self.definitions.enemy_defs, list) else []
        for enemy_def in enemy_defs:
            if not isinstance(enemy_def, dict) or not enemy_def.get('enemy_id'):
                continue
            position = reserve_position(avoid_start_zone=True)
            if position is None:
                break
            placements.append({
                'type': 'enemy',
                'entity_id': enemy_def['enemy_id'],
                'x': position[0],
                'y': position[1],
            })

        item_defs = self.definitions.item_defs if isinstance(self.definitions.item_defs, list) else []
        for item_def in item_defs:
            if not isinstance(item_def, dict) or not item_def.get('id'):
                continue
            position = reserve_position()
            if position is None:
                break
            placements.append({
                'type': 'item',
                'entity_id': item_def['id'],
                'x': position[0],
                'y': position[1],
            })

        return placements

    async def initialize_game_placements(self):
        """Generate entity placements (both enemies and items)."""
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

        # Keep the placement processor in sync when the fallback path supplied
        # the list instead of the model-backed generator.
        self.entity_manager.entity_placements = list(self.entity_placements)

    async def initialize_tile_info(self):
        """Prebuild fast tile summaries so movement never waits on narration."""
        generated_tiles = []
        generator = getattr(self.gen_ai, "gen_tile_quick_info", None)

        if callable(generator) and not getattr(self, "loaded_from_generator", False):
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
        return description

    def _placement_at(self, x: int, y: int) -> Optional[dict]:
        return next(
            (
                placement
                for placement in getattr(self, "entity_placements", [])
                if placement.get("x") == x and placement.get("y") == y
            ),
            None
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
            game_over=False,
            game_won=False,
            temporary_effects={},
            game_title=self.gen_ai.game_title or "Unknown Game",  # Set the AI-generated title
            player=self.definitions.player_defs[0] if hasattr(self.definitions, 'player_defs') and self.definitions.player_defs else {}
        )

        # Initialize cell types after state is created
        if USE_RANDOM_MAP:
            self.state.cell_types = self.make_random_map()
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
        await self.initialize_game_placements()

        # Process the entity placements to populate enemies and items
        self.entity_placements = self.entity_manager.process_placements(self.state)

        # Prebuild fast, tappable tile summaries after placements are sanitized.
        await self.initialize_tile_info()

        # Set initial position as explored
        x, y = self.state.player_pos
        self.state.explored[y][x] = True

        return await self.create_message("Game initialized!")

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

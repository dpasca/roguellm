from openai import AsyncOpenAI
import random
from typing import Any, Dict, List
from models import GameState
import json
import pprint
from openai._types import NOT_GIVEN, NotGiven
from openai._client import Timeout, Transport
from openai._base_client import DEFAULT_MAX_RETRIES

from gen_ai_prompts import (
    SYS_BETTER_DESC_PROMPT_MSG,
    SYS_GENERAL_JSON_RULES_MSG,
    SYS_GEN_PLAYER_JSON_MSG,
    SYS_GEN_GAME_ITEMS_JSON_MSG,
    SYS_GEN_GAME_ENEMIES_JSON_MSG,
    SYS_GEN_GAME_CELLTYPES_JSON_MSG,
    SYS_TRANSLATE_WORLD_JSON_MSG,
    SYS_GEN_MAP_CSV_MSG,
    SYS_GEN_ENTITY_PLACEMENT_MSG,
    ADAPT_SENTENCE_SYSTEM_MSG,
    ROOM_DESC_SYSTEM_MSG,
    DUMMY_PLACEMENTS,
    append_language_and_desc_to_prompt,
    append_desc_to_prompt
)
from gen_ai_utils import extract_clean_data, make_query_and_web_search, get_language_name, with_exponential_backoff

import logging
logger = logging.getLogger()

# Constants
DO_BYPASS_WORLD_GEN = False
DEF_TEMP = 0.7

# Model quality levels
MODEL_QUALITY_LOW = "low"
MODEL_QUALITY_HIGH = "high"

# Model quality settings for different tasks
MODEL_QUALITY_FOR_JSON = MODEL_QUALITY_LOW
MODEL_QUALITY_FOR_THEME_DESC = MODEL_QUALITY_LOW
MODEL_QUALITY_FOR_MAP = MODEL_QUALITY_LOW

WORLD_TRANSLATION_FIELDS = (
    "theme_desc_better",
    "player_defs",
    "item_defs",
    "enemy_defs",
    "celltype_defs",
)
PRESERVED_WORLD_FIELD_NAMES = {
    "id",
    "enemy_id",
    "type",
    "effect",
    "hp",
    "attack",
    "defense",
    "xp",
    "font_awesome_icon",
    "map_color",
}
TRANSLATABLE_STRING_LIST_FIELD_NAMES = {"weapons"}

#==================================================================
# GenAI
#==================================================================
class GenAIModel:
    def __init__(self, model_name=None, base_url=None, api_key=None):
        self.model_name = model_name
        self.base_url = base_url
        self.api_key = api_key

        # Validate API key
        if not self.api_key:
            raise ValueError(
                "API key is required but not provided. Please set the appropriate environment variables:\n"
                "- LOW_SPEC_MODEL_API_KEY for low-spec model\n"
                "- HIGH_SPEC_MODEL_API_KEY for high-spec model\n"
                "You can get an OpenAI API key from: https://platform.openai.com/api-keys\n"
                "Create a .env file with your API keys (see _env.example for an example)"
            )

        # Custom timeout and retry settings for non-OpenAI models
        timeout = Timeout(
            connect=5.0,    # How long to wait for a connection
            read=15.0,      # How long to wait for data
            write=5.0,      # How long to wait to send data
            pool=5.0,       # How long to wait for a connection from the pool
        )

        # Disable built-in retries since we handle them at a higher level
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            #max_retries=0,  # Disable automatic retries
            #timeout=timeout
        )

# GenAI
class GenAI:

    def __init__(
        self,
        lo_model: GenAIModel,
        hi_model: GenAIModel,
        random_seed: int = 0,
    ):
        self.random = random.Random(random_seed)
        self.lo_model = lo_model
        self.hi_model = hi_model
        self.theme_desc = None
        self.theme_desc_better = None
        self.do_web_search = False
        self.language = "en"
        self.game_title = None

        logger.info(f"Low spec model: {self.lo_model.model_name}")
        logger.info(f"High spec model: {self.hi_model.model_name}")

    async def _quick_completion(
            self,
            system_msg: str,
            user_msg: str,
            quality: str,
            temp: float = DEF_TEMP
    ):
        use_model = self.hi_model if quality == MODEL_QUALITY_HIGH else self.lo_model
        logger.info(f"Requesting completion with model {use_model.model_name}")
        logger.info(f"System message: {system_msg}")
        logger.info(f"User message: {user_msg}")

        try:
            async def get_completion():
                return await use_model.client.chat.completions.create(
                    model=use_model.model_name,
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg}
                    ],
                    temperature=temp
                )

            response = await with_exponential_backoff(get_completion)
            result = response.choices[0].message.content
            logger.info(f"Obtained completion: {result}")
            return result
        except Exception as e:
            logger.error(f"Error in _quick_completion: {e}")
            raise  # Re-raise the exception to let the caller handle it

    # Validate any font-awesome icons in the data structure.
    def _validate_icons(self, data: dict, context: str = "default") -> dict:
        from tools.fa_runtime import fa_runtime
        return fa_runtime.process_game_data(data, context)

    # Upon setting the theme description, translate the basic system prompts
    async def set_theme_description(
            self,
            theme_desc: str,
            theme_desc_better: str,
            do_web_search: bool,
            language: str,
    ) -> str:
        self.theme_desc = theme_desc
        self.theme_desc_better = theme_desc_better
        self.do_web_search = do_web_search
        self.language = language

        if not self.theme_desc_better:
            logger.info("Generating theme description 'better'")
            await self.gen_theme_desc_better()

        # Extract the game title from the theme description
        self.game_title = self.theme_desc_better.split("\n")[0]
        logger.info(f"Game title: {self.game_title}")

        return self.theme_desc_better

    async def translate_world_definition(
            self,
            world_definition: Dict[str, Any],
            source_language: str,
            target_language: str,
    ) -> Dict[str, Any]:
        """Translate saved world definitions while preserving gameplay fields."""
        logger.info(
            "Translating world definition from %s to %s",
            source_language,
            target_language,
        )
        response = await self._quick_completion(
            system_msg=(
                SYS_TRANSLATE_WORLD_JSON_MSG +
                f"\nSource language: {get_language_name(source_language)}" +
                f"\nTarget language: {get_language_name(target_language)}"
            ),
            user_msg=json.dumps(world_definition, ensure_ascii=False),
            quality=MODEL_QUALITY_FOR_JSON,
            temp=0.2,
        )

        try:
            translated = json.loads(extract_clean_data(response))
        except json.JSONDecodeError as e:
            logger.error(f"Invalid translated world JSON: {response}")
            raise ValueError("World translation response was not valid JSON") from e

        return self._normalize_translated_world_definition(world_definition, translated)

    def _normalize_translated_world_definition(
            self,
            source: Dict[str, Any],
            translated: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not isinstance(translated, dict):
            raise ValueError("World translation must be a JSON object")

        missing_fields = [field for field in WORLD_TRANSLATION_FIELDS if field not in translated]
        if missing_fields:
            raise ValueError(f"World translation is missing fields: {missing_fields}")

        if not isinstance(translated["theme_desc_better"], str):
            raise ValueError("Translated theme_desc_better must be a string")

        protected_terms = self._collect_protected_world_terms(source)
        normalized = {
            "theme_desc_better": self._restore_theme_title_protected_terms(
                source["theme_desc_better"],
                translated["theme_desc_better"],
                protected_terms,
            )
        }
        for field in WORLD_TRANSLATION_FIELDS[1:]:
            normalized[field] = self._merge_translated_world_value(
                source[field],
                translated[field],
                field,
                field,
                protected_terms,
            )
        return normalized

    def _collect_protected_world_terms(self, source: Dict[str, Any]) -> tuple[str, ...]:
        terms = []
        for player_def in source.get("player_defs", []):
            if not isinstance(player_def, dict):
                continue
            name = player_def.get("name")
            if isinstance(name, str) and name.strip() and name not in terms:
                terms.append(name)
        return tuple(terms)

    def _restore_theme_title_protected_terms(
            self,
            source_value: str,
            translated_value: str,
            protected_terms: tuple[str, ...],
    ) -> str:
        source_lines = source_value.splitlines()
        translated_lines = translated_value.splitlines()
        if not source_lines or not translated_lines:
            return translated_value

        if self._is_missing_protected_term(source_lines[0], translated_lines[0], protected_terms):
            translated_lines[0] = source_lines[0]
        return "\n".join(translated_lines)

    def _is_missing_protected_term(
            self,
            source_value: str,
            translated_value: str,
            protected_terms: tuple[str, ...],
    ) -> bool:
        return any(term in source_value and term not in translated_value for term in protected_terms)

    def _merge_translated_world_value(
            self,
            source_value: Any,
            translated_value: Any,
            path: str,
            field_name: str,
            protected_terms: tuple[str, ...],
    ) -> Any:
        if field_name in PRESERVED_WORLD_FIELD_NAMES:
            return source_value

        if isinstance(source_value, dict):
            if not isinstance(translated_value, dict):
                raise ValueError(f"Translated world field {path} must be an object")

            return {
                key: self._merge_translated_world_value(
                    value,
                    translated_value.get(key, value),
                    f"{path}.{key}",
                    key,
                    protected_terms,
                )
                for key, value in source_value.items()
            }

        if isinstance(source_value, list):
            if not isinstance(translated_value, list):
                raise ValueError(f"Translated world field {path} must be a list")
            if len(source_value) != len(translated_value):
                raise ValueError(f"Translated world field {path} changed list length")

            if all(isinstance(item, str) for item in source_value):
                if field_name in TRANSLATABLE_STRING_LIST_FIELD_NAMES:
                    return [
                        item if isinstance(item, str) else source_value[index]
                        for index, item in enumerate(translated_value)
                    ]
                return list(source_value)

            return [
                self._merge_translated_world_value(
                    source_item,
                    translated_item,
                    f"{path}[{index}]",
                    field_name,
                    protected_terms,
                )
                for index, (source_item, translated_item) in enumerate(zip(source_value, translated_value))
            ]

        if isinstance(source_value, str):
            if not isinstance(translated_value, str):
                raise ValueError(f"Translated world field {path} must be a string")
            if field_name == "name" and self._is_missing_protected_term(
                source_value,
                translated_value,
                protected_terms,
            ):
                return source_value
            return translated_value

        return source_value

    # Generate a better/extended theme description
    async def gen_theme_desc_better(self):
        if DO_BYPASS_WORLD_GEN: # Quick version for testing
            self.theme_desc_better = f"""
Generic Game (TEST)
A universe where you can become the master of the universe by defeating other masters.
- Locations: dungeon, castle, village, forest, mountain, desert, space station, alien planet
- The language of the response must be: {get_language_name(self.language)}
"""
        else:
            research_result = ""
            if self.do_web_search:
                research_result = await make_query_and_web_search(
                    self.lo_model.client,
                    self.lo_model.model_name,
                    self.theme_desc,
                    self.language
                )

            if research_result:
                self.theme_desc += f"\n\n# Web Search Results\n{research_result}"

            self.theme_desc_better = await self._quick_completion(
                system_msg=(
                    SYS_BETTER_DESC_PROMPT_MSG +
                    f"\n- The language of the response must be: {get_language_name(self.language)}"
                ),
                user_msg=self.theme_desc,
                quality=MODEL_QUALITY_FOR_THEME_DESC
            )
        logger.info(f"Theme description 'better': {self.theme_desc_better}")

    @staticmethod
    def _make_formatted_events(event_history: List[dict]) -> List[str]:
        formatted_events = []
        RELEVANT_EVENTS = 5
        for event in event_history[-RELEVANT_EVENTS:]:  # Keep last N events
            action = event.get('action', 'unknown')
            # The description is directly in the event, not nested under 'event'
            description = event.get('description', event.get('description_raw', 'No description'))
            formatted_events.append(f"[{action}] {description}")
        return formatted_events

    def _create_context(self, gstate: GameState, event_history: List[dict]) -> str:
        """Create a context string for the LLM based on game state and recent history."""
        context = []

        # Add current position and exploration status
        x, y = gstate.player_pos
        was_explored = gstate.explored[y][x]

        ct_name = gstate.cell_types[y][x]['name']
        ct_desc = gstate.cell_types[y][x]['description']
        context.append(f"Current position: ({x}, {y}) of a {gstate.map_width}x{gstate.map_height} map")
        context.append(f"Current location type: {ct_name} ({ct_desc})")

        px, py = gstate.player_pos_prev
        if px != x or py != y:
            context.append(f"Previous position: ({px}, {py})")
            pct_name = gstate.cell_types[py][px]['name']
            pct_desc = gstate.cell_types[py][px]['description']
            context.append(f"Previous location type: {pct_name} ({pct_desc})")

        if was_explored:
            context.append("This location has been previously explored.")
            # Add previous room description if it exists
            if event_history:
                previous_descriptions = [
                    event.get('description', event.get('description_raw', ''))
                    for event in event_history
                    if event.get('type') == 'update'
                    and event.get('action') in ['move', 'initialize']
                    and (event.get('state', {}).get('player_pos') == (x, y))
                ]
                if previous_descriptions:
                    context.append(f"Previous description of this room: {previous_descriptions[-1]}")
                else:
                    context.append("No previous room description available.")
            else:
                # Handle the case where there's no event history yet (e.g., during initialization)
                context.append("No previous room description available (first visit).")

        # Add player status
        health_pct = int(gstate.player_hp / gstate.player_max_hp * 100.0)
        context.append(f"Player status: HP {health_pct}%")

        # Add combat status if in combat
        if gstate.in_combat and gstate.current_enemy:
            enemy = gstate.current_enemy
            enemy_health_pct = int(enemy.hp / enemy.max_hp * 100.0)
            context.append(f"In combat with {enemy.name} (HP {enemy_health_pct}%)")
            if enemy.weapons:
                context.append(f"Enemy is armed with: {', '.join(enemy.weapons)}")

        # Add recent events (limited to prevent context exploitation)
        if event_history:
            formatted_events = self._make_formatted_events(event_history)
            context.append("")
            context.append("# Recent events")
            context.extend([f"- {event}" for event in formatted_events])
        else:
            context.append("")
            context.append("# Recent events")
            context.append("- No events yet (game just started)")

        # Add equipment info
        if gstate.equipment.weapon or gstate.equipment.armor:
            context.append("")
            context.append("# Equipment")
            if gstate.equipment.weapon:
                context.append(f"Wielding: {gstate.equipment.weapon.name}")
            if gstate.equipment.armor:
                context.append(f"Wearing: {gstate.equipment.armor.name}")

        return "\n".join(context)

    # Generate a list of game elements from a JSON samples + system prompt
    async def _gen_game_elems_from_json_sample(
            self,
            json_template: str,
            system_msg: str
    ) -> List[dict]:
        if DO_BYPASS_WORLD_GEN:
            return json.loads(json_template)

        system_msg = append_language_and_desc_to_prompt(
            # NOTE: We're adding the general JSON rules to help against bad formatting
            system_msg + SYS_GENERAL_JSON_RULES_MSG,
            self.language,
            self.theme_desc
        )
        # Verify that the input is valid JSON
        template_list = []
        try:
            template_list = json.loads(json_template)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON input: {json_template}")
            raise ValueError("Invalid JSON input")

        # Generate a new list of items
        response = await self._quick_completion(
            system_msg=system_msg,
            user_msg=json_template,
            quality=MODEL_QUALITY_FOR_JSON
        )
        # Convert the response to a list of dictionaries
        try:
            data = json.loads(extract_clean_data(response))
            # Validate any font-awesome icons in the data
            data = self._validate_icons(data)
            return data
        except json.JSONDecodeError:
            # Fallback to the original list if the response is broken
            logger.error(f"Invalid JSON output: {response}")
            return template_list

    async def gen_players_from_json_sample(self, player_defs: str) -> dict:
        return await self._gen_game_elems_from_json_sample(player_defs, SYS_GEN_PLAYER_JSON_MSG)

    async def gen_game_items_from_json_sample(self, item_defs: str) -> List[dict]:
        return await self._gen_game_elems_from_json_sample(item_defs, SYS_GEN_GAME_ITEMS_JSON_MSG)

    async def gen_game_enemies_from_json_sample(self, enemy_defs: str) -> List[dict]:
        return await self._gen_game_elems_from_json_sample(enemy_defs, SYS_GEN_GAME_ENEMIES_JSON_MSG)

    async def gen_game_celltypes_from_json_sample(self, celltype_defs: str) -> List[dict]:
        return await self._gen_game_elems_from_json_sample(celltype_defs, SYS_GEN_GAME_CELLTYPES_JSON_MSG)

    async def gen_game_map_from_celltypes(
            self,
            celltype_defs: List[dict],
            map_width: int,
            map_height: int
    ) -> List[List[dict]]:
        # Prepare message
        use_msg = "Here are the cell types:\n"
        for ct in celltype_defs:
            id = ct['id']
            name = ct['name']
            desc = ct['description']
            use_msg += f'- id:{id}, name:"{name}", desc:"{desc}"\n'
        use_msg += f"\nGenerate map with dimensions width:{map_width} and height:{map_height} using the above cell types."

        logger.info(f"gen_game_map_from_celltypes: User message: {use_msg}")

        # Get CSV response
        result_csv = await self._quick_completion(
            system_msg=append_desc_to_prompt(
                SYS_GEN_MAP_CSV_MSG,
                self.theme_desc_better
            ),
            user_msg=use_msg,
            quality=MODEL_QUALITY_FOR_MAP
        )
        logger.info(f"Result CSV: {result_csv}")
        # Clean the response to remove any markdown formatting (just in case)
        result_csv = extract_clean_data(result_csv)

        # Process CSV into map
        out_map = []
        rows = [row.strip() for row in result_csv.split("\n") if row.strip()]

        if len(rows) != map_height:
            logger.error(f"Generated map height {len(rows)} doesn't match requested height {map_height}")
            raise ValueError("Generated map has incorrect dimensions")

        for row in rows:
            cells = [cell.strip() for cell in row.split(",")]
            if len(cells) != map_width:
                logger.error(f"Generated map width {len(cells)} doesn't match requested width {map_width}")
                raise ValueError("Generated map has incorrect dimensions")

            map_row = []
            for cell_id in cells:
                matching_cells = [ct for ct in celltype_defs if str(ct['id']) == cell_id]
                if not matching_cells:
                    logger.error(f"Unknown cell type ID: {cell_id}")
                    raise ValueError(f"Generated map contains unknown cell type: {cell_id}")
                map_row.append(matching_cells[0])
            out_map.append(map_row)

        return out_map

    # Generate strategic entity placements (both enemies and items)
    async def gen_entity_placements(
            self,
            cell_types: List[List[dict]],
            enemy_defs: List[dict],
            item_defs: List[dict],
            map_width: int,
            map_height: int
    ) -> List[dict]:
        # Create a string representation of the map for the LLM
        map_desc = []
        for y in range(map_height):
            row = []
            for x in range(map_width):
                cell = cell_types[y][x]
                row.append(f"{cell['name']} ({cell['id']})")
            map_desc.append(" | ".join(row))
        map_str = "\n".join(map_desc)

        # Format enemy definitions
        enemy_desc = []
        for enemy in enemy_defs:
            enemy_desc.append(
                f"ID: {enemy['enemy_id']}, " +
                f"Name: {enemy['name']}, " +
                f"HP: {enemy['hp']['min']}-{enemy['hp']['max']}, " +
                f"Attack: {enemy['attack']['min']}-{enemy['attack']['max']}"
            )
        enemy_str = "\n".join(enemy_desc)

        # Format item definitions
        item_desc = []
        for item in item_defs:
            effects = []
            for k, v in item['effect'].items():
                effects.append(f"{k}: {v}")
            item_desc.append(
                f"ID: {item['id']}, " +
                f"Name: {item['name']}, " +
                f"Type: {item['type']}, " +
                f"Effects: {', '.join(effects)}"
            )
        item_str = "\n".join(item_desc)

        # Create user message
        user_msg = f"""Here is the map layout (width: {map_width}, height: {map_height}):
{map_str}

Available enemy types:
{enemy_str}

Available items:
{item_str}

Place both enemies and items strategically on this map, considering the terrain types and theme.
For enemies, use their exact enemy_id, and for items use their exact item_id.
Each placement should indicate whether it's an enemy or an item.
"""

        if DO_BYPASS_WORLD_GEN:
            placements_json = DUMMY_PLACEMENTS
        else:
            response = await self._quick_completion(
                system_msg=append_desc_to_prompt(
                    SYS_GEN_ENTITY_PLACEMENT_MSG,
                    self.theme_desc_better),
                user_msg=user_msg,
                quality=MODEL_QUALITY_FOR_JSON)
            placements_json = extract_clean_data(response)
            logger.info(f"Entity placements:\n{pprint.pformat(json.loads(placements_json), indent=2)}")

        # Parse the response
        try:
            placements = json.loads(placements_json)
            return placements
        except json.JSONDecodeError as e:
            logger.error(
                f"Invalid JSON in entity placement:\n" +
                f"Error: {str(e)}\nPosition: {e.pos}\n" +
                f"Line: {e.lineno}, Column: {e.colno}\n" +
                f"JSON content: {placements_json}")
            return []

    # Generator for generic sentences
    async def gen_adapt_sentence(
            self,
            game_state: GameState,
            event_history: List[dict],
            original_sentence: str
    ) -> str:
        if self.lo_model.client is None:
            return original_sentence

        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Original sentence: {original_sentence}

# Current Game Context
{context}"""

        logger.info(f"gen_adapt_sentence: User message: {user_msg}")

        try:
            async def get_completion():
                return await self.lo_model.client.chat.completions.create(
                    model=self.lo_model.model_name,
                    messages=[
                        {"role": "system", "content":
                            append_language_and_desc_to_prompt(
                                ADAPT_SENTENCE_SYSTEM_MSG,
                                self.language,
                                self.theme_desc_better
                          )
                        },
                        {"role": "user", "content": user_msg}
                    ],
                    temperature=DEF_TEMP,
                )

            response = await with_exponential_backoff(get_completion)
            result = response.choices[0].message.content
            logger.info(f"Generated description: {result}")
            return result

        except Exception as e:
            logger.error(f"Error generating description: {e}")
            return original_sentence

    # Generate a room description based on game state and history.
    async def gen_room_description(self, game_state: GameState, event_history: List[dict]) -> str:
        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Generate a short random location description.

# Current Game Context
{context}
"""
        logger.info(f"gen_room_description: User message: {user_msg}")

        try:
            async def get_completion():
                return await self.lo_model.client.chat.completions.create(
                    model=self.lo_model.model_name,
                    messages=[
                        {"role": "system", "content":
                            append_language_and_desc_to_prompt(
                                ROOM_DESC_SYSTEM_MSG,
                                self.language,
                                self.theme_desc_better
                            )
                        },
                        {"role": "user", "content": user_msg}
                    ],
                    temperature=DEF_TEMP
                )

            response = await with_exponential_backoff(get_completion)
            result = response.choices[0].message.content
            logger.info(f"Generated description: {result}")
            return result

        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious location. [FALLBACK]"

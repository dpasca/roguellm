from openai import AsyncOpenAI
import random
from typing import List
from models import GameState
import json
import pprint

from gen_ai_prompts import *
from gen_ai_utils import extract_clean_data, make_query_and_web_search

import logging
logger = logging.getLogger()

# Default temperature for completions
DEF_TEMP = 0.7

# Do bypass world generation (for testing)
DO_BYPASS_WORLD_GEN = False

MODEL_QUALITY_FOR_JSON = "low"
MODEL_QUALITY_FOR_THEME_DESC = "low"
MODEL_QUALITY_FOR_MAP = "low"

#==================================================================
# GenAI
#==================================================================
class GenAIModel:
    def __init__(self, base_url = None, api_key = None, model_name = None):
        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name

        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
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
    ) -> str:
        use_model = self.lo_model if quality == "low" else self.hi_model
        response = await use_model.client.chat.completions.create(
            model=use_model.model_name,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=temp,  # Add some variability but keep it coherent
        )
        return response.choices[0].message.content

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

    # Generate a better/extended theme description
    async def gen_theme_desc_better(self):
        if DO_BYPASS_WORLD_GEN: # Quick version for testing
            self.theme_desc_better = f"""
Generic Game (TEST)
A universe where you can become the master of the universe by defeating other masters.
- Locations: dungeon, castle, village, forest, mountain, desert, space station, alien planet
- The language of the response must be {self.language}
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
                    f"\n- The language of the response must be {self.language}"),
                user_msg=self.theme_desc,
                quality=MODEL_QUALITY_FOR_THEME_DESC
        )
        logger.info(f"Theme description 'better': {self.theme_desc_better}")

    @staticmethod
    def _make_formatted_events(event_history: List[dict]) -> List[str]:
        formatted_events = []
        RELEVANT_EVENTS = 5
        for event in event_history[-RELEVANT_EVENTS:]:  # Keep last N events
            formatted_events.append(
                f"[{event['action']}] {event['event']['description']}"
            )
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
                    event['event']['description']
                    for event in event_history
                    if event['event'].get('type') == 'update'
                    and event['action'] in ['move', 'initialize']
                    and (event['event'].get('state', {}).get('player_pos') == (x, y))
                ]
                if previous_descriptions:
                    context.append(f"Previous description of this room: {previous_descriptions[-1]}")
                else:
                    context.append("") # No previous room description
            else:
                assert False, "No event history found"

        # Add player status
        health_pct = int(gstate.player_hp / gstate.player_max_hp * 100.0)
        context.append(f"Player status: HP {health_pct}%")

        # Add recent events (limited to prevent context exploitation)
        formatted_events = self._make_formatted_events(event_history)
        context.append("")
        context.append("# Recent events")
        context.extend([f"- {event}" for event in formatted_events])

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
            response = await self.lo_model.client.chat.completions.create(
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
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
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
            response = await self.lo_model.client.chat.completions.create(
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
                temperature=DEF_TEMP,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious location. [FALLBACK]"

from openai import OpenAI
import random
from typing import List
from models import GameState
import json
from web_search import web_search

import logging
logger = logging.getLogger()

# Default temperature for completions
DEF_TEMP = 0.7

# Do bypass world generation (for testing)
DO_BYPASS_WORLD_GEN = False

MAX_TOKENS_FOR_ROOM_DESC = 200
MAX_TOKENS_FOR_GENERIC_SENTENCE = 120

# Extract clean data for cases where the LLM still uses markdown
def extract_clean_data(data_str: str) -> str:
    if data_str.startswith("```json"):
        return data_str.replace("```json", "").replace("```", "")
    elif data_str.startswith("```csv"):
        return data_str.replace("```csv", "").replace("```", "")
    elif data_str.startswith("```"):
        return data_str.replace("```", "")
    return data_str

# Given a theme description, generate a web search query and return the results
def make_query_and_web_search(
        oai_client: OpenAI,
        model_name: str,
        subject_input: str,
        language: str) -> str:
    user_msg = f"""
Generate web search query to research on the following subject:
{subject_input}

---

# Response Format
Return ONLY the query, no additional text or explanations.
The language of the response must be: {language}
"""
    logger.info(f"Requesting web search query: {user_msg}")
    response = oai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": "You are an expert web search query generator."},
            {"role": "user", "content": user_msg}
        ],
        temperature=DEF_TEMP,
    )
    query = response.choices[0].message.content
    logger.info(f"Obtained web search query: {query}")
    query_result = web_search(query)
    logger.info(f"Web search results: {query_result}")
    return query_result

#==================================================================
# GenAI
#==================================================================
# NOTE: Should append language req and theme desc at the bottom
ADAPT_SENTENCE_SYSTEM_MSG = """
You are an expert interactive game narrator. Your job is to create a BRIEF
adaptation of a raw piece of text from the user, into one more ore sentences
that fit the Game Theme Description provided below.

Describe events in a natural, engaging way that matches:
1. The specified theme/setting
2. The current context
3. The significance of the event

# Guidelines
- Use vocabulary and tone appropriate to the setting
- Reference setting-specific elements
- Adapt description style to event importance
- Place emojis strategically to highlight key features
- Be brief, aim for 20-25 words maximum

# Response Format
Respond ONLY with the adapted sentence.
"""

# NOTE: Should append language req and theme desc at the bottom
ROOM_DESC_SYSTEM_MSG = """
You are an expert interactive game narrator. Your task is to create a BRIEF
location description based on the Game Theme Description provided below.

# Guidelines
- Use setting-appropriate terminology
- Do not over-dramatize the location
- Include relevant atmospheric elements
- Consider current context and player status
- When describing a location that was previously explored, reuse the previous description
- Do not repeat the location name or description if the player's previous location was the same
- Do NOT repeat the same location description twice
- Consider player's current status when setting the mood
- Reference relevant recent events naturally

# Response Format
- Be brief, aim for 20-25 words maximum
- Return ONLY the location description, no additional text or explanations
"""

# This is a description improving prompt from a theme description. Useful in case
# the user provides a very short or unclear theme description.
# NOTE: Should append language req at the bottom
SYS_BETTER_DESC_PROMPT_MSG = """
You generate game theme descriptions for interactive games.
The user provides you with a rough theme description, and you return an improved
version that is more descriptive and detailed.
This response will be used as a game design draft document.
Mention any key details relevant to the game, anything of note that sets the
atmosphere.

Do not include any narrative style or tone, just a detailed and useful theme description

# Response Format
- The first row of the response must be the game title, with no formatting or additional text
- Return ONLY the description, no additional text or explanations
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_PLAYER_JSON_MSG = """
You are an expert game player generator. Your task is to generate a JSON object
describing a game player. The user will provide a sample JSON object of an existing
game. Make sure to select an appropriate font-awesome icon for the player.

# Response Format
Reply with a new JSON object that contains player definition.
Do not include any markdown formatting, including the triple backticks.
The new player definition must follow the same format as the sample definition,
but adapt it to match the game theme. For example, replace a "warrior" class
with "space marine" for a sci-fi theme.
Do not create new fields, as the game is not able to handle them yet.
Do not translate the field names, because they are used as identifiers.
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_GAME_ITEMS_JSON_MSG = """
You are an expert game item generator. Your task is to generate a JSON object
describing game items. The user will provide a sample JSON object of an existing
game.

# Response Format
Reply with a new JSON object that contains up to 10 item definitions.
Do not include any markdown formatting, including the triple backticks.
The new item definitions must follow the same format as the sample item definitions,
but they must use a new theme description. For example, replace a "potion" item
with "med-kit", "energy drink" for another theme.
Do not create new fields, do not create new effect types, as the game is not able
to handle them yet.
The only "effect" types currently supported are: attack, defense, health, duration.
The only "type" fields currently supported are: weapon, armor, consumable.
Do not translate the field names, because they are used as identifiers.
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_GAME_ENEMIES_JSON_MSG = """
You are an expert game enemy generator. Your task is to generate a JSON object
describing game enemies. The user will provide a sample JSON object of an existing
game. Make sure to select an appropriate font-awesome icon for the enemy.

# Response Format
Reply with a new JSON object that contains up to 10 item definitions.
Do not include any markdown formatting, including the triple backticks.
The new item definitions must follow the same format as the sample item definitions,
but they must use a new theme description. For example, replace a "Orc" item
with "tank" for a modern combat theme.
Do not create new fields, as the game is not able to handle them yet.
Do not translate the field names, because they are used as identifiers.
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_GAME_CELLTYPES_JSON_MSG = """
You are an expert game map cell type generator. Your task is to generate a JSON object
describing game map cell types. The user will provide a sample JSON object of an existing
game.

# Response Format
Reply with a new JSON object that contains up to 5 item definitions.
Do not include any markdown formatting, including the triple backticks.
The new item definitions must follow the same format as the sample item definitions,
but they must use a new theme description. For example, replace a "grass" item
with "desert" for a desert theme.
Do not create new fields, as the game is not able to handle them yet.
Do not translate the field names, because they are used as identifiers.
"""

# NOTE: Should append theme desc at the bottom
SYS_GEN_MAP_CSV_MSG = """
You are an expert game map generator. Your task is to generate a CSV map
describing the game map. The user will provide a set of cell types, each with an "id",
"name", "description".

Your job is to respond with a CSV map, where each cell is described by the "id" of
the cell type. Generate a map that is coherent with the game theme.

# Response Format
Return ONLY the CSV map, with no additional text or explanations.
Do not include any markdown formatting, including the triple backticks.
"""

def append_language_and_desc_to_prompt(prompt: str, language: str, desc: str) -> str:
    return f"""{prompt}

The language of the response must be {language}

# Game Theme Description
{desc}
"""

def append_desc_to_prompt(prompt: str, desc: str) -> str:
    return f"""{prompt}

# Game Theme Description
{desc}
"""

# GenAIModel
class GenAIModel:
    def __init__(self, base_url = None, api_key = None, model_name = None):
        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

# GenAI
class GenAI:

    def __init__(
        self,
        lo_model: GenAIModel,
        hi_model: GenAIModel,
        random_seed: int = None,
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

    # Quick completion with the high-spec model
    def _quick_completion_hi(
            self,
            system_msg: str,
            user_msg: str,
            temp: float = DEF_TEMP
    ) -> str:
        response = self.hi_model.client.chat.completions.create(
            model=self.hi_model.model_name,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=temp,  # Add some variability but keep it coherent
        )
        return response.choices[0].message.content

    # Quick completion with the low-spec model
    def _quick_completion_lo(
            self,
            system_msg: str,
            user_msg: str,
            temp: float = DEF_TEMP
    ) -> str:
        response = self.lo_model.client.chat.completions.create(
            model=self.lo_model.model_name,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=temp,  # Add some variability but keep it coherent
        )
        return response.choices[0].message.content

    # Upon setting the theme description, translate the basic system prompts
    def set_theme_description(
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
            self.gen_theme_desc_better()

        # Extract the game title from the theme description
        self.game_title = self.theme_desc_better.split("\n")[0]
        logger.info(f"Game title: {self.game_title}")

        return self.theme_desc_better

    # Generate a better/extended theme description
    def gen_theme_desc_better(self):
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
                research_result = make_query_and_web_search(
                    self.lo_model.client,
                    self.lo_model.model_name,
                    self.theme_desc,
                    self.language
                )

            if research_result:
                self.theme_desc += f"\n\n# Web Search Results\n{research_result}"

            self.theme_desc_better = self._quick_completion_hi(
                system_msg=(
                    SYS_BETTER_DESC_PROMPT_MSG +
                    f"\n- The language of the response must be {self.language}"),
                user_msg=self.theme_desc,
        )
        logger.info(f"Theme description 'better': {self.theme_desc_better}")

    @staticmethod
    def _make_formatted_events(event_history: List[dict]) -> List[str]:
        formatted_events = []
        RELEVANT_EVENTS = 10
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

    def _json_str_to_list_gen(self, json_str: str, system_msg: str) -> List[dict]:
        # Verify that the input is valid JSON
        source_list = []
        try:
            source_list = json.loads(json_str)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON input: {json_str}")
            raise ValueError("Invalid JSON input")

        # Generate a new list of items
        response = self._quick_completion_hi(
            system_msg=system_msg,
            user_msg=json_str,
        )
        # Clean the response to remove any markdown formatting
        response = extract_clean_data(response)
        # Convert the response to a list of dictionaries
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback to the original list if the response is broken
            logger.error(f"Invalid JSON output: {response}")
            return source_list

    # Generate a list of game elements from a JSON samples + system prompt
    def _gen_game_elems_from_json_sample(
            self,
            elem_defs: str,
            system_msg: str
    ) -> List[dict]:
        if DO_BYPASS_WORLD_GEN:
            return json.loads(elem_defs)

        return self._json_str_to_list_gen(
            elem_defs,
            append_language_and_desc_to_prompt(
                system_msg,
                self.language,
                self.theme_desc
            )
        )

    def gen_players_from_json_sample(self, player_defs: str) -> dict:
        return self._gen_game_elems_from_json_sample(player_defs, SYS_GEN_PLAYER_JSON_MSG)

    def gen_game_items_from_json_sample(self, item_defs: str) -> List[dict]:
        return self._gen_game_elems_from_json_sample(item_defs, SYS_GEN_GAME_ITEMS_JSON_MSG)

    def gen_game_enemies_from_json_sample(self, enemy_defs: str) -> List[dict]:
        return self._gen_game_elems_from_json_sample(enemy_defs, SYS_GEN_GAME_ENEMIES_JSON_MSG)

    def gen_game_celltypes_from_json_sample(self, celltype_defs: str) -> List[dict]:
        return self._gen_game_elems_from_json_sample(celltype_defs, SYS_GEN_GAME_CELLTYPES_JSON_MSG)

    def gen_game_map_from_celltypes(
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
        result_csv = self._quick_completion_lo(
            system_msg=append_desc_to_prompt(
                SYS_GEN_MAP_CSV_MSG,
                self.theme_desc_better
            ),
            user_msg=use_msg,
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

    # Generator for generic sentences
    def gen_adapt_sentence(
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
            response = self.lo_model.client.chat.completions.create(
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
                temperature=DEF_TEMP,  # Add some variability but keep it coherent
                max_tokens=max(MAX_TOKENS_FOR_GENERIC_SENTENCE, len(original_sentence)//4)
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return original_sentence

    # Generator for room descriptions
    def gen_room_description(self, game_state: GameState, event_history: List[dict]) -> str:
        """Generate a room description based on game state and history."""

        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Generate a short random location description.

# Current Game Context
{context}
"""

        logger.info(f"gen_room_description: User message: {user_msg}")

        try:
            response = self.lo_model.client.chat.completions.create(
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
                temperature=DEF_TEMP,  # Add some variability but keep it coherent
                max_tokens=MAX_TOKENS_FOR_ROOM_DESC
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious location. [FALLBACK]"

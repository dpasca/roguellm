from openai import OpenAI
import random
from typing import List
from models import GameState
import json

import logging
logger = logging.getLogger()

DO_BYPAST_WORLD_GEN = False

MAX_TOKENS_FOR_ROOM_DESC = 200
MAX_TOKENS_FOR_GENERIC_SENTENCE = 120

def clean_json_str(json_str: str) -> str:
    return json_str.replace("```json", "").replace("```", "")

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

# Requirements
- Do not include any narrative style or tone, just a detailed and useful theme description
- Clearly list what are the types of locations that the player can explore
  (e.g. "dungeon room", "cave", "street", "dark corridor", "subway station", "town square", etc.)
- All listed locations must be part of an area that the player can explore by moving
  around the map. Do NOT include widely distant locations such as "alien planet" and
  "starship".

# Response Format
- The first row of the response must be the game title, with no formatting or additional text
- Return ONLY the description, no additional text or explanations
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_GAME_ITEMS_JSON_MSG = """
You are an expert game item generator. Your task is to generate a JSON object
describing game items. The user will provide a sample JSON object of an existing
game.

# Response Format
Reply with a new JSON object that contains up to 10 item definitions.
The new item definitions must follow the same format as the sample item definitions,
but they must use a new theme description. For example, replace a "potion" item
with "med-kit" for a modern combat theme.
Do not create new fields, do not create new effect types, as the game is not able
to handle them yet.
Do not translate the field names, because they are used as identifiers.
"""

# NOTE: Should append language req and theme desc at the bottom
SYS_GEN_GAME_ENEMIES_JSON_MSG = """
You are an expert game enemy generator. Your task is to generate a JSON object
describing game enemies. The user will provide a sample JSON object of an existing
game.

# Response Format
Reply with a new JSON object that contains up to 10 item definitions.
The new item definitions must follow the same format as the sample item definitions,
but they must use a new theme description. For example, replace a "Orc" item
with "tank" for a modern combat theme.
Do not create new fields, as the game is not able to handle them yet.
Do not translate the field names, because they are used as identifiers.
"""

def append_language_and_desc_to_prompt(prompt: str, language: str, desc: str) -> str:
    return f"""{prompt}

The language of the response must be {language}

# New Game Theme Description
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
        self.language = "en"
        self.game_title = None
        self.theme_desc_better = None

        logger.info(f"Low spec model: {self.lo_model.model_name}")
        logger.info(f"High spec model: {self.hi_model.model_name}")

    # Quick completion with the high-spec model
    def _quick_completion_hi(self, system_msg: str, user_msg: str, temp: float = 0.7) -> str:
        response = self.hi_model.client.chat.completions.create(
            model=self.hi_model.model_name,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=temp,  # Add some variability but keep it coherent
        )
        return response.choices[0].message.content

    # Upon setting the theme description, translate the basic system prompts
    def set_theme_description(self, theme_desc: str, language: str = "en"):
        self.theme_desc = theme_desc
        self.language = language

        if DO_BYPAST_WORLD_GEN: # Quick version for testing
            self.theme_desc_better = f"""
Generic Game (TEST)
A universe where you can become the master of the universe by defeating other masters.
- Locations: dungeon, castle, village, forest, mountain, desert, space station, alien planet
- The language of the response must be {language}
"""
        else:
            self.theme_desc_better = self._quick_completion_hi(
                system_msg=SYS_BETTER_DESC_PROMPT_MSG + f"\n- The language of the response must be {language}",
                user_msg=theme_desc,
        )
        self.game_title = self.theme_desc_better.split("\n")[0]
        logger.info(f"Game title: {self.game_title}")
        logger.info(f"Theme description: {self.theme_desc_better}")

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
        context.append(f"Current position: ({x}, {y}) of a {gstate.map_width}x{gstate.map_height} map")
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
                    assert False, "No previous room description found"
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
        response = clean_json_str(response)
        # Convert the response to a list of dictionaries
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback to the original list if the response is broken
            logger.error(f"Invalid JSON output: {response}")
            return source_list

    def gen_game_items_from_json_sample(self, item_defs: str) -> List[dict]:
        if DO_BYPAST_WORLD_GEN:
            return json.loads(item_defs)

        return self._json_str_to_list_gen(
            item_defs,
            append_language_and_desc_to_prompt(
                SYS_GEN_GAME_ITEMS_JSON_MSG,
                self.language,
                self.theme_desc
            )
        )

    def gen_game_enemies_from_json_sample(self, enemy_defs: str) -> List[dict]:
        if DO_BYPAST_WORLD_GEN:
            return json.loads(enemy_defs)

        return self._json_str_to_list_gen(
            enemy_defs,
            append_language_and_desc_to_prompt(
                SYS_GEN_GAME_ENEMIES_JSON_MSG,
                self.language,
                self.theme_desc
            )
        )

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
                temperature=0.7,  # Add some variability but keep it coherent
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
                temperature=0.7,  # Add some variability but keep it coherent
                max_tokens=MAX_TOKENS_FOR_ROOM_DESC
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious location. [FALLBACK]"

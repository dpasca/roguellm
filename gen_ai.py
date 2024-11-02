from openai import OpenAI
import random
from typing import List
from models import GameState
import json

import logging
logger = logging.getLogger()

MAX_TOKENS_FOR_ROOM_DESC = 200
MAX_TOKENS_FOR_GENERIC_SENTENCE = 120

def clean_json_str(json_str: str) -> str:
    return json_str.replace("```json", "").replace("```", "")

#==================================================================
# GenAI
#==================================================================
ADAPT_SENTENCE_SYSTEM_MSG = """
You are a skilled narrative adapter for a RPG game.
Your task is to describe events in a natural, engaging way that varies based on context and significance, and based on the theme description provided below.

# Core guidelines
- Maintain the original meaning while varying the descriptive intensity
- Use simpler language for routine actions (basic attacks, movement, common events)
- Reserve elaborate descriptions for truly significant moments:
  * Critical hits
  * Defeating powerful enemies
  * Finding rare items
  * Major health changes
  * Story-significant events
- Place emojis strategically to highlight key features
- Consider pacing: after several elaborate descriptions, use simpler ones to create rhythm
- Let context guide description style: not every hit needs to be epic
- Reference context only when it adds meaningful impact

Respond ONLY with the adapted sentence.

# Game Theme Description
"""


ROOM_DESC_SYSTEM_MSG = """
You are an expert RPG game narrator. Your task is to create a short room description
using based on the theme description provided below.

# Core Requirements
- Create BRIEF, vivid descriptions in exactly one short sentence
- Aim for 20-25 words maximum
- When describing a room that was previously explored, use a shorter version of the previous description
- Focus on sensory details (sight, sound, smell, temperature)
- Do not break immersion with meta-references
- Do not contradict recent event history
- Do not create a room description that is similar to the previous one. Each room should be unique, be as creative as possible

# Style Guidelines
- Place emojis strategically to highlight key features
- Occasionally inject previous events, to keep the story flowing
- Blend environmental storytelling with atmosphere
- Consider player's current HP when setting mood
- Reference relevant recent events naturally
- Adapt description to current equipment

# Response Format
Return ONLY the room description, no additional text or explanations.

# Game Theme Description
"""

# This is a description improving prompt from a theme description. Useful in case
# the user provides a very short or unclear theme description.
SYS_BETTER_DESC_PROMPT_MSG = """
You generate game theme descriptions for RPG games.
The user provides you with a rough theme description, and you return an improved
version that is more descriptive and detailed.
You reply will be used as a system prompt for a game generator, so pay attention
to the format and style. Do not include any narrative style or tone, just a
detailed and useful theme description, including made-up names and details.

# Response Format
Return ONLY the description, no additional text or explanations."""

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

# New Theme Description
"""

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

# New Theme Description
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
    def set_theme_description(self, theme_desc: str):
        self.theme_desc = theme_desc
        self.theme_desc_better = self._quick_completion_hi(
            system_msg=SYS_BETTER_DESC_PROMPT_MSG,
            user_msg=theme_desc,
        )
        logger.info(f"Improved theme description: {self.theme_desc_better}")

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
        context.append(f"Current position: ({x}, {y}) in a {gstate.map_width}x{gstate.map_height} dungeon")
        if was_explored:
            context.append("This room has been previously explored.")
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
        return self._json_str_to_list_gen(item_defs, SYS_GEN_GAME_ITEMS_JSON_MSG + self.theme_desc)

    def gen_game_enemies_from_json_sample(self, enemy_defs: str) -> List[dict]:
        return self._json_str_to_list_gen(enemy_defs, SYS_GEN_GAME_ENEMIES_JSON_MSG + self.theme_desc)

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
                    {"role": "system", "content": ADAPT_SENTENCE_SYSTEM_MSG + self.theme_desc_better},
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
        user_msg = f"""Create a short room description using the game context below.

# Requirements

# Current Game Context
{context}
"""

        logger.info(f"gen_room_description: User message: {user_msg}")

        try:
            response = self.lo_model.client.chat.completions.create(
                model=self.lo_model.model_name,
                messages=[
                    {"role": "system", "content": ROOM_DESC_SYSTEM_MSG + self.theme_desc_better},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.7,  # Add some variability but keep it coherent
                max_tokens=MAX_TOKENS_FOR_ROOM_DESC
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious chamber in the dungeon. [FALLBACK]"

from openai import OpenAI
import random
from typing import List
from models import GameState
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_API_KEY = "ollama"
OLLAMA_DEFAULT_MODEL = "llama3.1"

# NOTE: For OpenAI, OPENAI_API_KEY should be set in the environment
def is_openai_model(model: str):
    return "gpt" in model

import logging
logger = logging.getLogger()

MAX_TOKENS_FOR_ROOM_DESC = 200
MAX_TOKENS_FOR_GENERIC_SENTENCE = 120

#==================================================================
# GenAI
#==================================================================
FANTASY_ADAPT_SENTENCE_SYSTEM_MSG = """
You are a skilled narrative adapter for a fantasy dungeon game.
Your task is to describe events in a natural, engaging way that varies based on context and significance.
Core guidelines:

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
- Let context guide description style - not every hit needs to be epic
- Keep similar length to original text

Respond ONLY with the adapted sentence."""


FANTASY_ROOM_DESC_SYSTEM_MSG = """You are an expert dungeon narrator.

Core Requirements:
- Create BRIEF, vivid descriptions in exactly one short sentence
- Aim for 15-20 words maximum
- When describing a room that was previously explored, use a shorter version of the previous description
- Focus on sensory details (sight, sound, smell, temperature)

Style Guidelines:
- Use gothic and dark fantasy vocabulary
- Place emojis strategically to highlight key features
- Occasionally inject previous events, to keep the story flowing
- Blend environmental storytelling with atmosphere

Avoid:
- Breaking immersion with meta-references
- Contradicting recent event history
- Contradicting previous room description

Response Format:
Return ONLY the room description, no additional text or explanations."""


class GenAI:
    def __init__(
        self,
        base_url: str = OLLAMA_BASE_URL + "/v1",
        api_key: str = OLLAMA_API_KEY,
        model: str = OLLAMA_DEFAULT_MODEL,
        random_seed: int = None,
    ):
        self.random = random.Random(random_seed)
        self.model = model

        if is_openai_model(model):
            if api_key == OLLAMA_API_KEY:
                api_key = None
            if base_url == OLLAMA_BASE_URL + "/v1":
                base_url = None
        logger.info(f"Model: {model}, Base URL: {base_url}")

        try:
            self.client = OpenAI(
                api_key=api_key,
                base_url=base_url,
            )
        except Exception as e:
            logger.error(f"Error initializing OpenAI client: {e}. Dummy fallback instead.")
            self.client = None

        # Set the default system message for room descriptions
        self.ROOM_DESC_SYSTEM_MSG = FANTASY_ROOM_DESC_SYSTEM_MSG
        self.ADAPT_SENTENCE_SYSTEM_MSG = FANTASY_ADAPT_SENTENCE_SYSTEM_MSG

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
        context.append("Recent events:")
        context.extend([f"- {event}" for event in formatted_events])

        # Add equipment info
        if gstate.equipment.weapon:
            context.append(f"Wielding: {gstate.equipment.weapon.name}")
        if gstate.equipment.armor:
            context.append(f"Wearing: {gstate.equipment.armor.name}")

        return "\n".join(context)

    # Generator for generic sentences
    def gen_adapt_sentence(
            self,
            game_state: GameState,
            event_history: List[dict],
            original_sentence: str
    ) -> str:
        if self.client is None:
            return original_sentence


        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Original: {original_sentence}

Current Game Context:
{context}

Guidelines:
- Adapt naturally: simple for routine actions, elaborate for significant moments
- Reference context only when it adds meaningful impact
- Keep similar length to original"""

        logger.info(f"gen_adapt_sentence: User message: {user_msg}")

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.ADAPT_SENTENCE_SYSTEM_MSG},
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
        user_msg = f"""Create a short room description using this context:

Game State:
{context}

Requirements:
- Consider player's current HP when setting mood
- Reference relevant recent events naturally
- Adapt description to current equipment
"""

        logger.info(f"gen_room_description: User message: {user_msg}")

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.ROOM_DESC_SYSTEM_MSG},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.7,  # Add some variability but keep it coherent
                max_tokens=MAX_TOKENS_FOR_ROOM_DESC
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious chamber in the dungeon. [FALLBACK]"

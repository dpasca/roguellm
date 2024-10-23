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

MAX_TOKENS_FOR_ROOM_DESC = 100
MAX_TOKENS_FOR_GENERIC_SENTENCE = 80

#==================================================================
# GenAI
#==================================================================
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

        # Add current position
        x, y = gstate.player_pos
        context.append(f"Current position: ({x}, {y}) in a {gstate.map_width}x{gstate.map_height} dungeon")

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

        system_msg = """You are an expert narrative adapter for a fantasy dungeon game. Your task is to enhance given sentences while:
- Maintaining the core meaning of the original text
- Incorporating relevant context from recent events and player status
- Using atmospheric language that fits the dungeon setting
- Adding strategic emoji placement to enhance key moments
- Keeping the same approximate length as the original
- Avoiding meta-references to game mechanics
- Preserving any critical gameplay information from the original

Respond ONLY with the adapted sentence, no explanations or additional text."""

        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Original: {original_sentence}

Current Game Context:
{context}

Requirements:
- Adapt the sentence while preserving its core meaning
- Reference the context only if it's directly relevant
- Keep a similar length to the original"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_msg},
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
        if self.client is None:
            return self.random.choice([
                "A dark, musty room with ancient writings on the wall.",
                "A chamber filled with mysterious artifacts and glowing crystals.",
                "A damp cave with strange mushrooms growing on the ceiling.",
                "An eerie room with flickering torches on the walls.",
                "A grand hall with crumbling pillars.",
                "A small room with mysterious runes etched into the floor."
            ])

        system_msg = """You are an expert dungeon narrator specialized in atmospheric room descriptions. Follow these guidelines:

Core Requirements:
- Create vivid, immersive descriptions in 1-2 sentences
- Focus on sensory details (sight, sound, smell, temperature)
- Vary descriptions based on room position (edges feel different from center rooms)
- Include subtle hints about room importance without revealing mechanics

Style Guidelines:
- Use gothic and dark fantasy vocabulary
- Place emojis strategically to highlight key features
- Maintain consistent tone matching recent events
- Blend environmental storytelling with atmosphere

Avoid:
- Revealing game mechanics or future events
- Generic descriptions that could fit any room
- Breaking immersion with meta-references
- Contradicting recent event history

Response Format:
Return ONLY the room description, no additional text or explanations."""

        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Create a room description using this context:

Game State:
{context}

Requirements:
- Consider player's current HP when setting mood
- Reference relevant recent events naturally
- Adapt description to current equipment
- Match intensity to dungeon position (deeper = more ominous)"""

        logger.info(f"User message: {user_msg}")

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.7,  # Add some variability but keep it coherent
                max_tokens=MAX_TOKENS_FOR_ROOM_DESC
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious chamber in the dungeon. [FALLBACK]"

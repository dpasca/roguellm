import json
import random
import time
import os
import logging
import asyncio
import aiofiles
from typing import Dict, List, Optional, Union

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment
from db import db
from tools.fa_runtime import fa_runtime
from game_definitions import GameDefinitionsManager
from entity_placement_manager import EntityPlacementManager

logger = logging.getLogger()

# Use random map (for testing)
USE_RANDOM_MAP = False


class GameStateManager:
    """Manages game state initialization, persistence, and message creation."""

    def __init__(self, seed: int, theme_desc: str, do_web_search: bool = False,
                 language: str = "en", generator_id: Optional[str] = None):
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
        self.theme_desc = theme_desc
        self.theme_desc_better = None
        self.do_web_search = do_web_search

    @classmethod
    async def create(cls, seed: int, theme_desc: str, do_web_search: bool = False,
                    language: str = "en", generator_id: Optional[str] = None):
        """Factory method to create and initialize a GameStateManager."""
        manager = cls(seed, theme_desc, do_web_search, language, generator_id)

        if generator_id:
            # Load from existing generator
            if not manager.definitions.load_from_generator(generator_id):
                raise ValueError(f"Generator with ID {generator_id} not found")
            generator_data = db.get_generator(generator_id)
            if generator_data:
                logger.info(f"Loaded generator with ID: {generator_id}")
                manager.theme_desc = generator_data['theme_desc']
                manager.theme_desc_better = generator_data['theme_desc_better']
                manager.language = generator_data['language']
                manager.generator_id = generator_id
            else:
                raise ValueError(f"Generator with ID {generator_id} not found")

        # Set the theme description and language
        logger.info(f"Setting theme description: {theme_desc} with language: {language}")
        manager.theme_desc_better = await manager.gen_ai.set_theme_description(
            theme_desc=theme_desc,
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

            logger.info(f"## Generated PLAYER defs:\n{manager.definitions.player_defs}\n")
            logger.info(f"## Generated ITEM defs:\n{manager.definitions.item_defs}\n")
            logger.info(f"## Generated ENEMY defs:\n{manager.definitions.enemy_defs}\n")
            logger.info(f"## Generated CELLTYPE defs:\n{manager.definitions.celltype_defs}\n")

            # Save the generator if it was newly created
            manager.definitions.save_generator(theme_desc, manager.theme_desc_better)
            manager.generator_id = db.save_generator(
                theme_desc=theme_desc,
                theme_desc_better=manager.theme_desc_better,
                language=manager.language,
                player_defs=manager.definitions.player_defs,
                item_defs=manager.definitions.item_defs,
                enemy_defs=manager.definitions.enemy_defs,
                celltype_defs=manager.definitions.celltype_defs
            )
            logger.info(f"Saved generator with ID: {manager.generator_id}")

        return manager

    def get_game_title(self):
        """Get the game title from the AI generator."""
        return self.gen_ai.game_title

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
        """Generate a random map for testing purposes."""
        if not self.definitions.celltype_defs:
            # Fallback to basic cell types if definitions aren't loaded
            basic_types = ['grass', 'forest', 'mountain', 'water']
            return [[self.random.choice(basic_types)
                    for _ in range(self.state.map_width)]
                   for _ in range(self.state.map_height)]

        return [[self.random.choice(list(self.definitions.celltype_defs.keys()))
                for _ in range(self.state.map_width)]
               for _ in range(self.state.map_height)]

    async def initialize_game_placements(self):
        """Generate entity placements (both enemies and items)."""
        self.entity_placements = await self.entity_manager.generate_placements(
            self.state.cell_types,
            self.state.map_width,
            self.state.map_height
        )

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

        # Initialize game state
        self.state = GameState(
            player_pos=(config.get('player_start_x', 0), config.get('player_start_y', 0)),
            player_pos_prev=(config.get('player_start_x', 0), config.get('player_start_y', 0)),
            player_hp=config.get('player_hp', 100),
            player_max_hp=config.get('player_max_hp', 100),
            player_attack=config.get('player_attack', 10),
            player_defense=config.get('player_defense', 5),
            map_width=config.get('map_width', 10),
            map_height=config.get('map_height', 10),
            cell_types=[],  # Initialize empty, will be set below
            explored=[[False for _ in range(config.get('map_width', 10))]
                     for _ in range(config.get('map_height', 10))],
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
        self.entity_manager.process_placements(self.state)

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
        room_description = await self._gen_room_description()
        return await self.create_message(room_description)

    async def create_message_description(self, message):
        """Create or enhance message description using AI."""
        # Skip LLM processing for simple status messages like "Moving..."
        if message.get('description_raw') == "Moving...":
            message['description'] = message['description_raw'] # Keep it as is
            return message

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
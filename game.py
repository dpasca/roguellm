import json
import random
import time
import os
from functools import wraps

import logging
logger = logging.getLogger()

from typing import Dict, List, Optional, Union
import concurrent.futures
import asyncio
import aiofiles

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment
from db import db
from tools.fa_runtime import fa_runtime
from game_definitions import GameDefinitionsManager
from combat_manager import CombatManager
from entity_placement_manager import EntityPlacementManager
from game_state_manager import GameStateManager
from player_action_handler import PlayerActionHandler
from game_websocket_handler import WebSocketHandler

#OLLAMA_BASE_URL = "http://localhost:11434"
#OLLAMA_API_KEY = "ollama"
#OLLAMA_DEFAULT_MODEL = "llama3.1"

TEST_DUMMY_EQUIP_AND_ITEMS = False

# Use random map (for testing)
USE_RANDOM_MAP = False

class Game:
    """Main game class that coordinates all game components."""
    
    def __init__(
            self,
            seed : int,
            theme_desc : str,
            do_web_search: bool = False,
            language : str = "en",
            generator_id: Optional[str] = None
    ):
        # Initialize the core components
        self.state_manager = None  # Will be set in create() method
        self.player_action_handler = None  # Will be set in create() method
        self.websocket_handler = None  # Will be set in create() method
        
        # Store initialization parameters
        self.seed = seed
        self.theme_desc = theme_desc
        self.do_web_search = do_web_search
        self.language = language
        self.generator_id = generator_id

    @classmethod
    async def create(
            cls,
            seed : int,
            theme_desc : str,
            do_web_search: bool = False,
            language : str = "en",
            generator_id: Optional[str] = None
    ):
        """Factory method to create and initialize a Game instance."""
        game = cls(seed, theme_desc, do_web_search, language, generator_id)

        # Create the state manager
        game.state_manager = await GameStateManager.create(
            seed, theme_desc, do_web_search, language, generator_id
        )

        # Create the combat manager (reuse existing one from state manager)
        combat_manager = CombatManager(game.state_manager.random, game.state_manager.definitions)

        # Create the player action handler
        game.player_action_handler = PlayerActionHandler(game.state_manager, combat_manager)

        # Create the WebSocket handler
        game.websocket_handler = WebSocketHandler(game.state_manager, game.player_action_handler)

        return game

    def get_game_title(self):
        """Get the game title."""
        return self.state_manager.get_game_title()

    async def handle_message(self, message: dict) -> dict:
        """Handle incoming WebSocket messages."""
        return await self.websocket_handler.handle_message(message)

    def add_client(self, client):
        """Add a WebSocket client connection."""
        self.websocket_handler.add_client(client)

    def remove_client(self, client):
        """Remove a WebSocket client connection."""
        self.websocket_handler.remove_client(client)

    def get_connected_clients(self):
        """Get the set of connected clients."""
        return self.websocket_handler.get_connected_clients()

    # Backward compatibility methods - delegate to state manager
    @property
    def state(self):
        """Get the current game state."""
        return self.state_manager.state if self.state_manager else None

    @property
    def event_history(self):
        """Get the event history."""
        return self.state_manager.event_history if self.state_manager else []

    @property
    def connected_clients(self):
        """Get connected clients (backward compatibility)."""
        return self.websocket_handler.connected_clients if self.websocket_handler else set()

    @connected_clients.setter
    def connected_clients(self, value):
        """Set connected clients (backward compatibility)."""
        if self.websocket_handler:
            self.websocket_handler.connected_clients = value

    def generate_random_item(self) -> Item:
        """Generate a random item (backward compatibility)."""
        if not self.state_manager:
            raise RuntimeError("Game not properly initialized")
        
        # Use the first item definition as a template
        if self.state_manager.definitions.item_defs:
            item_def = self.state_manager.random.choice(self.state_manager.definitions.item_defs)
            return self.player_action_handler._generate_item_from_def(item_def)
        else:
            # Fallback to a basic item
            self.state_manager.item_sequence_cnt += 1
            return Item(
                id=f"random_item_{self.state_manager.item_sequence_cnt}",
                is_equipped=False,
                name="Random Item",
                type="consumable",
                effect={"health": 10},
                description="A randomly generated item."
            )

    def count_explored_tiles(self) -> int:
        """Count the number of explored tiles."""
        return self.state_manager.count_explored_tiles() if self.state_manager else 0

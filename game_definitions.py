import json
import logging
from typing import Dict, List, Optional

from gen_ai import GenAI
from db import db

logger = logging.getLogger()

class GameDefinitionsManager:
    def __init__(self, gen_ai: GenAI, language: str = "en"):
        self.gen_ai = gen_ai
        self.language = language
        self.generator_id = None
        
        # Initialize attributes with defaults
        self.player_defs = []
        self.item_defs = []
        self.enemy_defs = []
        self.celltype_defs = []
        
    async def make_defs_from_json(self, filename: str, transform_fn=None):
        try:
            with open(filename, 'r') as f:
                data = f.read()
                return await transform_fn(data) if transform_fn else json.loads(data)
        except FileNotFoundError:
            logger.error(f"{filename} file not found.")
            return {} if transform_fn else []
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON in {filename} file.")
            return {} if transform_fn else []

    async def initialize_player_defs(self):
        self.player_defs = (await self.make_defs_from_json(
            'game_players.json',
            transform_fn=self.gen_ai.gen_players_from_json_sample
        ))["player_defs"]

    async def initialize_item_defs(self):
        self.item_defs = (await self.make_defs_from_json(
            'game_items.json',
            transform_fn=self.gen_ai.gen_game_items_from_json_sample
        ))["item_defs"]

    async def initialize_enemy_defs(self):
        self.enemy_defs = (await self.make_defs_from_json(
            'game_enemies.json',
            transform_fn=self.gen_ai.gen_game_enemies_from_json_sample
        ))["enemy_defs"]

    async def initialize_celltype_defs(self):
        self.celltype_defs = (await self.make_defs_from_json(
            'game_celltypes.json',
            transform_fn=self.gen_ai.gen_game_celltypes_from_json_sample
        ))["celltype_defs"]

    def load_from_generator(self, generator_id: str) -> bool:
        generator_data = db.get_generator(generator_id)
        if generator_data:
            logger.info(f"Loaded generator with ID: {generator_id}")
            self.player_defs = generator_data['player_defs']
            self.item_defs = generator_data['item_defs']
            self.enemy_defs = generator_data['enemy_defs']
            self.celltype_defs = generator_data['celltype_defs']
            self.generator_id = generator_id
            return True
        return False

    def save_generator(self, theme_desc: str, theme_desc_better: str) -> Optional[str]:
        try:
            self.generator_id = db.save_generator(
                theme_desc=theme_desc,
                theme_desc_better=theme_desc_better,
                language=self.language,
                player_defs=self.player_defs,
                item_defs=self.item_defs,
                enemy_defs=self.enemy_defs,
                celltype_defs=self.celltype_defs
            )
            logger.info(f"Saved generator with ID: {self.generator_id}")
            return self.generator_id
        except Exception as e:
            logger.error(f"Failed to save generator: {str(e)}")
            return None

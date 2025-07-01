import json
import logging
from typing import Dict, List, Optional

from gen_ai import GenAI
from db import db
from pixel_art_generator import PixelArtGenerator

logger = logging.getLogger()

class GameDefinitionsManager:
    def __init__(self, gen_ai: GenAI, language: str = "en", theme_desc: str = "fantasy"):
        self.gen_ai = gen_ai
        self.language = language
        self.theme_desc = theme_desc
        self.generator_id = None

        # Initialize pixel art generator
        self.pixel_art_generator = PixelArtGenerator(gen_ai, theme_desc, language)

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

    async def enhance_with_pixel_art(self):
        """Enhance all definitions with generated pixel art icons."""
        logger.info(f"Starting pixel art enhancement - theme: {self.theme_desc}")
        logger.info(f"Enemy defs count: {len(self.enemy_defs)}")
        logger.info(f"Item defs count: {len(self.item_defs)}")
        logger.info(f"Cell type defs count: {len(self.celltype_defs)}")
        logger.info(f"Player defs count: {len(self.player_defs)}")

        try:
            # Enhance enemy definitions
            logger.info("Starting enemy pixel art enhancement...")
            await self._enhance_enemies_with_pixel_art()

            # Enhance item definitions
            logger.info("Starting item pixel art enhancement...")
            await self._enhance_items_with_pixel_art()

            # Enhance cell type definitions
            logger.info("Starting cell type pixel art enhancement...")
            await self._enhance_celltypes_with_pixel_art()

            # Enhance player definitions
            logger.info("Starting player pixel art enhancement...")
            await self._enhance_players_with_pixel_art()

            logger.info("Successfully enhanced all definitions with pixel art icons")

        except Exception as e:
            logger.error(f"Failed to enhance definitions with pixel art icons: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    async def _enhance_enemies_with_pixel_art(self):
        """Add pixel art icons to enemy definitions."""
        for enemy_def in self.enemy_defs:
            try:
                # Create a description from the enemy data
                description = f"Enemy with {enemy_def.get('hp', {}).get('min', 30)}-{enemy_def.get('hp', {}).get('max', 50)} HP"
                if 'weapons' in enemy_def and enemy_def['weapons']:
                    description += f", uses {', '.join(enemy_def['weapons'][:2])}"

                pixel_data = await self.pixel_art_generator.generate_pixel_art(
                    "enemy",
                    enemy_def['name'],
                    description
                )

                if pixel_data:
                    enemy_def['pixel_art'] = pixel_data
                    enemy_def['pixel_art_data_url'] = self.pixel_art_generator.pixel_art_to_data_url(pixel_data, scale=2)
                    logger.info(f"Generated pixel art icon for enemy: {enemy_def['name']}")
                else:
                    logger.warning(f"Failed to generate pixel art for enemy: {enemy_def['name']}")

            except Exception as e:
                logger.error(f"Error generating pixel art for enemy {enemy_def.get('name', 'unknown')}: {str(e)}")

    async def _enhance_items_with_pixel_art(self):
        """Add pixel art icons to item definitions."""
        for item_def in self.item_defs:
            try:
                # Create description from item data
                description = item_def.get('description', '')
                if 'effect' in item_def:
                    effects = []
                    for key, value in item_def['effect'].items():
                        effects.append(f"+{value} {key}")
                    if effects:
                        description += f" ({', '.join(effects)})"

                pixel_data = await self.pixel_art_generator.generate_pixel_art(
                    "item",
                    item_def['name'],
                    description
                )

                if pixel_data:
                    item_def['pixel_art'] = pixel_data
                    item_def['pixel_art_data_url'] = self.pixel_art_generator.pixel_art_to_data_url(pixel_data, scale=2)
                    logger.info(f"Generated pixel art icon for item: {item_def['name']}")
                else:
                    logger.warning(f"Failed to generate pixel art for item: {item_def['name']}")

            except Exception as e:
                logger.error(f"Error generating pixel art for item {item_def.get('name', 'unknown')}: {str(e)}")

    async def _enhance_celltypes_with_pixel_art(self):
        """Add pixel art icons to cell type definitions."""
        for celltype_def in self.celltype_defs:
            try:
                description = celltype_def.get('description', '')

                pixel_data = await self.pixel_art_generator.generate_pixel_art(
                    "terrain",
                    celltype_def['name'],
                    description
                )

                if pixel_data:
                    celltype_def['pixel_art'] = pixel_data
                    celltype_def['pixel_art_data_url'] = self.pixel_art_generator.pixel_art_to_data_url(pixel_data, scale=2)
                    logger.info(f"Generated pixel art icon for cell type: {celltype_def['name']}")
                else:
                    logger.warning(f"Failed to generate pixel art for cell type: {celltype_def['name']}")

            except Exception as e:
                logger.error(f"Error generating pixel art for cell type {celltype_def.get('name', 'unknown')}: {str(e)}")

    async def _enhance_players_with_pixel_art(self):
        """Add pixel art icons to player definitions."""
        for player_def in self.player_defs:
            try:
                # Create description from player data
                description = f"Player character with {player_def.get('hp', 100)} HP, {player_def.get('attack', 10)} attack"

                pixel_data = await self.pixel_art_generator.generate_pixel_art(
                    "player",
                    player_def['name'],
                    description
                )

                if pixel_data:
                    player_def['pixel_art'] = pixel_data
                    player_def['pixel_art_data_url'] = self.pixel_art_generator.pixel_art_to_data_url(pixel_data, scale=2)
                    logger.info(f"Generated pixel art icon for player: {player_def['name']}")
                else:
                    logger.warning(f"Failed to generate pixel art for player: {player_def['name']}")

            except Exception as e:
                logger.error(f"Error generating pixel art for player {player_def.get('name', 'unknown')}: {str(e)}")

    def update_theme(self, theme_desc: str):
        """Update the theme description and recreate pixel art generator."""
        self.theme_desc = theme_desc
        self.pixel_art_generator = PixelArtGenerator(self.gen_ai, theme_desc, self.language)

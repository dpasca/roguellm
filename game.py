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

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment
from db import db
from tools.fa_runtime import fa_runtime
from game_definitions import GameDefinitionsManager
from combat_manager import CombatManager
from entity_placement_manager import EntityPlacementManager

#OLLAMA_BASE_URL = "http://localhost:11434"
#OLLAMA_API_KEY = "ollama"
#OLLAMA_DEFAULT_MODEL = "llama3.1"

TEST_DUMMY_EQUIP_AND_ITEMS = False

# Use random map (for testing)
USE_RANDOM_MAP = False

class Game:
    def __init__(
            self,
            seed : int,
            theme_desc : str,
            do_web_search: bool = False,
            language : str = "en",
            generator_id: Optional[str] = None
    ):
        self.random = random.Random(seed)  # Create a new Random object with the given seed
        self.error_message = None
        self.item_sequence_cnt = 0
        self.enemy_sequence_cnt = 0  # Add counter for unique enemy IDs
        self.connected_clients = set()
        self.event_history = []
        self.language = language
        self.last_described_ct = None  # Add this line to track previous cell type

        # Model definitions
        #lo_model = GenAIModel(base_url=OLLAMA_BASE_URL + "/v1", api_key=OLLAMA_API_KEY, model_name="llama3.1")
        lo_model = GenAIModel(
            model_name=os.getenv("LOW_SPEC_MODEL_NAME", "gpt-4o-mini"),
            base_url=os.getenv("LOW_SPEC_MODEL_BASE_URL"),
            api_key=os.getenv("LOW_SPEC_MODEL_API_KEY"),
        )
        hi_model = GenAIModel(
            model_name=os.getenv("HIGH_SPEC_MODEL_NAME", "gpt-4o-mini"),
            base_url=os.getenv("HIGH_SPEC_MODEL_BASE_URL"),
            api_key=os.getenv("HIGH_SPEC_MODEL_API_KEY"),
        )

        # GenAI instance, with low and high spec models
        self.gen_ai = GenAI(lo_model=lo_model, hi_model=hi_model)

        # Initialize the definitions manager
        self.definitions = GameDefinitionsManager(self.gen_ai, language)

        # Initialize the combat manager
        self.combat_manager = CombatManager(self.random, self.definitions)

        # Initialize the entity placement manager
        self.entity_manager = EntityPlacementManager(self.random, self.definitions, self.gen_ai)

        self.generator_id = None  # Initialize generator_id
        self.theme_desc = theme_desc
        self.theme_desc_better = None
        self.do_web_search = do_web_search
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
        game = cls(seed, theme_desc, do_web_search, language, generator_id)

        if generator_id:
            # Load from existing generator
            if not game.definitions.load_from_generator(generator_id):
                raise ValueError(f"Generator with ID {generator_id} not found")
            generator_data = db.get_generator(generator_id)
            if generator_data:
                logger.info(f"Loaded generator with ID: {generator_id}")
                game.theme_desc = generator_data['theme_desc']
                game.theme_desc_better = generator_data['theme_desc_better']
                game.language = generator_data['language']
                game.generator_id = generator_id  # Set generator_id when loading existing
            else:
                raise ValueError(f"Generator with ID {generator_id} not found")

        # Set the theme description and language
        logger.info(f"Setting theme description: {theme_desc} with language: {language}")
        game.theme_desc_better = await game.gen_ai.set_theme_description(
            theme_desc=theme_desc,
            theme_desc_better=game.theme_desc_better,
            do_web_search=do_web_search,
            language=language
        )

        # Initialize these after setting the theme description
        if not generator_id:
            async def run_parallel_init():
                # Run all initializations concurrently
                await asyncio.gather(
                    game.definitions.initialize_player_defs(),
                    game.definitions.initialize_item_defs(),
                    game.definitions.initialize_enemy_defs(),
                    game.definitions.initialize_celltype_defs()
                )

            await run_parallel_init()

            logger.info(f"## Generated PLAYER defs:\n{game.definitions.player_defs}\n")
            logger.info(f"## Generated ITEM defs:\n{game.definitions.item_defs}\n")
            logger.info(f"## Generated ENEMY defs:\n{game.definitions.enemy_defs}\n")
            logger.info(f"## Generated CELLTYPE defs:\n{game.definitions.celltype_defs}\n")

            # Save the generator if it was newly created
            game.definitions.save_generator(theme_desc, game.theme_desc_better)
            game.generator_id = db.save_generator(
                theme_desc=theme_desc,
                theme_desc_better=game.theme_desc_better,
                language=game.language,
                player_defs=game.definitions.player_defs,
                item_defs=game.definitions.item_defs,
                enemy_defs=game.definitions.enemy_defs,
                celltype_defs=game.definitions.celltype_defs
            )
            logger.info(f"Saved generator with ID: {game.generator_id}")

        return game

    def get_game_title(self):
        return self.gen_ai.game_title

    def make_defs_from_json(self, filename: str, transform_fn=None):
        try:
            with open(filename, 'r') as f:
                data = f.read()
                return transform_fn(data) if transform_fn else json.loads(data)
        except FileNotFoundError:
            self.log_error(f"{filename} file not found.")
            return {} if transform_fn else []
        except json.JSONDecodeError:
            self.log_error(f"Invalid JSON in {filename} file.")
            return {} if transform_fn else []

    def initialize_player_defs(self):
        self.definitions.player_defs = self.make_defs_from_json(
            'game_players.json',
            transform_fn=self.gen_ai.gen_players_from_json_sample
        )["player_defs"]

    def initialize_item_defs(self):
        self.definitions.item_defs = self.make_defs_from_json(
            'game_items.json',
            transform_fn=self.gen_ai.gen_game_items_from_json_sample
        )["item_defs"]

    def initialize_enemy_defs(self):
        self.definitions.enemy_defs = self.make_defs_from_json(
            'game_enemies.json',
            transform_fn=self.gen_ai.gen_game_enemies_from_json_sample
        )["enemy_defs"]

    def initialize_celltype_defs(self):
        self.definitions.celltype_defs = self.make_defs_from_json(
            'game_celltypes.json',
            transform_fn=self.gen_ai.gen_game_celltypes_from_json_sample
        )["celltype_defs"]

    def _load_game_data(self):
        """Load all game data from JSON files."""
        with open('game_celltypes.json', 'r') as f:
            celltype_defs = json.load(f)
            # Icons are already validated by gen_ai
            self.definitions.celltype_defs = self.gen_ai.gen_game_celltypes_from_json_sample(json.dumps(celltype_defs))

        with open('game_config.json', 'r') as f:
            self.game_config = json.load(f)
            # Validate FontAwesome icons
            self.game_config = fa_runtime.process_game_data(self.game_config)

    def make_random_map(self):
        return [
            [self.random.choice(self.definitions.celltype_defs) for _ in range(self.state.map_width)]
            for _ in range(self.state.map_height)
        ]

    async def initialize_game_placements(self):
        # Generate entity placements (both enemies and items)
        try:
            self.entity_placements = await self.entity_manager.generate_placements(
                self.state.cell_types,
                self.state.map_width,
                self.state.map_height
            )

            # Process the placements
            self.entity_manager.process_placements(self.state)
        except Exception as e:
            logger.error(f"Failed to generate entity placements: {str(e)}")
            self.entity_placements = []
            self.state.enemies = []
            self.state.defeated_enemies = []

    async def initialize_game(self):
        # Read config.json
        with open('game_config.json', 'r') as f:
            config = json.load(f)

        self.state = GameState.from_config(config) # Initialize GameState with "config"
        # Set player data with fallback to default
        self.state.player = self.definitions.player_defs[0] if self.definitions.player_defs else {
            "name": "Unknown Hero",
            "class": "adventurer",
            "font_awesome_icon": "fa-solid fa-user"
        }
        # Validate player icon if using default
        if not self.definitions.player_defs:
            self.state.player = fa_runtime.process_game_data(self.state.player, "player")

        self.state.explored = [[False for _ in range(self.state.map_width)]
                             for _ in range(self.state.map_height)]
        self.state.inventory = []
        self.state.equipment = Equipment()
        self.state.game_over = False
        self.state.game_won = False
        self.state.game_title = self.get_game_title()
        logging.info(f"Game title set to: {self.state.game_title}")

        # Initialize cell types
        if USE_RANDOM_MAP:
            logger.warning("Using random map")
            self.state.cell_types = self.make_random_map()
        else:
            try:
                self.state.cell_types = await self.gen_ai.gen_game_map_from_celltypes(
                    self.definitions.celltype_defs,
                    self.state.map_width,
                    self.state.map_height
                )

            except ValueError as e:
                logger.error(f"Failed to generate AI map: {str(e)}. Falling back to random map.")
                # Fallback to random map generation
                self.state.cell_types = self.make_random_map()

        # Initialize entity placements
        await self.initialize_game_placements()

        if TEST_DUMMY_EQUIP_AND_ITEMS:
            self.state.inventory = [self.generate_random_item() for _ in range(5)]
            # Find a weapon and an armor
            weapon = next((item for item in self.state.inventory if item.type == 'weapon'), None)
            armor = next((item for item in self.state.inventory if item.type == 'armor'), None)
            if weapon and armor:
                await self.handle_equip_item(weapon.id)
                await self.handle_equip_item(armor.id)

        initial_update = await self.create_message(
            f"You find yourself at the initial location of {self.get_game_title()}."
        )

        return initial_update

    #==================================================================
    # Events
    #==================================================================
    def events_reset(self):
        self.event_history = []

    def events_add(self, action: str, event_dict: dict):
        self.event_history.append({
            'action': action,
            'event': event_dict
        })

    async def create_message(self, description_raw: str, description: str = ""):
        return {
            'type': 'update',
            'state': self.state.dict(),
            'description_raw': description_raw,
            'description': description
        }

    async def create_message_room(self):
        logger.info("## Creating room description")
        #logger.info(f"- State dict: {self.state.dict()}\n")
        desc = await self._gen_room_description()
        return {
            'type': 'update',
            'state': self.state.dict(),
            'description_raw': desc,
            'description': desc
        }

    async def create_message_description(self, message):
        if 'description' not in message or message['description'] == "":
            logger.info(f"Description not found, will generate one from: {message['description_raw']}")
            message['description'] = await self._gen_adapt_sentence(message['description_raw'])
            logger.info(f"Generated description: {message['description']}")
        else:
            logger.info(f"Description found: {message['description']}")

        return message

    # Generate a random item from the item templates
    def generate_random_item(self) -> Item:
        defn = self.random.choice(self.definitions.item_defs)
        self.item_sequence_cnt += 1
        return Item(
            id=f"{defn['id']}_{self.item_sequence_cnt}",
            is_equipped=False,
            name=defn['name'],
            type=defn['type'],
            effect=defn['effect'],
            description=defn['description']
        )

    async def handle_message(self, message: dict) -> dict:
        action = message.get('action')

        # Only initialize if it's an initialize action or if state doesn't exist
        if action == 'initialize' or not hasattr(self, 'state'):
            return await self.create_message_description(await self.initialize_game())

        # Handle get_initial_state - just return current state without reinitializing
        if action == 'get_initial_state':
            return await self.create_message("")

        if action == 'restart':
            self.events_reset()
            return await self.create_message_description(await self.initialize_game())

        # Check game over and win states before processing any other action
        if self.state.game_over:
            result = await self.create_message("Game Over! Press Restart to play again.")
            result = await self.create_message_description(result)
            self.events_add('game_over', result)
            return result

        if self.state.game_won:
            result = await self.create_message("Congratulations! You have won the game! Press Restart to play again.")
            result = await self.create_message_description(result)
            self.events_add('game_won', result)
            return result

        result = None
        if action == 'move' and not self.state.in_combat:
            result = await self.handle_move(message.get('direction'))
        elif action == 'attack' and self.state.in_combat:
            result = await self.handle_combat_action('attack')
        elif action == 'run' and self.state.in_combat:
            result = await self.handle_combat_action('run')
        elif action == 'use_item':
            result = await self.handle_use_item(message.get('item_id'))
        elif action == 'equip_item':
            result = await self.handle_equip_item(message.get('item_id'))
        elif action == 'initialize':
            result = await self.initialize_game()
        elif action == 'get_initial_state':
            # This is used just to get the map initialized
            return await self.create_message("")

        # Create a generic message if result is still None
        if result is None:
            desc = f"Unknown action: {action}"
            result = await self.create_message(description=desc, description_raw=desc)

        # Skip adding the event if the description is empty
        if result.get('description_raw') == "":
            return result

        # Create or fill 'description' field if not already present or if empty
        result = await self.create_message_description(result)
        self.events_add(action, result) # Record the event
        return result

    async def handle_use_item(self, item_id: str) -> dict:
        if not item_id:
            return await self.create_message("No item specified!")

        # Find the item in inventory
        item = next((item for item in self.state.inventory if item.id == item_id), None)
        if not item:
            return await self.create_message("Item not found in inventory!")

        if item.type == 'consumable':
            # Remove the consumable immediately as it will be consumed
            self.state.inventory = [i for i in self.state.inventory if i.id != item_id]

            if 'health' in item.effect:
                heal_amount = item.effect['health']
                old_hp = self.state.player_hp
                self.state.player_hp = min(self.state.player_max_hp,
                                        self.state.player_hp + heal_amount)
                actual_heal = self.state.player_hp - old_hp
                return await self.create_message(f"Used {item.name} and restored {actual_heal} HP!")
            elif 'attack' in item.effect:
                attack_boost = item.effect['attack']
                duration = item.effect.get('duration', 3)  # Default to 3 turns if not specified

                # Store the temporary effect
                self.state.temporary_effects['strength'] = {
                    'type': 'attack',
                    'amount': attack_boost,
                    'turns_remaining': duration
                }

                # Apply the boost
                self.state.player_attack += attack_boost
                return await self.create_message(f"Used {item.name}! Attack increased by {attack_boost} for {duration} turns!")
            elif 'defense' in item.effect:
                defense_boost = item.effect['defense']
                duration = item.effect.get('duration', 3)  # Default to 3 turns if not specified

                # Store the temporary effect
                self.state.temporary_effects['protection'] = {
                    'type': 'defense',
                    'amount': defense_boost,
                    'turns_remaining': duration
                }

                # Apply the boost
                self.state.player_defense += defense_boost
                return await self.create_message(f"Used {item.name}! Defense increased by {defense_boost} for {duration} turns!")

        return await self.create_message(f"Cannot use this type of item!")

    async def handle_equip_item(self, item_id: str) -> dict:
        if not item_id:
            return await self.create_message("No item specified!")

        # Find the item in inventory
        item = next((item for item in self.state.inventory if item.id == item_id), None)
        if not item:
            return await self.create_message("Item not found in inventory!")

        if item.type in ['weapon', 'armor']:
            if item.is_equipped:
                return await self.create_message("") # Empty message if already equipped

            # Unequip current item of same type if any
            if item.type == 'weapon':
                if self.state.equipment.weapon:
                    old_item = self.state.equipment.weapon
                    old_item.is_equipped = False
                    self.state.player_attack -= old_item.effect.get('attack', 0)
                self.state.equipment.weapon = item
                self.state.player_attack += item.effect.get('attack', 0)
            else:  # armor
                if self.state.equipment.armor:
                    old_item = self.state.equipment.armor
                    old_item.is_equipped = False
                    self.state.player_defense -= old_item.effect.get('defense', 0)
                self.state.equipment.armor = item
                self.state.player_defense += item.effect.get('defense', 0)

            item.is_equipped = True
            return await self.create_message(f"Equipped {item.name}!")

        return await self.create_message(f"This item cannot be equipped!")

    def generate_enemy_from_def(self, enemy_def: dict) -> Enemy:
        return self.combat_manager.generate_enemy_from_def(enemy_def)

    async def handle_combat_action(self, action: str) -> dict:
        return await self.create_message(await self.combat_manager.handle_combat_action(self.state, action))

    async def process_temporary_effects(self) -> str:
        """Process temporary effects and return a log of what happened."""
        effects_log = []
        effects_to_remove = []

        for effect_name, effect in self.state.temporary_effects.items():
            effect['turns_remaining'] -= 1

            if effect['turns_remaining'] <= 0:
                effects_to_remove.append(effect_name)
                if effect['type'] == 'attack':
                    self.state.player_attack -= effect['amount']
                    effects_log.append(f"The {effect_name} effect has worn off")
                elif effect['type'] == 'defense':
                    self.state.player_defense -= effect['amount']
                    effects_log.append(f"The {effect_name} effect has worn off")

        for effect_name in effects_to_remove:
            del self.state.temporary_effects[effect_name]

        return "\n".join(effects_log) if effects_log else ""

    async def handle_move(self, direction: str) -> dict:
        if not direction:
            return await self.create_message("No direction specified!")

        if self.state.game_won or self.state.game_over:
            return await self.create_message("Game is over! Press Restart to play again.")

        # Save previous position
        self.state.player_pos_prev = self.state.player_pos
        # Get current position
        x, y = self.state.player_pos
        # Set the current position as explored
        self.state.explored[y][x] = True
        moved = True
        if direction == 'n' and y > 0:
            y -= 1
        elif direction == 's' and y < self.state.map_height - 1:
            y += 1
        elif direction == 'w' and x > 0:
            x -= 1
        elif direction == 'e' and x < self.state.map_width - 1:
            x += 1
        else:
            moved = False

        if moved:
            self.state.player_pos = (x, y)
            encounter_result = await self.check_encounters()

            # Process temporary effects
            effects_log = await self.process_temporary_effects()
            if effects_log:
                encounter_result['description_raw'] = effects_log + "\n" + encounter_result['description_raw']

            return encounter_result
        else:
            return await self.create_message("You can't move in that direction.")

    # Check for encounters
    async def check_encounters(self) -> dict:
        x, y = self.state.player_pos
        # Check if there's a pre-placed enemy at this location
        enemy_here = next(
            (p for p in self.entity_placements if p['x'] == x and p['y'] == y and p['type'] == 'enemy'),
            None
        )

        if enemy_here:
            # Find the enemy definition
            enemy_def = next(
                (e for e in self.definitions.enemy_defs if e['enemy_id'] == enemy_here['entity_id']),
                None
            )
            if enemy_def:
                # Generate the enemy from the definition
                enemy = self.generate_enemy_from_def(enemy_def)
                self.state.current_enemy = enemy
                self.state.in_combat = True

                # Check if this enemy was previously defeated
                was_defeated = any(
                    de['x'] == x and de['y'] == y
                    for de in self.state.defeated_enemies
                )

                # Add enemy to state.enemies list
                existing_enemy = next((e for e in self.state.enemies if e['x'] == x and e['y'] == y), None)
                if existing_enemy:
                    existing_enemy['id'] = enemy.id
                    existing_enemy['name'] = enemy.name
                    existing_enemy['font_awesome_icon'] = enemy.font_awesome_icon
                    existing_enemy['is_defeated'] = was_defeated
                else:
                    self.state.enemies.append({
                        'id': enemy.id,
                        'x': x,
                        'y': y,
                        'name': enemy.name,
                        'font_awesome_icon': enemy.font_awesome_icon,
                        'is_defeated': was_defeated
                    })

                # If it was defeated, add to defeated_enemies if not already there
                if was_defeated and not any(de['id'] == enemy.id for de in self.state.defeated_enemies):
                    self.state.defeated_enemies.append({
                        'x': x,
                        'y': y,
                        'name': enemy.name,
                        'id': enemy.id,
                        'font_awesome_icon': enemy.font_awesome_icon,
                        'is_defeated': True
                    })
                logger.info(f"Updated enemies: {self.state.enemies}")
                logger.info(f"Updated defeated enemies: {self.state.defeated_enemies}")

                # Don't enter combat if the enemy was already defeated
                if was_defeated:
                    self.state.current_enemy = None
                    self.state.in_combat = False

                # Only remove enemy placement if it was defeated
                if was_defeated:
                    self.entity_placements = [
                        p for p in self.entity_placements
                        if not (p['x'] == x and p['y'] == y and p['type'] == 'enemy')
                    ]

                if was_defeated:
                    return await self.create_message(
                        f"You see a defeated {enemy.name} here."
                    )
                else:
                    return await self.create_message(
                        f"A {enemy.name} appears! (HP: {enemy.hp}, Attack: {enemy.attack})"
                    )

        # Check if there's a pre-placed item at this location
        item_here = next(
            (p for p in self.entity_placements if p['x'] == x and p['y'] == y and p['type'] == 'item'),
            None
        )

        if item_here:
            # Find the item definition
            item_def = next(
                (i for i in self.definitions.item_defs if i['id'] == item_here['entity_id']),
                None
            )
            if item_def:
                # Generate the item from the definition
                item = self.generate_item_from_def(item_def)

                # Check for duplicates if item is not consumable
                if item.type in ['weapon', 'armor']:
                    existing_item = next(
                        (i for i in self.state.inventory if i.name == item.name),
                        None
                    )
                    if existing_item:
                        # Remove this item placement since we found it
                        self.entity_placements = [
                            p for p in self.entity_placements
                            if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                        ]
                        return await self.create_message(
                            f"You found another {item.name}, but you already have one."
                        )

                # Add item to inventory and remove from placements
                self.state.inventory.append(item)
                self.entity_placements = [
                    p for p in self.entity_placements
                    if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                ]
                return await self.create_message(
                    f"You found a {item.name}! {item.description}"
                )

        # Only get room description if we're in a new cell type or don't have a previous description
        px = self.state.player_pos[0]
        py = self.state.player_pos[1]
        cur_ct = self.state.cell_types[py][px]
        if self.last_described_ct != cur_ct:
            self.last_described_ct = cur_ct
            return await self.create_message_room()
        else:
            # Return empty description if in same room type
            return await self.create_message('')

    def generate_item_from_def(self, item_def: dict) -> Item:
        """Generate an item from a specific item definition."""
        self.item_sequence_cnt += 1
        return Item(
            id=f"{item_def['id']}_{self.item_sequence_cnt}",
            is_equipped=False,
            name=item_def['name'],
            type=item_def['type'],
            effect=item_def['effect'],
            description=item_def['description']
        )

    async def _gen_adapt_sentence(self, original_sentence: str) -> str:
        try:
            return await self.gen_ai.gen_adapt_sentence(self.state, self.event_history, original_sentence)
        except Exception as e:
            self.log_error(f"Exception in _gen_adapt_sentence: {str(e)}")
            return original_sentence

    async def _gen_room_description(self) -> str:
        try:
            return await self.gen_ai.gen_room_description(self.state, self.event_history)
        except Exception as e:
            self.log_error(f"Exception in _gen_room_description: {str(e)}")
            return "Error generating room description!"

    def log_error(self, error_message):
        logger.error(error_message)
        self.error_message = error_message  # Store the error message

    def count_explored_tiles(self) -> int:
        return sum(sum(1 for cell in row if cell) for row in self.state.explored)

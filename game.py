import json
import random
import time

import logging
logger = logging.getLogger()

from typing import Dict, List, Optional, Union
import concurrent.futures

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment
from db import db

#OLLAMA_BASE_URL = "http://localhost:11434"
#OLLAMA_API_KEY = "ollama"
#OLLAMA_DEFAULT_MODEL = "llama3.1"

TEST_DUMMY_EQUIP_AND_ITEMS = False

# Use random map (for testing)
USE_RANDOM_MAP = False

# Model definitions
#_lo_model = GenAIModel(base_url=OLLAMA_BASE_URL + "/v1", api_key=OLLAMA_API_KEY, model_name="llama3.1")
_lo_model = GenAIModel(model_name="gpt-4o-mini")
_hi_model = GenAIModel(model_name="gpt-4o")

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
        self.connected_clients = set()
        self.event_history = []
        self.language = language
        self.generator_id = generator_id
        self.last_described_ct = None  # Add this line to track previous cell type

        # Initialize attributes with defaults in case of failure
        self.player_defs = []
        self.item_defs = []
        self.enemy_defs = []
        self.celltype_defs = []

        # GenAI instance, with low and high spec models
        self.gen_ai = GenAI(lo_model=_lo_model, hi_model=_hi_model)

        theme_desc_better = None
        if generator_id:
            # Load from existing generator
            generator_data = db.get_generator(generator_id)
            if generator_data:
                logger.info(f"Loaded generator with ID: {generator_id}")
                self.player_defs = generator_data['player_defs']
                self.item_defs = generator_data['item_defs']
                self.enemy_defs = generator_data['enemy_defs']
                self.celltype_defs = generator_data['celltype_defs']
                theme_desc = generator_data['theme_desc']
                theme_desc_better = generator_data['theme_desc_better']
                language = generator_data['language']
            else:
                raise ValueError(f"Generator with ID {generator_id} not found")

        # Set the theme description and language
        logger.info(f"Setting theme description: {theme_desc} with language: {language}")
        theme_desc_better = self.gen_ai.set_theme_description(
            theme_desc=theme_desc,
            theme_desc_better=theme_desc_better,
            do_web_search=do_web_search,
            language=language
        )

        # Initialize these after setting the theme description
        if not generator_id:
            def run_parallel_init():
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    futures = {
                        'players': executor.submit(self.initialize_player_defs),
                        'items': executor.submit(self.initialize_item_defs),
                        'enemies': executor.submit(self.initialize_enemy_defs),
                        'celltypes': executor.submit(self.initialize_celltype_defs)
                    }

                    for name, future in futures.items():
                        try:
                            future.result()  # This will raise any exceptions that occurred
                        except Exception as e:
                            logger.error(f"Failed to initialize {name}: {str(e)}")

            run_parallel_init()
            logger.info(f"Generated Player defs: {self.player_defs}")
            logger.info(f"Generated Item defs: {self.item_defs}")
            logger.info(f"Generated Enemy defs: {self.enemy_defs}")
            logger.info(f"Generated Celltype defs: {self.celltype_defs}")

            # Save the generator if it was newly created
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
            except Exception as e:
                logger.error(f"Failed to save generator: {str(e)}")

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
        self.player_defs = self.make_defs_from_json(
            'game_players.json',
            transform_fn=self.gen_ai.gen_players_from_json_sample
        )["player_defs"]

    def initialize_item_defs(self):
        self.item_defs = self.make_defs_from_json(
            'game_items.json',
            transform_fn=self.gen_ai.gen_game_items_from_json_sample
        )["item_defs"]

    def initialize_enemy_defs(self):
        self.enemy_defs = self.make_defs_from_json(
            'game_enemies.json',
            transform_fn=self.gen_ai.gen_game_enemies_from_json_sample
        )["enemy_defs"]

    def initialize_celltype_defs(self):
        self.celltype_defs = self.make_defs_from_json(
            'game_celltypes.json',
            transform_fn=self.gen_ai.gen_game_celltypes_from_json_sample
        )["celltype_defs"]

    def make_random_map(self):
        return [
            [self.random.choice(self.celltype_defs) for _ in range(self.state.map_width)]
            for _ in range(self.state.map_height)
        ]

    async def initialize_game(self):
        # Read config.json
        with open('game_config.json', 'r') as f:
            config = json.load(f)

        self.state = GameState.from_config(config) # Initialize GameState with "config"
        # Set player data with fallback to default
        self.state.player = self.player_defs[0] if self.player_defs else {
            "name": "Unknown Hero",
            "class": "adventurer",
            "font_awesome_icon": "fa-solid fa-user"
        }
        self.state.explored = [[False for _ in range(self.state.map_width)]
                             for _ in range(self.state.map_height)]
        self.state.inventory = []
        self.state.equipment = Equipment()
        self.state.game_over = False
        self.state.game_title = self.get_game_title()
        logging.info(f"Game title set to: {self.state.game_title}")

        # Initialize cell types
        if USE_RANDOM_MAP:
            logger.info("Using random map")
            self.state.cell_types = self.make_random_map()
        else:
            try:
                self.state.cell_types = self.gen_ai.gen_game_map_from_celltypes(
                    self.celltype_defs,
                    self.state.map_width,
                    self.state.map_height
                )

            except ValueError as e:
                logger.error(f"Failed to generate AI map: {str(e)}. Falling back to random map.")
                # Fallback to random map generation
                self.state.cell_types = self.make_random_map()

        # Generate entity placements (both enemies and items)
        try:
            self.entity_placements = self.gen_ai.gen_entity_placements(
                self.state.cell_types,
                self.enemy_defs,
                self.item_defs,
                self.state.map_width,
                self.state.map_height
            )
            logger.info(f"Generated entity placements: {self.entity_placements}")

            # Initialize lists
            self.state.enemies = []
            self.item_placements = []
            
            # Process each entity placement
            for placement in self.entity_placements:
                if placement['type'] == 'enemy':
                    enemy_def = next((e for e in self.enemy_defs if e['enemy_id'] == placement['entity_id']), None)
                    if enemy_def:
                        self.state.enemies.append({
                            'x': placement['x'],
                            'y': placement['y'],
                            'name': enemy_def['name'],
                            'font_awesome_icon': enemy_def['font_awesome_icon']
                        })
                elif placement['type'] == 'item':
                    self.item_placements.append({
                        'x': placement['x'],
                        'y': placement['y'],
                        'id': placement['entity_id']
                    })
        except Exception as e:
            logger.error(f"Failed to generate entity placements: {str(e)}")
            self.entity_placements = []
            self.item_placements = []

        if TEST_DUMMY_EQUIP_AND_ITEMS:
            self.state.inventory = [self.generate_random_item() for _ in range(5)]
            # Find a weapon and an armor
            weapon = next((item for item in self.state.inventory if item.type == 'weapon'), None)
            armor = next((item for item in self.state.inventory if item.type == 'armor'), None)
            if weapon and armor:
                await self.handle_equip_item(weapon.id)
                await self.handle_equip_item(armor.id)

        initial_update = await self.create_update(
            f"You find yourself at the initial location of {self.get_game_title()}."
        )
        self.state.explored[0][0] = True

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

    async def create_update(self, original_sentence: str):
        return {
            'type': 'update',
            'state': self.state.dict(),
            'description': await self.gen_adapt_sentence(original_sentence)
        }

    async def create_update_room(self):
        return {
            'type': 'update',
            'state': self.state.dict(),
            'description': await self.get_room_description()
        }

    # Generate a random item from the item templates
    def generate_random_item(self) -> Item:
        defn = self.random.choice(self.item_defs)
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
            return await self.initialize_game()

        # Handle get_initial_state - just return current state without reinitializing
        if action == 'get_initial_state':
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': ""
            }

        if action == 'restart':
            self.events_reset()
            return await self.initialize_game()

        if self.state.game_over:
            # TODO: Add stats and other info (win/lose, reached XP, killed enemies, etc.)
            result = await self.create_update("Game Over! Press Restart to play again.")
            self.events_add('game_over', result) # Record the event
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
            result = {
                'type': 'update',
                'state': self.state.dict(),
                'description': ""
            }
            return result

        if result is None:
            result = {
                'type': 'update',
                'state': self.state.dict(),
                'description': f"Unknown action: {action}"
            }

        # Skip adding the event if the description is empty
        if action == 'move' and result.get('description') == "":
            return result

        self.events_add(action, result) # Record the event
        return result

    async def handle_use_item(self, item_id: str) -> dict:
        if not item_id:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "No item specified!"
            }

        # Find the item in inventory
        item = next((item for item in self.state.inventory if item.id == item_id), None)
        if not item:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "Item not found in inventory!"
            }

        if item.type == 'consumable':
            # Remove the consumable immediately as it will be consumed
            self.state.inventory = [i for i in self.state.inventory if i.id != item_id]

            if 'health' in item.effect:
                heal_amount = item.effect['health']
                old_hp = self.state.player_hp
                self.state.player_hp = min(self.state.player_max_hp,
                                        self.state.player_hp + heal_amount)
                actual_heal = self.state.player_hp - old_hp
                return {
                    'type': 'update',
                    'state': self.state.dict(),
                    'description': f"Used {item.name} and restored {actual_heal} HP!"
                }
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
                return {
                    'type': 'update',
                    'state': self.state.dict(),
                    'description': f"Used {item.name}! Attack increased by {attack_boost} for {duration} turns!"
                }
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
                return {
                    'type': 'update',
                    'state': self.state.dict(),
                    'description': f"Used {item.name}! Defense increased by {defense_boost} for {duration} turns!"
                }

        return {
            'type': 'update',
            'state': self.state.dict(),
            'description': f"Cannot use this type of item!"
        }

    async def handle_equip_item(self, item_id: str) -> dict:
        if not item_id:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "No item specified!"
            }

        # Find the item in inventory
        item = next((item for item in self.state.inventory if item.id == item_id), None)
        if not item:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "Item not found in inventory!"
            }

        if item.type in ['weapon', 'armor']:
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
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': f"Equipped {item.name}!"
            }

        return {
            'type': 'update',
            'state': self.state.dict(),
            'description': f"This item cannot be equipped!"
        }

    async def process_temporary_effects(self) -> str:
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
        # Save previous position
        self.state.player_pos_prev = self.state.player_pos
        # Get current position
        x, y = self.state.player_pos
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
            # Set after encounter check so that the room is not marked
            # as explored from the first time
            self.state.explored[y][x] = True

            # Process temporary effects
            effects_log = await self.process_temporary_effects()
            if effects_log:
                encounter_result['description'] = effects_log + "\n" + encounter_result['description']

            return encounter_result
        else:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "You can't move in that direction."
            }

    def generate_enemy(self) -> Enemy:
        enemy_def = self.random.choice(self.enemy_defs)
        hp = self.random.randint(enemy_def['hp']['min'], enemy_def['hp']['max'])

        enemy = Enemy(
            name=enemy_def['name'],
            hp=hp,
            max_hp=hp,
            attack=self.random.randint(enemy_def['attack']['min'], enemy_def['attack']['max']),
            font_awesome_icon=enemy_def['font_awesome_icon']
        )
        # Store XP value as a private attribute
        enemy._xp_reward = enemy_def['xp']
        return enemy

    async def check_encounters(self) -> dict:
        # Read config.json
        with open('game_config.json', 'r') as f:
            config = json.load(f)

        x, y = self.state.player_pos

        # Check if there's a pre-placed enemy at this location
        enemy_here = next(
            (p for p in self.entity_placements if p['x'] == x and p['y'] == y and p['type'] == 'enemy'),
            None
        )

        if enemy_here:
            # Find the enemy definition
            enemy_def = next(
                (e for e in self.enemy_defs if e['enemy_id'] == enemy_here['entity_id']),
                None
            )
            if enemy_def:
                # Generate the enemy from the definition
                enemy = self.generate_enemy_from_def(enemy_def)
                self.state.current_enemy = enemy
                self.state.in_combat = True
                # Remove this enemy placement so it doesn't respawn
                self.entity_placements = [
                    p for p in self.entity_placements
                    if not (p['x'] == x and p['y'] == y and p['type'] == 'enemy')
                ]
                return await self.create_update(
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
                (i for i in self.item_defs if i['id'] == item_here['entity_id']),
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
                        return await self.create_update(
                            f"You found another {item.name}, but you already have one."
                        )

                # Add item to inventory and remove from placements
                self.state.inventory.append(item)
                self.entity_placements = [
                    p for p in self.entity_placements
                    if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                ]
                return await self.create_update(
                    f"You found a {item.name}! {item.description}"
                )

        # Only get room description if we're in a new cell type or don't have a previous description
        px = self.state.player_pos[0]
        py = self.state.player_pos[1]
        cur_ct = self.state.cell_types[py][px]
        if self.last_described_ct != cur_ct:
            self.last_described_ct = cur_ct
            return await self.create_update_room()
        else:
            # Return empty description if in same room type
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': ""
            }

    def generate_enemy_from_def(self, enemy_def: dict) -> Enemy:
        """Generate an enemy from a specific enemy definition."""
        hp = self.random.randint(enemy_def['hp']['min'], enemy_def['hp']['max'])

        enemy = Enemy(
            name=enemy_def['name'],
            hp=hp,
            max_hp=hp,
            attack=self.random.randint(
                enemy_def['attack']['min'],
                enemy_def['attack']['max']
            ),
            font_awesome_icon=enemy_def['font_awesome_icon']
        )
        # Store XP value as a private attribute
        enemy._xp_reward = enemy_def['xp']
        return enemy

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

    async def handle_combat_action(self, action: str) -> dict:
        if not self.state.in_combat or not self.state.current_enemy:
            return await self.create_update("No enemy to fight!")

        if action == 'attack':
            # Player attacks
            damage_dealt = self.random.randint(
                self.state.player_attack - 5,
                self.state.player_attack + 5
            )
            self.state.current_enemy.hp -= damage_dealt
            combat_log = f"You deal {damage_dealt} damage to the {self.state.current_enemy.name}!"

            # Check if enemy is defeated
            if self.state.current_enemy.hp <= 0:
                # Award XP for defeating the enemy
                xp_gained = getattr(self.state.current_enemy, '_xp_reward', 20)  # Default 20 XP if not set
                self.state.player_xp += xp_gained

                # Restore some HP (25% of max HP)
                hp_restored = max(1, int(self.state.player_max_hp * 0.25))
                old_hp = self.state.player_hp
                self.state.player_hp = min(self.state.player_max_hp, self.state.player_hp + hp_restored)
                actual_restore = self.state.player_hp - old_hp

                self.state.in_combat = False
                self.state.current_enemy = None

                # Append enemy defeat to the combat log
                combat_log += f"\nYou have defeated the enemy. Gained XP: {xp_gained}. Restored HP: {actual_restore}"
                # Append temporary effects log
                if effects_log := await self.process_temporary_effects():
                    combat_log += f"\n{effects_log}"

                return await self.create_update(combat_log)

            # Enemy attacks back
            base_damage = self.random.randint(
                self.state.current_enemy.attack - 3,
                self.state.current_enemy.attack + 3
            )
            # Apply defense reduction
            actual_damage = max(1, base_damage - self.state.player_defense)
            self.state.player_hp -= actual_damage
            combat_log += f"\nThe {self.state.current_enemy.name} deals {actual_damage} damage to you!"

            # Check if player is defeated
            if self.state.player_hp <= 0:
                self.state.player_hp = 0
                self.state.game_over = True
                self.state.in_combat = False
                # Include explored tiles in the state update instead of setting it directly
                game_state = self.state.dict()
                game_state['explored_tiles'] = self.count_explored_tiles()
                return {
                    'type': 'update',
                    'state': game_state,
                    'description': f"{combat_log}\nYou have been defeated! Game Over!"
                }

            # Process temporary effects
            effects_log = await self.process_temporary_effects()
            if effects_log:
                combat_log += f"\n{effects_log}"

            return await self.create_update(combat_log)

        elif action == 'run':
            if self.random.random() < 0.6:  # 60% chance to escape
                self.state.in_combat = False
                self.state.current_enemy = None

                # Process temporary effects when running
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    return await self.create_update(f"You successfully flee from battle!\n{effects_log}")
                else:
                    return await self.create_update("You successfully flee from battle!")
            else:
                # Failed to escape, enemy gets a free attack
                damage = self.random.randint(
                    self.state.current_enemy.attack - 3,
                    self.state.current_enemy.attack + 3
                )
                actual_damage = max(1, damage - self.state.player_defense)
                self.state.player_hp -= actual_damage

                # Check if player is defeated
                if self.state.player_hp <= 0:
                    self.state.player_hp = 0
                    self.state.game_over = True
                    self.state.in_combat = False
                    return await self.create_update(
                        f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!\nYou have been defeated! Game Over!")

                # Process temporary effects after failed escape
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    return await self.create_update(
                        f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!\n{effects_log}")
                else:
                    return await self.create_update(
                        f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!")

    async def gen_adapt_sentence(self, original_sentence: str) -> str:
        try:
            return self.gen_ai.gen_adapt_sentence(self.state, self.event_history, original_sentence)
        except Exception as e:
            logging.exception("Exception in gen_adapt_sentence")
            return original_sentence

    async def get_room_description(self) -> str:
        try:
            return self.gen_ai.gen_room_description(self.state, self.event_history)
        except Exception as e:
            logging.exception("Exception in get_room_description")
            return "Error generating room description!"

    def log_error(self, error_message):
        print(f"Error: {error_message}")
        self.error_message = error_message  # Store the error message

    def count_explored_tiles(self) -> int:
        return sum(sum(1 for cell in row if cell) for row in self.state.explored)

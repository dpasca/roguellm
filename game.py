import json
import random
import time

import logging
logger = logging.getLogger()

from typing import Dict, List, Optional, Union
import concurrent.futures

from gen_ai import GenAI, GenAIModel
from models import GameState, Enemy, Item, Equipment

#OLLAMA_BASE_URL = "http://localhost:11434"
#OLLAMA_API_KEY = "ollama"
#OLLAMA_DEFAULT_MODEL = "llama3.1"

# Model definitions
#_lo_model = GenAIModel(base_url=OLLAMA_BASE_URL + "/v1", api_key=OLLAMA_API_KEY, model_name="llama3.1")
_lo_model = GenAIModel(model_name="gpt-4o-mini")
_hi_model = GenAIModel(model_name="gpt-4o")
# GenAI instance, with low and high spec models
_gen_ai = GenAI(lo_model=_lo_model, hi_model=_hi_model)

class Game:
    def __init__(self, seed : int, theme_desc : str, language : str = "en"):
        self.random = random.Random(seed)  # Create a new Random object with the given seed
        self.error_message = None
        self.item_sequence_cnt = 0
        self.connected_clients = set()
        self.event_history = []
        self.language = language

        # Set the theme description and language
        logger.info(f"Setting theme description: {theme_desc} with language: {language}")
        _gen_ai.set_theme_description(theme_desc, language)

        # Initialize these after setting the theme description
        def run_parallel_init():
            with concurrent.futures.ThreadPoolExecutor() as executor:
                i_fut = executor.submit(self.initialize_item_defs)
                e_fut = executor.submit(self.initialize_enemy_defs)
                concurrent.futures.wait([i_fut, e_fut])

        run_parallel_init()
        logger.info(f"Generated Item defs: {self.item_defs}")
        logger.info(f"Generated Enemy defs: {self.enemy_defs}")

    def get_game_title(self):
        return _gen_ai.game_title

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

    def initialize_item_defs(self):
        self.item_defs = self.make_defs_from_json(
            'game_items.json',
            transform_fn=_gen_ai.gen_game_items_from_json_sample
        )["item_defs"]

    def initialize_enemy_defs(self):
        self.enemy_defs = self.make_defs_from_json(
            'game_enemies.json',
            transform_fn=_gen_ai.gen_game_enemies_from_json_sample
        )["enemy_defs"]

    async def initialize_game(self):
        # Read config.json
        with open('game_config.json', 'r') as f:
            config = json.load(f)

        self.state = GameState.from_config(config) # Initialize GameState with "config"
        self.state.explored = [[False for _ in range(self.state.map_width)]
                             for _ in range(self.state.map_height)]
        self.state.inventory = []
        self.state.equipment = Equipment()
        self.state.game_over = False
        self.state.game_title = self.get_game_title()
        logging.info(f"Game title set to: {self.state.game_title}")
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

        if action == 'restart':
            self.events_reset()
            return await self.initialize_game()

        if self.state.game_over:
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

        if result is None:
            result = {
                'type': 'update',
                'state': self.state.dict(),
                'description': "Unknown action!"
            }

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

        if item.type == 'potion':
            # Remove the potion immediately as it will be consumed
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
                    effects_log.append(f"The {effect_name} potion effect has worn off!")

        for effect_name in effects_to_remove:
            del self.state.temporary_effects[effect_name]

        return "\n".join(effects_log) if effects_log else ""

    async def handle_move(self, direction: str) -> dict:
        x, y = self.state.player_pos
        moved = False

        if direction == 'n' and y > 0:
            self.state.player_pos = (x, y - 1)
            moved = True
        elif direction == 's' and y < self.state.map_height - 1:
            self.state.player_pos = (x, y + 1)
            moved = True
        elif direction == 'w' and x > 0:
            self.state.player_pos = (x - 1, y)
            moved = True
        elif direction == 'e' and x < self.state.map_width - 1:
            self.state.player_pos = (x + 1, y)
            moved = True

        if moved:
            x, y = self.state.player_pos
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
            attack=self.random.randint(enemy_def['attack']['min'], enemy_def['attack']['max'])
        )
        # Store XP value as a private attribute
        enemy._xp_reward = enemy_def['xp']
        return enemy

    async def check_encounters(self) -> dict:
        # Read config.json
        with open('game_config.json', 'r') as f:
            config = json.load(f)

        roll = self.random.random()
        roll_thresh_enemy = config['encounter_chances']['enemy']
        roll_thresh_item = roll_thresh_enemy + config['encounter_chances']['item']
        #roll_thresh_story = roll_thresh_item + config['encounter_chances']['story']

        if roll < roll_thresh_enemy:  # 30% chance for enemy
            enemy = self.generate_enemy()
            self.state.current_enemy = enemy
            self.state.in_combat = True
            return await self.create_update(f"A {enemy.name} appears! (HP: {enemy.hp}, Attack: {enemy.attack})")
        elif roll < roll_thresh_item:  # 20% chance for item
            item = self.generate_random_item()

            # Check for duplicates if item is not consumable
            if item.type in ['weapon', 'armor']:
                existing_item = next((i for i in self.state.inventory
                                    if i.name == item.name), None)
                if existing_item:
                    return await self.create_update(f"You found another {item.name}, but you already have one.")

            self.state.inventory.append(item)
            return await self.create_update(f"You found a {item.name}! {item.description}")
        else:
            return await self.create_update_room()

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
                self.state.in_combat = False
                self.state.current_enemy = None

                # Process temporary effects
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    combat_log = f"{combat_log}\nYou have defeated the enemy and gained {xp_gained} XP!\n{effects_log}"
                else:
                    combat_log = f"{combat_log}\nYou have defeated the enemy and gained {xp_gained} XP!"

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
                return await self.create_update(f"{combat_log}\nYou have been defeated! Game Over!")

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
            return _gen_ai.gen_adapt_sentence(self.state, self.event_history, original_sentence)
        except Exception as e:
            logging.exception("Exception in gen_adapt_sentence")
            return original_sentence

    async def get_room_description(self) -> str:
        try:
            return _gen_ai.gen_room_description(self.state, self.event_history)
        except Exception as e:
            logging.exception("Exception in get_room_description")
            return "Error generating room description!"

    def log_error(self, error_message):
        print(f"Error: {error_message}")
        self.error_message = error_message  # Store the error message

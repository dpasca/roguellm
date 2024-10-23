from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, List, Optional, Union
import json
import random
import time
import asyncio

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_root():
    return FileResponse("static/index.html")

# Read config.json
with open('config.json', 'r') as f:
    config = json.load(f)

class Enemy(BaseModel):
    name: str
    hp: int
    max_hp: int
    attack: int

class Item(BaseModel):
    id: str
    name: str
    type: str  # 'weapon', 'armor', 'potion'
    effect: Dict[str, int]
    is_equipped: bool = False
    description: str

class Equipment(BaseModel):
    weapon: Optional[Item] = None
    armor: Optional[Item] = None

class GameState(BaseModel):
    map_width: int = config['map_size']['width']
    map_height: int = config['map_size']['height']
    player_pos: tuple = (0, 0)
    player_hp: int = config['player']['base_hp']
    player_max_hp: int = config['player']['max_hp']
    player_attack: int = config['player']['base_attack']
    player_defense: int = config['player']['base_defense']
    inventory: List[Item] = []
    equipment: Equipment = Equipment()
    explored: list = []
    in_combat: bool = False
    current_enemy: Optional[Enemy] = None
    game_over: bool = False
    temporary_effects: Dict[str, Dict[str, Union[int, int]]] = {}  # For temporary potion

class Game:
    def __init__(self, seed=None):
        self.random = random.Random(seed)  # Create a new Random object with the given seed
        self.error_message = None  # Add this line
        self.initialize_item_templates()
        self.state = GameState()
        self.initialize_game()
        self.connected_clients = set()

    def initialize_item_templates(self):
        try:
            with open('game_items.json', 'r') as f:
                self.item_templates = json.load(f)
        except FileNotFoundError:
            self.log_error("game_items.json file not found.")
            self.item_templates = {}
        except json.JSONDecodeError:
            self.log_error("Invalid JSON in game_items.json file.")
            self.item_templates = {}

    def initialize_game(self):
        self.state = GameState()
        self.state.explored = [[False for _ in range(self.state.map_width)]
                             for _ in range(self.state.map_height)]
        self.state.explored[0][0] = True
        self.state.inventory = []
        self.state.equipment = Equipment()
        self.state.game_over = False
        return {
            'type': 'update',
            'state': self.state.dict(),
            'description': "You find yourself at the entrance of a mysterious dungeon..."
        }

    def generate_random_item(self) -> Item:
        template_id = self.random.choice(list(self.item_templates.keys()))
        template = self.item_templates[template_id]
        return Item(
            id=f"{template_id}_{self.random.randint(1000, 9999)}",
            is_equipped=False,
            **template
        )

    async def handle_message(self, message: dict) -> dict:
        action = message.get('action')

        if action == 'restart':
            return self.initialize_game()

        if self.state.game_over:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "Game Over! Press Restart to play again."
            }

        if action == 'move' and not self.state.in_combat:
            return await self.handle_move(message.get('direction'))
        elif action == 'attack' and self.state.in_combat:
            return await self.handle_combat_action('attack')
        elif action == 'run' and self.state.in_combat:
            return await self.handle_combat_action('run')
        elif action == 'use_item':
            return await self.handle_use_item(message.get('item_id'))
        elif action == 'equip_item':
            return await self.handle_equip_item(message.get('item_id'))
        elif action == 'initialize':
            return self.initialize_game()

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
            self.state.explored[y][x] = True
            encounter_result = await self.check_encounters()

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
        enemy_types = [
            ("Goblin", (30, 50), (8, 12)),
            ("Skeleton", (40, 60), (10, 15)),
            ("Orc", (50, 70), (12, 18)),
            ("Dark Elf", (45, 65), (15, 20)),
            ("Troll", (70, 90), (15, 25))
        ]

        name, (min_hp, max_hp), (min_atk, max_atk) = self.random.choice(enemy_types)
        hp = self.random.randint(min_hp, max_hp)
        return Enemy(
            name=name,
            hp=hp,
            max_hp=hp,
            attack=self.random.randint(min_atk, max_atk)
        )

    async def check_encounters(self) -> dict:
        roll = self.random.random()
        roll_thresh_enemy = config['encounter_chances']['enemy']
        roll_thresh_item = roll_thresh_enemy + config['encounter_chances']['item']
        #roll_thresh_story = roll_thresh_item + config['encounter_chances']['story']

        if roll < roll_thresh_enemy:  # 30% chance for enemy
            enemy = self.generate_enemy()
            self.state.current_enemy = enemy
            self.state.in_combat = True
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': f"A {enemy.name} appears! (HP: {enemy.hp}, Attack: {enemy.attack})"
            }
        elif roll < roll_thresh_item:  # 20% chance for item
            item = self.generate_random_item()

            # Check for duplicates if item is not consumable
            if item.type in ['weapon', 'armor']:
                existing_item = next((i for i in self.state.inventory
                                    if i.name == item.name), None)
                if existing_item:
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': f"You found another {item.name}, but you already have one."
                    }

            self.state.inventory.append(item)
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': f"You found a {item.name}! {item.description}"
            }
        else:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': await self.get_room_description()
            }


    async def handle_combat_action(self, action: str) -> dict:
        if not self.state.in_combat or not self.state.current_enemy:
            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': "No enemy to fight!"
            }

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
                self.state.in_combat = False
                self.state.current_enemy = None

                # Process temporary effects
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    combat_log = f"{combat_log}\nYou have defeated the enemy!\n{effects_log}"
                else:
                    combat_log = f"{combat_log}\nYou have defeated the enemy!"

                return {
                    'type': 'update',
                    'state': self.state.dict(),
                    'description': combat_log
                }

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
                return {
                    'type': 'update',
                    'state': self.state.dict(),
                    'description': f"{combat_log}\nYou have been defeated! Game Over!"
                }

            # Process temporary effects
            effects_log = await self.process_temporary_effects()
            if effects_log:
                combat_log += f"\n{effects_log}"

            return {
                'type': 'update',
                'state': self.state.dict(),
                'description': combat_log
            }

        elif action == 'run':
            if self.random.random() < 0.6:  # 60% chance to escape
                self.state.in_combat = False
                self.state.current_enemy = None

                # Process temporary effects when running
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': f"You successfully flee from battle!\n{effects_log}"
                    }
                else:
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': "You successfully flee from battle!"
                    }
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
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!\nYou have been defeated! Game Over!"
                    }

                # Process temporary effects after failed escape
                effects_log = await self.process_temporary_effects()
                if effects_log:
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!\n{effects_log}"
                    }
                else:
                    return {
                        'type': 'update',
                        'state': self.state.dict(),
                        'description': f"Failed to escape! The {self.state.current_enemy.name} deals {actual_damage} damage to you!"
                    }

    async def get_room_description(self) -> str:
        return self.random.choice([
            "A dark, musty room with ancient writings on the wall.",
            "A chamber filled with mysterious artifacts and glowing crystals.",
            "A damp cave with strange mushrooms growing on the ceiling.",
            "An eerie room with flickering torches on the walls.",
            "A grand hall with crumbling pillars.",
            "A small room with mysterious runes etched into the floor."
        ])

    def log_error(self, error_message):
        print(f"Error: {error_message}")
        self.error_message = error_message  # Store the error message

# Create the game instance with a random seed (use fixed seed for debugging)
rand_seed = int(time.time())
#rand_seed = 699
game_instance = Game(seed=rand_seed)

@app.websocket("/ws/game")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    game_instance.connected_clients.add(websocket)
    try:
        # Send error message if it exists
        if game_instance.error_message:
            await websocket.send_json({
                'type': 'error',
                'message': game_instance.error_message
            })

        initial_state = await game_instance.handle_message({'action': 'initialize'})
        await websocket.send_json(initial_state)

        while True:
            message = await websocket.receive_json()
            response = await game_instance.handle_message(message)
            await websocket.send_json(response)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        game_instance.connected_clients.remove(websocket)
        await websocket.close()

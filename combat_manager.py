import random
import logging
from models import Enemy

logger = logging.getLogger()

class CombatManager:
    def __init__(self, random_instance, definitions):
        self.random = random_instance
        self.definitions = definitions
        self.enemy_sequence_cnt = 0

    def generate_enemy_from_def(self, enemy_def: dict) -> Enemy:
        """Generate an enemy from a specific enemy definition."""
        hp = self.random.randint(enemy_def['hp']['min'], enemy_def['hp']['max'])
        attack = self.random.randint(enemy_def['attack']['min'], enemy_def['attack']['max'])
        defense = self.random.randint(enemy_def.get('defense', {}).get('min', 0),
                                    enemy_def.get('defense', {}).get('max', 5))

        self.enemy_sequence_cnt += 1
        enemy = Enemy(
            id=f"{enemy_def['enemy_id']}_{self.enemy_sequence_cnt}",
            name=enemy_def['name'],
            font_awesome_icon=enemy_def['font_awesome_icon'],
            hp=hp,
            max_hp=hp,
            attack=attack,
            defense=defense,
            weapons=enemy_def.get('weapons', [])  # Add default empty list if weapons not present
        )
        enemy._xp_reward = enemy_def.get('xp', 10)
        enemy._hp_reward = int(enemy._xp_reward * 1.0)
        return enemy

    async def handle_combat_action(self, game_state, action: str) -> str:
        if not game_state.in_combat or not game_state.current_enemy:
            return "No enemy to fight!"

        if action == 'attack':
            # Player attacks
            damage_dealt = self.random.randint(
                game_state.player_attack - 5,
                game_state.player_attack + 5
            )
            game_state.current_enemy.hp -= damage_dealt
            combat_log = f"You deal {damage_dealt} damage to the {game_state.current_enemy.name}!"

            # Check if enemy is defeated
            if game_state.current_enemy.hp <= 0:
                # Award XP for defeating the enemy
                xp_gained = getattr(game_state.current_enemy, '_xp_reward', 20)
                game_state.player_xp += xp_gained

                # Award HP for defeating the enemy
                hp_gained = getattr(game_state.current_enemy, '_hp_reward', 0)
                game_state.player_hp += hp_gained

                # Mark enemy as defeated
                x, y = game_state.player_pos
                game_state.defeated_enemies.append({
                    'x': x,
                    'y': y,
                    'name': game_state.current_enemy.name,
                    'id': game_state.current_enemy.id,
                    'font_awesome_icon': game_state.current_enemy.font_awesome_icon,
                    'is_defeated': True
                })

                # Update existing enemy in enemies list
                for enemy in game_state.enemies:
                    if enemy['x'] == x and enemy['y'] == y:
                        enemy['is_defeated'] = True
                        break

                game_state.in_combat = False
                game_state.current_enemy = None

                # Check if all enemies have been defeated
                remaining_enemies = [e for e in game_state.enemies if not e['is_defeated']]
                if not remaining_enemies:
                    game_state.game_won = True
                    return f"{combat_log}\nYou defeated the enemy, gained {xp_gained} XP and {hp_gained} HP\nCongratulations! You have defeated all enemies!"

                return f"{combat_log}\nYou defeated the enemy, gained {xp_gained} XP and {hp_gained} HP"

            # Enemy counter-attacks
            damage_taken = max(0, self.random.randint(
                game_state.current_enemy.attack - 5,
                game_state.current_enemy.attack + 5
            ) - game_state.player_defense)

            game_state.player_hp -= damage_taken
            combat_log += f"\nThe {game_state.current_enemy.name} hits you for {damage_taken} damage!"

            if game_state.player_hp <= 0:
                game_state.game_over = True
                return f"{combat_log}\nYou have been defeated!"

            return f"{combat_log}\nEnemy HP: {game_state.current_enemy.hp}/{game_state.current_enemy.max_hp}"

        elif action == 'run':
            # 50% chance to escape
            if self.random.random() < 0.5:
                game_state.in_combat = False
                game_state.current_enemy = None
                # Move player back to previous position
                game_state.player_pos = game_state.player_pos_prev
                return "You managed to escape!"
            else:
                # Enemy gets a free attack
                damage_taken = max(0, self.random.randint(
                    game_state.current_enemy.attack - 5,
                    game_state.current_enemy.attack + 5
                ) - game_state.player_defense)

                game_state.player_hp -= damage_taken
                if game_state.player_hp <= 0:
                    game_state.game_over = True
                    return f"Failed to escape! The {game_state.current_enemy.name} hits you for {damage_taken} damage!\nYou have been defeated!"

                return f"Failed to escape! The {game_state.current_enemy.name} hits you for {damage_taken} damage!"

        return "Invalid combat action!"

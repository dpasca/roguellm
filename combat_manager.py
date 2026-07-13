import random
import logging
from models import Enemy
from game_messages import msg

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
            weapons=enemy_def.get('weapons', []),  # Add default empty list if weapons not present
            sprite_url=enemy_def.get('sprite_url'),
            sprite_token_url=enemy_def.get('sprite_token_url'),
        )
        enemy._xp_reward = enemy_def.get('xp', 10)
        enemy._hp_reward = int(enemy._xp_reward * 1.0)
        return enemy

    async def handle_combat_action(self, game_state, action: str, language: str = "en") -> str:
        if not game_state.in_combat or not game_state.current_enemy:
            return msg(language, "combat.no_enemy")

        if action == 'attack':
            # Player attacks
            damage_dealt = max(0, self.random.randint(
                game_state.player_attack - 5,
                game_state.player_attack + 5
            ))
            game_state.current_enemy.hp -= damage_dealt
            combat_log = msg(
                language,
                "combat.player_hit",
                damage=damage_dealt,
                enemy=game_state.current_enemy.name,
            )

            # Check if enemy is defeated
            if game_state.current_enemy.hp <= 0:
                # Award XP for defeating the enemy
                xp_gained = getattr(game_state.current_enemy, '_xp_reward', 20)
                game_state.player_xp += xp_gained

                # Award HP for defeating the enemy
                hp_gained = getattr(game_state.current_enemy, '_hp_reward', 0)
                game_state.player_hp = min(game_state.player_max_hp, game_state.player_hp + hp_gained)

                # Mark enemy as defeated
                x, y = game_state.player_pos
                defeated_enemy_name = game_state.current_enemy.name
                game_state.defeated_enemies.append({
                    'x': x,
                    'y': y,
                    'name': defeated_enemy_name,
                    'id': game_state.current_enemy.id,
                    'font_awesome_icon': game_state.current_enemy.font_awesome_icon,
                    'sprite_url': game_state.current_enemy.sprite_url,
                    'sprite_token_url': game_state.current_enemy.sprite_token_url,
                    'is_defeated': True
                })

                # Update existing enemy in enemies list
                for enemy in game_state.enemies:
                    if enemy['x'] == x and enemy['y'] == y:
                        enemy['is_defeated'] = True
                        break

                game_state.in_combat = False
                game_state.current_enemy = None
                self._mark_enemy_tile_defeated(game_state, x, y, defeated_enemy_name, language)

                return (
                    f"{combat_log}\n" +
                    msg(language, "combat.defeated_enemy", xp=xp_gained, hp=hp_gained)
                )

            # Enemy counter-attacks
            damage_taken = max(0, self.random.randint(
                game_state.current_enemy.attack - 5,
                game_state.current_enemy.attack + 5
            ) - game_state.player_defense)

            self._apply_player_damage(game_state, damage_taken)
            combat_log += "\n" + msg(
                language,
                "combat.enemy_hit",
                enemy=game_state.current_enemy.name,
                damage=damage_taken,
            )

            if game_state.player_hp <= 0:
                self._mark_player_defeated(game_state)
                return f"{combat_log}\n{msg(language, 'combat.player_defeated')}"

            return (
                f"{combat_log}\n" +
                msg(
                    language,
                    "combat.enemy_hp",
                    hp=game_state.current_enemy.hp,
                    max_hp=game_state.current_enemy.max_hp,
                )
            )

        elif action == 'run':
            # 50% chance to escape
            if self.random.random() < 0.5:
                game_state.in_combat = False
                game_state.current_enemy = None
                game_state.player_pos_prev = game_state.player_pos
                return msg(language, "combat.run_success")
            else:
                # Enemy gets a free attack
                damage_taken = max(0, self.random.randint(
                    game_state.current_enemy.attack - 5,
                    game_state.current_enemy.attack + 5
                ) - game_state.player_defense)

                self._apply_player_damage(game_state, damage_taken)
                if game_state.player_hp <= 0:
                    self._mark_player_defeated(game_state)
                    return (
                        msg(
                            language,
                            "combat.run_failed",
                            enemy=game_state.current_enemy.name,
                            damage=damage_taken,
                        ) +
                        f"\n{msg(language, 'combat.player_defeated')}"
                    )

                return msg(
                    language,
                    "combat.run_failed",
                    enemy=game_state.current_enemy.name,
                    damage=damage_taken,
                )

        return msg(language, "combat.invalid_action")

    def _apply_player_damage(self, game_state, damage: int) -> None:
        game_state.player_hp = max(0, game_state.player_hp - damage)

    def _mark_player_defeated(self, game_state) -> None:
        game_state.game_over = True
        game_state.in_combat = False

    def _mark_enemy_tile_defeated(
            self,
            game_state,
            x: int,
            y: int,
            enemy_name: str,
            language: str = "en"
    ) -> None:
        tile_info = getattr(game_state, "tile_info", None)
        if not tile_info or y >= len(tile_info) or x >= len(tile_info[y]):
            return

        tile = tile_info[y][x]
        label = tile.get("label") or tile.get("terrain_name") or msg(language, "tile.area")
        tile.update({
            "danger_level": "safe",
            "hint": msg(language, "tile.defeated", entity=enemy_name),
            "entity_status": "defeated",
            "quick_desc": msg(language, "tile.enemy_defeated_quick", terrain=label, enemy=enemy_name),
            "inspect_desc": msg(language, "tile.enemy_defeated_inspect", enemy=enemy_name),
            "tags": ["defeated"],
        })

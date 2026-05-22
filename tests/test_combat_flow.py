import unittest

from combat_manager import CombatManager
from models import Enemy, GameState
from player_action_handler import PlayerActionHandler


class ScriptedRandom:
    def __init__(self, *, randints=None, randoms=None):
        self.randints = list(randints or [])
        self.randoms = list(randoms or [])

    def randint(self, start, end):
        if not self.randints:
            raise AssertionError(f"Unexpected randint({start}, {end})")
        value = self.randints.pop(0)
        if value < start or value > end:
            raise AssertionError(f"Scripted randint {value} outside {start}..{end}")
        return value

    def random(self):
        if not self.randoms:
            raise AssertionError("Unexpected random()")
        return self.randoms.pop(0)


class DummyGameStateManager:
    def __init__(self, state, entity_placements):
        self.state = state
        self.entity_placements = entity_placements

    async def create_message(self, description_raw="", description=""):
        return {
            "type": "update",
            "state": self.state.model_dump(mode="json"),
            "description_raw": description_raw,
            "description": description or description_raw,
        }


def make_enemy(*, hp=20, attack=10):
    return Enemy(
        id="enemy_1",
        name="Test Enemy",
        hp=hp,
        max_hp=hp,
        attack=attack,
        font_awesome_icon="fa-solid fa-skull",
        weapons=[],
    )


def make_state(*, player_hp=20, enemy=None):
    enemy = enemy or make_enemy()
    return GameState(
        map_width=2,
        map_height=2,
        cell_types=[[{}, {}], [{}, {}]],
        explored=[[True, False], [False, False]],
        player_pos=(0, 0),
        player_pos_prev=(0, 0),
        player_hp=player_hp,
        player_max_hp=100,
        player_attack=15,
        player_defense=0,
        current_enemy=enemy,
        in_combat=True,
        enemies=[
            {
                "id": enemy.id,
                "x": 0,
                "y": 0,
                "name": enemy.name,
                "font_awesome_icon": enemy.font_awesome_icon,
                "is_defeated": False,
            }
        ],
        defeated_enemies=[],
        game_title="Combat Test",
        player={"font_awesome_icon": "fa-solid fa-user-secret"},
    )


class CombatFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_attack_death_clamps_hp_and_exits_combat(self):
        state = make_state(player_hp=5, enemy=make_enemy(hp=30, attack=25))
        combat = CombatManager(ScriptedRandom(randints=[10, 25]), definitions=None)

        message = await combat.handle_combat_action(state, "attack")

        self.assertIn("You have been defeated", message)
        self.assertEqual(state.player_hp, 0)
        self.assertTrue(state.game_over)
        self.assertFalse(state.in_combat)
        self.assertIsNotNone(state.current_enemy)

    async def test_failed_run_death_clamps_hp_and_exits_combat(self):
        state = make_state(player_hp=4, enemy=make_enemy(hp=30, attack=20))
        combat = CombatManager(ScriptedRandom(randints=[20], randoms=[0.9]), definitions=None)

        message = await combat.handle_combat_action(state, "run")

        self.assertIn("Failed to escape", message)
        self.assertIn("You have been defeated", message)
        self.assertEqual(state.player_hp, 0)
        self.assertTrue(state.game_over)
        self.assertFalse(state.in_combat)

    async def test_successful_run_exits_combat_without_moving_player(self):
        state = make_state(player_hp=40, enemy=make_enemy(hp=30, attack=20))
        state.player_pos = (1, 0)
        state.player_pos_prev = (0, 0)
        combat = CombatManager(ScriptedRandom(randoms=[0.1]), definitions=None)

        message = await combat.handle_combat_action(state, "run")

        self.assertEqual(message, "You broke away from the fight!")
        self.assertEqual(state.player_pos, (1, 0))
        self.assertEqual(state.player_pos_prev, (1, 0))
        self.assertFalse(state.in_combat)
        self.assertIsNone(state.current_enemy)

    async def test_enemy_defeat_caps_hp_reward_at_player_max(self):
        state = make_state(player_hp=95, enemy=make_enemy(hp=5, attack=20))
        state.current_enemy._xp_reward = 12
        state.current_enemy._hp_reward = 20
        combat = CombatManager(ScriptedRandom(randints=[20]), definitions=None)

        message = await combat.handle_combat_action(state, "attack")

        self.assertIn("You defeated the enemy", message)
        self.assertEqual(state.player_hp, 100)
        self.assertEqual(state.player_xp, 12)
        self.assertFalse(state.in_combat)
        self.assertIsNone(state.current_enemy)
        self.assertTrue(state.defeated_enemies)
        self.assertTrue(state.enemies[0]["is_defeated"])

    async def test_defeating_last_enemy_sets_win_state(self):
        state = make_state(player_hp=50, enemy=make_enemy(hp=5, attack=20))
        state.current_enemy._xp_reward = 12
        state.current_enemy._hp_reward = 0
        state_manager = DummyGameStateManager(
            state,
            [{"x": 0, "y": 0, "type": "enemy", "entity_id": "enemy_1"}],
        )
        combat = CombatManager(ScriptedRandom(randints=[20]), definitions=None)
        handler = PlayerActionHandler(state_manager, combat)

        result = await handler.handle_combat_action("attack")

        self.assertTrue(state.game_won)
        self.assertFalse(state.game_over)
        self.assertIn("Congratulations", result["description_raw"])


if __name__ == "__main__":
    unittest.main()

from types import SimpleNamespace
import unittest

from combat_manager import CombatManager
from game_messages import SUPPORTED_LOCALES, msg
from models import GameState
from player_action_handler import PlayerActionHandler


class ScriptedRandom:
    def __init__(self, *, randints=None):
        self.randints = list(randints or [])

    def randint(self, start, end):
        if not self.randints:
            raise AssertionError(f"Unexpected randint({start}, {end})")

        value = self.randints.pop(0)
        if value < start or value > end:
            raise AssertionError(f"Scripted randint {value} outside {start}..{end}")

        return value


class DummyGameStateManager:
    def __init__(self, state, definitions, language):
        self.state = state
        self.definitions = definitions
        self.language = language
        self.item_sequence_cnt = 0
        self.entity_placements = [
            {"x": 1, "y": 0, "type": "enemy", "entity_id": "microbe"},
            {"x": 2, "y": 0, "type": "item", "entity_id": "energy_pod"},
            {"x": 3, "y": 0, "type": "enemy", "entity_id": "sentinel"},
        ]

    async def create_message(self, description_raw="", description=""):
        return {
            "type": "update",
            "state": self.state.model_dump(mode="json"),
            "description_raw": description_raw,
            "description": description or description_raw,
        }

    async def create_message_room(self):
        raise AssertionError("Smoke flow should not need a generated room message")

    def get_tile_info(self, x, y):
        return self.state.tile_info[y][x]


def make_definitions():
    return SimpleNamespace(
        enemy_defs=[
            {
                "enemy_id": "microbe",
                "name": "Microbo Spaziale",
                "font_awesome_icon": "fa-solid fa-skull",
                "hp": {"min": 5, "max": 5},
                "attack": {"min": 6, "max": 6},
                "defense": {"min": 0, "max": 0},
                "xp": 10,
                "weapons": [],
            },
            {
                "enemy_id": "sentinel",
                "name": "Robot Sentinella",
                "font_awesome_icon": "fa-solid fa-robot",
                "hp": {"min": 50, "max": 50},
                "attack": {"min": 12, "max": 12},
                "defense": {"min": 0, "max": 0},
                "xp": 20,
                "weapons": [],
            },
        ],
        item_defs=[
            {
                "id": "energy_pod",
                "name": "Baccelli Energetici",
                "type": "consumable",
                "effect": {"health": 50},
                "description": "Vitapod ricaricante.",
            }
        ],
    )


def make_state():
    return GameState(
        map_width=4,
        map_height=1,
        cell_types=[[{}, {}, {}, {}]],
        tile_info=[
            [
                {"label": "Start"},
                {"label": "Radura aliena"},
                {"label": "Campo energetico"},
                {"label": "Avamposto"},
            ]
        ],
        explored=[[True, False, False, False]],
        player_pos=(0, 0),
        player_pos_prev=(0, 0),
        player_hp=40,
        player_max_hp=100,
        player_attack=15,
        player_defense=0,
        item_placements=[
            {
                "x": 2,
                "y": 0,
                "id": "energy_pod",
                "name": "Baccelli Energetici",
                "font_awesome_icon": "fa-solid fa-capsules",
                "is_collected": False,
            }
        ],
        game_title="Locale Smoke",
        player={"font_awesome_icon": "fa-solid fa-user-secret"},
    )


class GameplayLogSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_fast_gameplay_actions_use_selected_language(self):
        non_english_locales = [
            locale for locale in SUPPORTED_LOCALES
            if locale != "en"
        ]

        for locale in non_english_locales:
            with self.subTest(locale=locale):
                definitions = make_definitions()
                state = make_state()
                manager = DummyGameStateManager(state, definitions, locale)
                combat = CombatManager(ScriptedRandom(randints=[5, 6, 0, 15]), definitions)
                handler = PlayerActionHandler(manager, combat)

                enemy_message = await handler.handle_move("e")
                attack_message = await handler.handle_combat_action("attack")
                item_message = await handler.handle_move("e")
                item_id = state.inventory[0].id
                use_message = await handler.handle_use_item(item_id)

                expected_enemy = msg(
                    locale,
                    "encounter.enemy_appears",
                    enemy="Microbo Spaziale",
                    hp=5,
                    attack=6,
                )
                expected_hit = msg(
                    locale,
                    "combat.player_hit",
                    damage=15,
                    enemy="Microbo Spaziale",
                )
                expected_defeat = msg(
                    locale,
                    "combat.defeated_enemy",
                    xp=10,
                    hp=10,
                )
                expected_item = msg(
                    locale,
                    "item.found",
                    item="Baccelli Energetici",
                    description="Vitapod ricaricante.",
                )
                expected_use = msg(
                    locale,
                    "item.used_health",
                    item="Baccelli Energetici",
                    amount=50,
                )

                self.assertEqual(enemy_message["description_raw"], expected_enemy)
                self.assertIn(expected_hit, attack_message["description_raw"])
                self.assertIn(expected_defeat, attack_message["description_raw"])
                self.assertEqual(item_message["description_raw"], expected_item)
                self.assertEqual(use_message["description_raw"], expected_use)

                combined = "\n".join([
                    enemy_message["description_raw"],
                    attack_message["description_raw"],
                    item_message["description_raw"],
                    use_message["description_raw"],
                ])
                self.assertNotIn(" appears!", combined)
                self.assertNotIn("You deal", combined)
                self.assertNotIn("You defeated", combined)
                self.assertNotIn("You found", combined)
                self.assertNotIn("Used ", combined)


if __name__ == "__main__":
    unittest.main()

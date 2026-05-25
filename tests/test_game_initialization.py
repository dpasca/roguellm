import random
import unittest

from game_state_manager import GameStateManager


class DummyDefinitions:
    player_defs = [{"font_awesome_icon": "fa-solid fa-user"}]
    celltype_defs = {}


class DummyGenAI:
    game_title = "Test World"


class DummyEntityManager:
    def __init__(self):
        self.raw_placements = [
            {"type": "enemy", "entity_id": "wolf", "x": 0, "y": 0},
        ]
        self.sanitized_placements = [
            {"type": "enemy", "entity_id": "wolf", "x": 2, "y": 0},
        ]

    async def generate_placements(self, cell_types, map_width, map_height):
        return list(self.raw_placements)

    def process_placements(self, game_state):
        game_state.enemies = [
            {
                "id": "wolf_1",
                "x": 2,
                "y": 0,
                "name": "Wolf",
                "font_awesome_icon": "fa-solid fa-skull",
                "is_defeated": False,
            }
        ]
        game_state.item_placements = []
        return list(self.sanitized_placements)


class GameInitializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_initialize_game_uses_sanitized_entity_placements_for_encounters(self):
        manager = GameStateManager.__new__(GameStateManager)
        manager.random = random.Random(0)
        manager.error_message = None
        manager.definitions = DummyDefinitions()
        manager.gen_ai = DummyGenAI()
        manager.entity_manager = DummyEntityManager()
        manager.last_described_ct = None

        async def create_message(description_raw, description=""):
            return {
                "description_raw": description_raw,
                "description": description,
            }

        manager.create_message = create_message

        await manager.initialize_game()

        self.assertEqual(manager.entity_placements, manager.entity_manager.sanitized_placements)
        self.assertEqual(
            (manager.state.enemies[0]["x"], manager.state.enemies[0]["y"]),
            (manager.entity_placements[0]["x"], manager.entity_placements[0]["y"]),
        )


if __name__ == "__main__":
    unittest.main()

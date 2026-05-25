import random
import unittest
from unittest.mock import patch

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


class FakeDefinitionsManager:
    player_defs = [{"name": "Player", "font_awesome_icon": "fa-solid fa-user"}]
    item_defs = []
    enemy_defs = []
    celltype_defs = {}

    def __init__(self, gen_ai, language):
        self.gen_ai = gen_ai
        self.language = language
        self.generator_id = None

    def load_from_generator(self, generator_id):
        self.generator_id = generator_id
        return True


class FakeGenAI:
    def __init__(self, lo_model=None, hi_model=None):
        self.lo_model = lo_model
        self.hi_model = hi_model
        self.game_title = None
        self.set_theme_calls = []

    async def set_theme_description(self, theme_desc, theme_desc_better, do_web_search, language):
        self.set_theme_calls.append({
            "theme_desc": theme_desc,
            "theme_desc_better": theme_desc_better,
            "do_web_search": do_web_search,
            "language": language,
        })
        self.game_title = f"{language} title"
        return theme_desc_better


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

    async def test_existing_world_uses_requested_run_language(self):
        generator_data = {
            "theme_desc": "Un mondo costruito in italiano",
            "theme_desc_better": "Mondo Italiano\nUna descrizione salvata.",
            "language": "it",
        }

        with patch("game_state_manager.GenAIModel", return_value=object()), \
                patch("game_state_manager.GenAI", FakeGenAI), \
                patch("game_state_manager.GameDefinitionsManager", FakeDefinitionsManager), \
                patch("game_state_manager.EntityPlacementManager"), \
                patch("game_state_manager.db.get_generator", return_value=generator_data):
            manager = await GameStateManager.create(
                seed=1,
                theme_desc="ignored for existing worlds",
                do_web_search=False,
                language="ja",
                generator_id="italian-world",
            )

        self.assertEqual(manager.language, "ja")
        self.assertEqual(manager.definitions.language, "ja")
        self.assertEqual(manager.theme_desc, generator_data["theme_desc"])
        self.assertEqual(manager.gen_ai.set_theme_calls[0]["language"], "ja")
        self.assertEqual(
            manager.gen_ai.set_theme_calls[0]["theme_desc"],
            generator_data["theme_desc"],
        )


if __name__ == "__main__":
    unittest.main()

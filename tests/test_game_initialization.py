import random
import unittest
from unittest.mock import patch

from game_state_manager import GameStateManager, WORLD_TRANSLATION_CACHE_VERSION


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
    def __init__(self, gen_ai, language):
        self.gen_ai = gen_ai
        self.language = language
        self.generator_id = None
        self.player_defs = [{"name": "Player", "font_awesome_icon": "fa-solid fa-user"}]
        self.item_defs = []
        self.enemy_defs = []
        self.celltype_defs = {}

    def load_from_generator(self, generator_id):
        self.generator_id = generator_id
        return True

    def load_from_generator_data(self, generator_id, generator_data):
        self.generator_id = generator_id
        self.language = generator_data["language"]
        self.player_defs = generator_data["player_defs"]
        self.item_defs = generator_data["item_defs"]
        self.enemy_defs = generator_data["enemy_defs"]
        self.celltype_defs = generator_data["celltype_defs"]


class FakeGenAI:
    def __init__(self, lo_model=None, hi_model=None):
        self.lo_model = lo_model
        self.hi_model = hi_model
        self.game_title = None
        self.set_theme_calls = []
        self.translate_calls = []

    async def set_theme_description(self, theme_desc, theme_desc_better, do_web_search, language):
        self.set_theme_calls.append({
            "theme_desc": theme_desc,
            "theme_desc_better": theme_desc_better,
            "do_web_search": do_web_search,
            "language": language,
        })
        self.game_title = f"{language} title"
        return theme_desc_better

    async def translate_world_definition(self, world_definition, source_language, target_language):
        self.translate_calls.append({
            "world_definition": world_definition,
            "source_language": source_language,
            "target_language": target_language,
        })
        return {
            "theme_desc_better": "日本語の世界\n保存済みの説明。",
            "player_defs": [{"name": "冒険者", "font_awesome_icon": "fa-solid fa-user"}],
            "item_defs": [{"id": "key", "name": "鍵", "description": "古い鍵"}],
            "enemy_defs": [{"enemy_id": "eel", "name": "電気ウナギ", "weapons": ["電撃"]}],
            "celltype_defs": {"reef": {"name": "サンゴ礁", "description": "静かな海底"}},
        }


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
            "player_defs": [{"name": "Esploratore", "font_awesome_icon": "fa-solid fa-user"}],
            "item_defs": [{"id": "key", "name": "Chiave", "description": "Una vecchia chiave"}],
            "enemy_defs": [{"enemy_id": "eel", "name": "Anguilla", "weapons": ["Scossa"]}],
            "celltype_defs": {"reef": {"name": "Scogliera", "description": "Un fondale calmo"}},
        }

        with patch("game_state_manager.GenAIModel", return_value=object()), \
                patch("game_state_manager.GenAI", FakeGenAI), \
                patch("game_state_manager.GameDefinitionsManager", FakeDefinitionsManager), \
                patch("game_state_manager.EntityPlacementManager"), \
                patch("game_state_manager.db.get_generator", return_value=generator_data), \
                patch("game_state_manager.db.get_generator_translation", return_value=None) as get_translation, \
                patch("game_state_manager.db.save_generator_translation") as save_translation:
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
        self.assertEqual(manager.theme_desc_better, "日本語の世界\n保存済みの説明。")
        self.assertEqual(manager.definitions.player_defs[0]["name"], "冒険者")
        get_translation.assert_called_once_with(
            "italian-world",
            "ja",
            WORLD_TRANSLATION_CACHE_VERSION,
        )
        self.assertEqual(manager.gen_ai.translate_calls[0]["source_language"], "it")
        self.assertEqual(manager.gen_ai.translate_calls[0]["target_language"], "ja")
        save_translation.assert_called_once()
        self.assertEqual(
            save_translation.call_args.kwargs["translation_version"],
            WORLD_TRANSLATION_CACHE_VERSION,
        )
        self.assertEqual(manager.gen_ai.set_theme_calls[0]["language"], "ja")
        self.assertEqual(
            manager.gen_ai.set_theme_calls[0]["theme_desc"],
            generator_data["theme_desc"],
        )
        self.assertEqual(
            manager.gen_ai.set_theme_calls[0]["theme_desc_better"],
            "日本語の世界\n保存済みの説明。",
        )

    async def test_existing_world_uses_cached_translation(self):
        generator_data = {
            "theme_desc": "Un mondo costruito in italiano",
            "theme_desc_better": "Mondo Italiano\nUna descrizione salvata.",
            "language": "it",
            "player_defs": [{"name": "Esploratore"}],
            "item_defs": [{"id": "key", "name": "Chiave"}],
            "enemy_defs": [{"enemy_id": "eel", "name": "Anguilla"}],
            "celltype_defs": {"reef": {"name": "Scogliera"}},
        }
        cached_translation = {
            "language": "ja",
            "theme_desc_better": "キャッシュ済みの世界\n説明。",
            "player_defs": [{"name": "キャッシュ済み冒険者"}],
            "item_defs": [{"id": "key", "name": "キャッシュ済みの鍵"}],
            "enemy_defs": [{"enemy_id": "eel", "name": "キャッシュ済みウナギ"}],
            "celltype_defs": {"reef": {"name": "キャッシュ済みサンゴ礁"}},
        }

        with patch("game_state_manager.GenAIModel", return_value=object()), \
                patch("game_state_manager.GenAI", FakeGenAI), \
                patch("game_state_manager.GameDefinitionsManager", FakeDefinitionsManager), \
                patch("game_state_manager.EntityPlacementManager"), \
                patch("game_state_manager.db.get_generator", return_value=generator_data), \
                patch("game_state_manager.db.get_generator_translation", return_value=cached_translation) as get_translation, \
                patch("game_state_manager.db.save_generator_translation") as save_translation:
            manager = await GameStateManager.create(
                seed=1,
                theme_desc="ignored for existing worlds",
                do_web_search=False,
                language="ja",
                generator_id="italian-world",
            )

        self.assertEqual(manager.theme_desc_better, cached_translation["theme_desc_better"])
        self.assertEqual(manager.definitions.player_defs[0]["name"], "キャッシュ済み冒険者")
        get_translation.assert_called_once_with(
            "italian-world",
            "ja",
            WORLD_TRANSLATION_CACHE_VERSION,
        )
        self.assertEqual(manager.gen_ai.translate_calls, [])
        save_translation.assert_not_called()


if __name__ == "__main__":
    unittest.main()

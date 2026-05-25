import os
import tempfile
import unittest
from unittest.mock import patch

from db import DatabaseManager


class WorldListingTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "test_worlds.db")
        manager.init_db()
        return manager

    def test_list_worlds_returns_recent_generator_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="A clockwork library under the sea",
                theme_desc_better="Clockwork Library\nA quieter second line",
                language="en",
                player_defs=[{"name": "Diver"}],
                item_defs=[{"id": "key"}, {"id": "lamp"}],
                enemy_defs=[{"enemy_id": "eel"}],
                celltype_defs={"reef": {}, "archive": {}},
            )

            worlds = manager.list_worlds()

        self.assertEqual(len(worlds), 1)
        self.assertEqual(worlds[0]["id"], world_id)
        self.assertEqual(worlds[0]["title"], "Clockwork Library")
        self.assertEqual(worlds[0]["theme"], "A clockwork library under the sea")
        self.assertEqual(worlds[0]["language"], "en")
        self.assertEqual(worlds[0]["player_count"], 1)
        self.assertEqual(worlds[0]["item_count"], 2)
        self.assertEqual(worlds[0]["enemy_count"], 1)
        self.assertEqual(worlds[0]["terrain_count"], 2)

    def test_list_worlds_counts_list_based_terrain_definitions(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            manager.save_generator(
                theme_desc="A neon city",
                theme_desc_better="Neon City\nA quieter second line",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs=[
                    {"id": "street", "name": "Street"},
                    {"id": "alley", "name": "Alley"},
                ],
            )

            worlds = manager.list_worlds()

        self.assertEqual(worlds[0]["terrain_count"], 2)

    def test_list_worlds_handles_older_generator_table_without_created_at(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            os.remove(manager.db_path)
            with manager.get_connection() as conn:
                conn.execute("""
                    CREATE TABLE generators (
                        id TEXT PRIMARY KEY,
                        theme_desc TEXT,
                        theme_desc_better TEXT,
                        language TEXT,
                        player_defs TEXT,
                        item_defs TEXT,
                        enemy_defs TEXT,
                        celltype_defs TEXT
                    )
                """)
                conn.execute("""
                    INSERT INTO generators
                    (id, theme_desc, theme_desc_better, language, player_defs, item_defs, enemy_defs, celltype_defs)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    "oldworld",
                    "Old theme",
                    "Old World",
                    "en",
                    "[]",
                    "[]",
                    "[]",
                    "{}",
                ))
                conn.commit()

            worlds = manager.list_worlds()

        self.assertEqual(len(worlds), 1)
        self.assertEqual(worlds[0]["id"], "oldworld")
        self.assertEqual(worlds[0]["created_at"], None)

    def test_generator_translation_cache_round_trips_by_language(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="A clockwork library under the sea",
                theme_desc_better="Clockwork Library\nA quieter second line",
                language="en",
                player_defs=[{"name": "Diver"}],
                item_defs=[{"id": "key", "name": "Key"}],
                enemy_defs=[{"enemy_id": "eel", "name": "Eel"}],
                celltype_defs={"reef": {"name": "Reef"}},
            )

            manager.save_generator_translation(
                generator_id=world_id,
                language="ja",
                theme_desc_better="時計仕掛けの図書館\n静かな二行目",
                player_defs=[{"name": "潜水士"}],
                item_defs=[{"id": "key", "name": "鍵"}],
                enemy_defs=[{"enemy_id": "eel", "name": "ウナギ"}],
                celltype_defs={"reef": {"name": "サンゴ礁"}},
                translation_version=2,
            )

            translation = manager.get_generator_translation(world_id, "ja", translation_version=2)
            stale_version = manager.get_generator_translation(world_id, "ja", translation_version=1)
            missing_translation = manager.get_generator_translation(world_id, "it")

        self.assertEqual(translation["language"], "ja")
        self.assertEqual(translation["theme_desc_better"], "時計仕掛けの図書館\n静かな二行目")
        self.assertEqual(translation["player_defs"][0]["name"], "潜水士")
        self.assertEqual(translation["item_defs"][0]["id"], "key")
        self.assertEqual(translation["enemy_defs"][0]["enemy_id"], "eel")
        self.assertEqual(translation["celltype_defs"]["reef"]["name"], "サンゴ礁")
        self.assertIsNone(stale_version)
        self.assertIsNone(missing_translation)

    def test_init_db_adds_translation_version_to_existing_cache_table(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {
                "DO_STORAGE_SERVER": "",
                "DO_SPACES_ACCESS_KEY": "",
                "DO_SPACES_SECRET_KEY": "",
                "DO_STORAGE_CONTAINER": "",
            }):
                manager = DatabaseManager()
            manager.db_path = os.path.join(directory, "old_translations.db")
            with manager.get_connection() as conn:
                conn.execute("""
                    CREATE TABLE generator_translations (
                        generator_id TEXT NOT NULL,
                        language TEXT NOT NULL,
                        theme_desc_better TEXT,
                        player_defs TEXT,
                        item_defs TEXT,
                        enemy_defs TEXT,
                        celltype_defs TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (generator_id, language)
                    )
                """)
                conn.commit()

            manager.init_db()

            with manager.get_connection() as conn:
                columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(generator_translations)").fetchall()
                }

        self.assertIn("translation_version", columns)


if __name__ == "__main__":
    unittest.main()

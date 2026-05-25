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


if __name__ == "__main__":
    unittest.main()

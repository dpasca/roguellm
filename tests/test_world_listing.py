import os
import tempfile
import unittest
from unittest.mock import patch

from db import DatabaseManager
from fastapi.testclient import TestClient
import main


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

            worlds = manager.list_worlds(local_dev=True)

        self.assertEqual(len(worlds), 1)
        self.assertEqual(worlds[0]["id"], world_id)
        self.assertEqual(worlds[0]["title"], "Clockwork Library")
        self.assertEqual(worlds[0]["theme"], "A clockwork library under the sea")
        self.assertEqual(worlds[0]["language"], "en")
        self.assertEqual(worlds[0]["player_count"], 1)
        self.assertEqual(worlds[0]["item_count"], 2)
        self.assertEqual(worlds[0]["enemy_count"], 1)
        self.assertEqual(worlds[0]["terrain_count"], 2)
        self.assertEqual(worlds[0]["visibility"], "unlisted")
        self.assertIsNone(worlds[0]["owner_id"])

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

            worlds = manager.list_worlds(local_dev=True)

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

    def test_list_worlds_excludes_private_and_unlisted_outside_local_dev(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            public_id = manager.save_generator(
                theme_desc="Public world",
                theme_desc_better="Public World",
                language="en",
                player_defs=[{"name": "Hero"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="public",
            )
            manager.save_generator(
                theme_desc="Unlisted world",
                theme_desc_better="Unlisted World",
                language="en",
                player_defs=[{"name": "Rogue"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="unlisted",
            )
            manager.save_generator(
                theme_desc="Private world",
                theme_desc_better="Private World",
                language="en",
                player_defs=[{"name": "Mage"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="private",
            )

            worlds = manager.list_worlds(local_dev=False)
            ids = {w["id"] for w in worlds}

        self.assertIn(public_id, ids)
        self.assertEqual(len(worlds), 1)

    def test_get_visible_generator_allows_unlisted(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="Unlisted world",
                theme_desc_better="Unlisted World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="unlisted",
            )

            result = manager.get_visible_generator(world_id)

        self.assertIsNotNone(result)
        self.assertEqual(result["visibility"], "unlisted")

    def test_get_visible_generator_blocks_private_for_non_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="Private world",
                theme_desc_better="Private World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="private",
                owner_id="owner-123",
            )

            result_anon = manager.get_visible_generator(world_id)
            result_other = manager.get_visible_generator(world_id, requester_owner_id="other-owner")

        self.assertIsNone(result_anon)
        self.assertIsNone(result_other)

    def test_get_visible_generator_allows_private_for_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="Private world",
                theme_desc_better="Private World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="private",
                owner_id="owner-123",
            )

            result = manager.get_visible_generator(world_id, requester_owner_id="owner-123")

        self.assertIsNotNone(result)
        self.assertEqual(result["visibility"], "private")

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


class WorldApiTests(unittest.TestCase):
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

    def test_get_world_returns_metadata_for_public(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="Cyberpunk Tokyo",
                theme_desc_better="Neon Tokyo",
                language="en",
                player_defs=[{"id": "samurai"}],
                item_defs=[{"id": "katana"}],
                enemy_defs=[{"id": "yakuza"}],
                celltype_defs={"street": {}},
                owner_id=None,
                visibility="public"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.get(f"/api/worlds/{world_id}")

            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["id"], world_id)
            self.assertEqual(data["title"], "Neon Tokyo")
            self.assertEqual(data["visibility"], "public")
            self.assertEqual(data["player_count"], 1)
            self.assertEqual(data["item_count"], 1)
            self.assertEqual(data["enemy_count"], 1)
            self.assertEqual(data["terrain_count"], 1)

    def test_get_world_returns_metadata_for_unlisted(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="Fantasy Forest",
                theme_desc_better="Enchanted Forest",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=None,
                visibility="unlisted"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.get(f"/api/worlds/{world_id}")

            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["id"], world_id)
            self.assertEqual(data["visibility"], "unlisted")

    def test_get_world_blocks_private_for_anonymous(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="Secret Base",
                theme_desc_better="Hidden Base",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id="owner-123",
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.get(f"/api/worlds/{world_id}")

            self.assertEqual(response.status_code, 404)

    def test_create_game_session_fails_for_private_world(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="Secret Base",
                theme_desc_better="Hidden Base",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id="owner-123",
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "theme": "fantasy",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 404)
            self.assertIn("World ID not found", response.json()["error"])

    def test_create_game_session_succeeds_for_public_world(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="Public Arena",
                theme_desc_better="Grand Arena",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=None,
                visibility="public"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "theme": "fantasy",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "creating")


if __name__ == "__main__":
    unittest.main()

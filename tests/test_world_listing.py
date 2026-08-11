import os
import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from db import DatabaseManager
from fastapi.testclient import TestClient
import main
from world_moderation import (
    WorldPublicReviewResult,
    build_world_review_payload,
    process_due_public_world_reviews,
)

VALID_TEST_PASSWORD = "Secret123!"
OTHER_VALID_TEST_PASSWORD = "Better123!"


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

    def test_listing_carries_the_cover_for_the_gallery(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="A rain-soaked harbour",
                theme_desc_better="Harbour of Thieves\nRain never stops.",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[],
                enemy_defs=[{"enemy_id": "punk"}],
                celltype_defs={"dock": {}},
            )
            manager.save_generator_visual_manifest(
                world_id,
                {"style": "noir", "cover_url": f"/assets/worlds/{world_id}/cover.png"},
            )

            worlds = manager.list_worlds(local_dev=True)

        self.assertEqual(len(worlds), 1)
        self.assertEqual(worlds[0]["cover_url"], f"/assets/worlds/{world_id}/cover.png")

    def test_a_world_without_art_still_lists(self):
        """Worlds forged before art existed must not vanish from the gallery."""
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            manager.save_generator(
                theme_desc="An older world",
                theme_desc_better="Old World\nNo art here.",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
            )

            worlds = manager.list_worlds(local_dev=True)

        self.assertEqual(len(worlds), 1)
        self.assertIsNone(worlds[0]["cover_url"])

    def test_a_snapshot_without_a_cover_yields_none(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="A world mid-forge",
                theme_desc_better="Mid Forge\nArt still running.",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
            )
            # Manifest saved before art finished, so it has no cover yet.
            manager.save_generator_visual_manifest(world_id, {"style": "noir"})

            worlds = manager.list_worlds(local_dev=True)

        self.assertIsNone(worlds[0]["cover_url"])

    def test_review_payload_uses_prompt_and_generated_world_data(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            world_id = manager.save_generator(
                theme_desc="A clockwork library under the sea",
                theme_desc_better="Clockwork Library\nA quieter second line",
                language="en",
                player_defs=[{"name": "Diver"}],
                item_defs=[{"id": "key"}],
                enemy_defs=[{"enemy_id": "eel"}],
                celltype_defs={"reef": {}},
            )
            world = manager.get_generator(world_id)

        payload = build_world_review_payload({"id": world_id, **world})

        self.assertEqual(payload["original_prompt"], "A clockwork library under the sea")
        self.assertEqual(payload["generated_title_and_summary"], "Clockwork Library\nA quieter second line")
        self.assertEqual(payload["generated_players"], [{"name": "Diver"}])
        self.assertEqual(payload["generated_items"], [{"id": "key"}])
        self.assertEqual(payload["generated_enemies"], [{"enemy_id": "eel"}])
        self.assertEqual(payload["generated_terrain"], {"reef": {}})
        self.assertNotIn("prompt_and_research_context", payload)

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

    def test_init_db_backfills_world_ownership_columns_on_existing_generators(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {
                "DO_STORAGE_SERVER": "",
                "DO_SPACES_ACCESS_KEY": "",
                "DO_SPACES_SECRET_KEY": "",
                "DO_STORAGE_CONTAINER": "",
            }):
                manager = DatabaseManager()
            manager.db_path = os.path.join(directory, "old_worlds.db")
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
                        celltype_defs TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

            manager.init_db()

            with manager.get_connection() as conn:
                columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(generators)").fetchall()
                }
                row = conn.execute("""
                    SELECT owner_id, visibility, moderation_status, updated_at
                    FROM generators
                    WHERE id = ?
                """, ("oldworld",)).fetchone()

        self.assertIn("owner_id", columns)
        self.assertIn("visibility", columns)
        self.assertIn("moderation_status", columns)
        self.assertIn("moderation_reason", columns)
        self.assertIn("moderation_model", columns)
        self.assertIn("public_requested_at", columns)
        self.assertIn("public_review_after", columns)
        self.assertIn("public_reviewed_at", columns)
        self.assertIn("updated_at", columns)
        self.assertIsNone(row[0])
        self.assertEqual(row[1], "unlisted")
        self.assertEqual(row[2], "not_requested")
        self.assertIsNotNone(row[3])

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

    def test_list_worlds_in_local_dev_excludes_private_without_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            public_id = manager.save_generator(
                theme_desc="Public world",
                theme_desc_better="Public World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="public",
            )
            unlisted_id = manager.save_generator(
                theme_desc="Unlisted world",
                theme_desc_better="Unlisted World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="unlisted",
            )
            manager.save_generator(
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

            worlds = manager.list_worlds(local_dev=True)
            ids = {w["id"] for w in worlds}

        self.assertEqual(ids, {public_id, unlisted_id})

    def test_list_worlds_with_owner_id_returns_owned_worlds_only(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            owned_private = manager.save_generator(
                theme_desc="Owned private world",
                theme_desc_better="Owned Private World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="private",
                owner_id="owner-123",
            )
            owned_public = manager.save_generator(
                theme_desc="Owned public world",
                theme_desc_better="Owned Public World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="public",
                owner_id="owner-123",
            )
            manager.save_generator(
                theme_desc="Other owned world",
                theme_desc_better="Other Owned World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="public",
                owner_id="other-owner",
            )

            worlds = manager.list_worlds(owner_id="owner-123")
            ids = {w["id"] for w in worlds}

        self.assertEqual(ids, {owned_private, owned_public})

    def test_invalid_visibility_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)

            with self.assertRaises(ValueError):
                manager.save_generator(
                    theme_desc="Bad visibility",
                    theme_desc_better="Bad Visibility",
                    language="en",
                    player_defs=[],
                    item_defs=[],
                    enemy_defs=[],
                    celltype_defs={},
                    visibility="secret",
                )

            world_id = manager.save_generator(
                theme_desc="Good visibility",
                theme_desc_better="Good Visibility",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                visibility="unlisted",
            )

            with self.assertRaises(ValueError):
                manager.update_generator_visibility(world_id, "secret")

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
    def setUp(self):
        main.auth_rate_limiter.failures.clear()
        main.signup_rate_limiter.failures.clear()
        main.world_creation_rate_limiter.failures.clear()

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
            self.assertFalse(data["can_manage"])
            self.assertNotIn("owner_id", data)
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
            self.assertFalse(data["can_manage"])
            self.assertNotIn("owner_id", data)

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

    def test_get_world_returns_private_for_owner(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="Secret Base",
                theme_desc_better="Hidden Base",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=user["id"],
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.get(f"/api/worlds/{world_id}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["visibility"], "private")
            self.assertTrue(response.json()["can_manage"])
            self.assertNotIn("owner_id", response.json())

    def test_recent_worlds_returns_public_without_library_flag(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            public_id = manager.save_generator(
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
            manager.save_generator(
                theme_desc="Unlisted Arena",
                theme_desc_better="Quiet Arena",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=None,
                visibility="unlisted"
            )

            with patch.dict(os.environ, {"ENABLE_WORLD_LIBRARY": ""}), \
                    patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.get("/api/worlds/recent?limit=12")

            self.assertEqual(response.status_code, 200)
            worlds = response.json()["worlds"]
            self.assertEqual([world["id"] for world in worlds], [public_id])
            self.assertFalse(worlds[0]["can_manage"])
            self.assertNotIn("owner_id", worlds[0])

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
            self.assertEqual(response.json()["error"], "World not found")

    def test_create_game_session_succeeds_for_private_world_owner(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="Secret Base",
                theme_desc_better="Hidden Base",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=user["id"],
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "theme": "fantasy",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "creating")

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

            with patch.object(main, 'db', manager), \
                    patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "1"}):
                client = TestClient(main.app)
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "theme": "fantasy",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "creating")

    def test_create_game_session_requires_login_for_new_world_when_enabled(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)

            with patch.object(main, 'db', manager), \
                    patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "1"}):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                response = client.post("/api/create_game_session", json={
                    "theme": "Fresh Arena",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 401)
            self.assertEqual(
                response.json()["error"],
                main.LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE,
            )
            self.assertEqual(main.game_session_manager.sessions, {})

    def test_create_game_session_allows_new_world_for_logged_in_user_when_required(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)

            with patch.object(main, 'db', manager), \
                    patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "1"}):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "creator", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/create_game_session", json={
                    "theme": "Fresh Arena",
                    "language": "en",
                    "do_web_search": False
                })

            self.assertEqual(response.status_code, 200)
            session = main.game_session_manager.sessions[response.json()["session_id"]]
            self.assertIsNone(session["generator_id"])
            self.assertTrue(session["creation_request"].do_web_search)

    def test_credit_enabled_forge_charges_when_websocket_starts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)

            class FakeGame:
                def __init__(self, world_id):
                    self.state_manager = SimpleNamespace(
                        generator_id=world_id,
                        error_message=None,
                        state=SimpleNamespace(game_won=False),
                    )

                def add_client(self, websocket):
                    pass

                def remove_client(self, websocket):
                    pass

                async def handle_message(self, message):
                    return {"type": "update"}

            async def fake_create(**kwargs):
                world_id = manager.save_generator(
                    theme_desc=kwargs["theme_desc"],
                    theme_desc_better="Credit World",
                    language=kwargs["language"],
                    player_defs=[],
                    item_defs=[],
                    enemy_defs=[],
                    celltype_defs={},
                    owner_id=kwargs["owner_id"],
                    visibility=kwargs["visibility"],
                )
                return FakeGame(world_id)

            with patch.object(main, "db", manager), \
                    patch("main.Game.create", side_effect=fake_create), \
                    patch.dict(os.environ, {
                        "ENABLE_WORLD_CREDITS": "1",
                        "WELCOME_CREDITS": "30",
                        "WORLD_FORGE_CREDIT_COST": "10",
                    }):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                signup = client.post("/api/signup", json={
                    "username": "creditplayer",
                    "password": VALID_TEST_PASSWORD,
                })
                self.assertEqual(signup.json()["credits"]["total"], 30)

                response = client.post("/api/create_game_session", json={
                    "theme": "A credit world",
                    "language": "en",
                })
                session_id = response.json()["session_id"]
                self.assertEqual(
                    manager.get_credit_balance(
                        manager.get_user_by_username("creditplayer")["id"]
                    )["total"],
                    30,
                )

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "ready")
                    self.assertEqual(
                        websocket.receive_json()["type"], "connection_established"
                    )

                user_id = manager.get_user_by_username("creditplayer")["id"]
                self.assertEqual(manager.get_credit_balance(user_id)["total"], 20)

    def test_failed_credit_enabled_forge_is_refunded(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)

            with patch.object(main, "db", manager), \
                    patch("main.Game.create", side_effect=RuntimeError("forge failed")), \
                    patch.dict(os.environ, {
                        "ENABLE_WORLD_CREDITS": "1",
                        "WELCOME_CREDITS": "30",
                        "WORLD_FORGE_CREDIT_COST": "10",
                    }):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                client.post("/api/signup", json={
                    "username": "refundplayer",
                    "password": VALID_TEST_PASSWORD,
                })
                response = client.post("/api/create_game_session", json={
                    "theme": "A broken forge",
                    "language": "en",
                })
                session_id = response.json()["session_id"]

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    error = websocket.receive_json()

                user_id = manager.get_user_by_username("refundplayer")["id"]
                self.assertEqual(error["type"], "error")
                self.assertEqual(manager.get_credit_balance(user_id)["total"], 30)
                self.assertEqual(
                    main.game_session_manager.sessions[session_id]["status"], "error"
                )

    def test_websocket_win_records_popularity_and_capped_reward_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            creator = manager.create_user("rewardcreator", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="Reward World",
                theme_desc_better="Reward World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=creator["id"],
                visibility="public",
            )

            class WinningGame:
                def __init__(self):
                    self.state_manager = SimpleNamespace(
                        generator_id=world_id,
                        error_message=None,
                        state=SimpleNamespace(game_won=False),
                    )

                def add_client(self, websocket):
                    pass

                def remove_client(self, websocket):
                    pass

                async def handle_message(self, message):
                    self.state_manager.state.game_won = True
                    return {"type": "update", "state": {"game_won": True}}

            with patch.object(main, "db", manager), \
                    patch("main.Game.create", return_value=WinningGame()), \
                    patch(
                        "main.get_creator_milestone_rewards",
                        return_value=((1, 5),),
                    ), \
                    patch.dict(os.environ, {
                        "ENABLE_WORLD_CREDITS": "1",
                        "WELCOME_CREDITS": "30",
                        "COMPLETION_REWARD_CREDITS": "1",
                        "COMPLETION_REWARD_DAILY_CAP": "5",
                    }):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                client.post("/api/signup", json={
                    "username": "winner",
                    "password": VALID_TEST_PASSWORD,
                })
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "language": "en",
                })
                session_id = response.json()["session_id"]

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "ready")
                    websocket.receive_json()
                    websocket.send_json({"action": "get_initial_state"})
                    win = websocket.receive_json()

                user_id = manager.get_user_by_username("winner")["id"]
                reward = win["completion_reward"]
                self.assertTrue(reward["reward_granted"])
                self.assertTrue(reward["rewards_enabled"])
                self.assertEqual(reward["credits_granted"], 1)
                self.assertTrue(reward["creator_reward"]["reward_granted"])
                self.assertEqual(reward["creator_reward"]["credits_granted"], 5)
                self.assertEqual(reward["creator_reward"]["milestone_players"], 1)
                self.assertEqual(manager.get_credit_balance(user_id)["total"], 31)
                self.assertEqual(
                    manager.get_credit_balance(creator["id"])["total"], 5
                )
                self.assertEqual(manager.get_world_metrics(world_id), {
                    "play_count": 1,
                    "completion_count": 1,
                    "unique_completer_count": 1,
                })

    def test_owner_gets_one_free_staged_core_art_reroll(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            owner = manager.create_user("artist", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="Art World",
                theme_desc_better="Art World",
                language="en",
                player_defs=[{"name": "Hero"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs=[{"id": "street", "name": "Street"}],
                owner_id=owner["id"],
                visibility="private",
            )
            manifest = {
                "style": "paper-cut adventure art",
                "palette": ["#102030", "#405060"],
                "exclusions": [],
                "characters": [
                    {"id": "player", "kind": "player", "identity": "A hero"}
                ],
                "locations": [
                    {"id": "street", "identity": "A moonlit street"}
                ],
            }
            manager.save_generator_visual_manifest(world_id, manifest)
            manager.save_generator_translation(
                generator_id=world_id,
                language="it",
                theme_desc_better="Mondo d'arte",
                player_defs=[{"name": "Eroe"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs=[{"id": "street", "name": "Strada"}],
                translation_version=5,
            )

            async def fake_generate(
                    visual_manifest, target_world_id, generator=None,
                    assets_dir=None, on_progress=None, tier=None,
            ):
                from PIL import Image
                from gen_image import save_asset

                image = Image.new("RGBA", (32, 32), (40, 120, 180, 255))
                frames = {
                    name: save_asset(
                        image, target_world_id, f"player-{name}", assets_dir
                    )
                    for name in ("neutral", "attack", "defeat")
                }
                frames["token"] = save_asset(
                    image, target_world_id, "player-token", assets_dir
                )
                return {
                    "characters": {"player": frames},
                    "locations": {
                        "street": save_asset(
                            image, target_world_id, "location-street", assets_dir
                        )
                    },
                    "cover": save_asset(
                        image, target_world_id, "cover", assets_dir
                    ),
                }

            assets_dir = os.path.join(tmpdir, "assets")
            with patch.object(main, "db", manager), \
                    patch("main.generate_world_art", side_effect=fake_generate), \
                    patch.dict(os.environ, {
                        "ENABLE_WORLD_ART": "1",
                        "WORLD_ASSETS_DIR": assets_dir,
                    }):
                client = TestClient(main.app)
                client.post("/api/login", json={
                    "username": "artist",
                    "password": VALID_TEST_PASSWORD,
                })
                before = client.get("/api/my/worlds").json()["worlds"][0]
                first = client.post(f"/api/worlds/{world_id}/art/reroll")
                second = client.post(f"/api/worlds/{world_id}/art/reroll")

            self.assertTrue(before["can_reroll_art"])
            self.assertEqual(first.status_code, 200)
            self.assertFalse(first.json()["can_reroll_art"])
            self.assertIn("?v=", first.json()["cover_url"])
            self.assertEqual(second.status_code, 409)
            stored = manager.get_generator(world_id)
            self.assertIn("?v=", stored["player_defs"][0]["sprite_url"])
            translated = manager.get_generator_translation(world_id, "it", 5)
            self.assertIn("?v=", translated["player_defs"][0]["sprite_url"])
            self.assertTrue(os.path.exists(
                os.path.join(assets_dir, world_id, "cover.webp")
            ))

    def test_websocket_rejects_unauthenticated_new_world_when_required(self):
        session_id = "auth-required-session"
        main.game_session_manager.sessions.clear()
        main.game_session_manager.sessions[session_id] = {
            "created_at": 0,
            "last_accessed": 0,
            "game_instance": None,
            "creation_request": main.GameCreationRequest(
                theme="Fresh Arena",
                language="en",
                do_web_search=True,
            ),
            "status": "creating",
            "generator_id": None,
            "language": "en",
            "debug_seed": None,
        }

        with patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "1"}), \
                patch("main.Game.create", new_callable=AsyncMock) as create_game:
            client = TestClient(main.app)
            with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                self.assertEqual(websocket.receive_json()["status"], "creating")
                error = websocket.receive_json()

        self.assertEqual(error["type"], "error")
        self.assertEqual(error["message"], main.LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE)
        create_game.assert_not_awaited()

    def test_my_worlds_requires_login_and_returns_owned_worlds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            owner = manager.create_user("owner", VALID_TEST_PASSWORD)
            manager.create_user("other", VALID_TEST_PASSWORD)
            owned_private = manager.save_generator(
                theme_desc="Owned private world",
                theme_desc_better="Owned Private World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=owner["id"],
                visibility="private"
            )
            owned_public = manager.save_generator(
                theme_desc="Owned public world",
                theme_desc_better="Owned Public World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=owner["id"],
                visibility="public"
            )
            manager.save_generator(
                theme_desc="Other private world",
                theme_desc_better="Other Private World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id="other-owner",
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                anonymous = client.get("/api/my/worlds")
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.get("/api/my/worlds")

            self.assertEqual(anonymous.status_code, 401)
            self.assertEqual(response.status_code, 200)
            worlds = response.json()["worlds"]
            ids = {world["id"] for world in worlds}
            self.assertEqual(ids, {owned_private, owned_public})
            self.assertTrue(all(world["can_manage"] for world in worlds))
            self.assertTrue(all("owner_id" not in world for world in worlds))

    def test_my_stats_requires_login_and_counts_owned_worlds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            owner = manager.create_user("owner", VALID_TEST_PASSWORD)
            manager.save_generator(
                theme_desc="Owned private world",
                theme_desc_better="Owned Private World",
                language="en",
                player_defs=[{"id": "hero"}, {"id": "mage"}],
                item_defs=[{"id": "lamp"}],
                enemy_defs=[{"id": "bat"}],
                celltype_defs={"floor": {}, "wall": {}},
                owner_id=owner["id"],
                visibility="private"
            )
            manager.save_generator(
                theme_desc="Owned public world",
                theme_desc_better="Owned Public World",
                language="en",
                player_defs=[],
                item_defs=[{"id": "key"}],
                enemy_defs=[],
                celltype_defs={},
                owner_id=owner["id"],
                visibility="public"
            )
            manager.save_generator(
                theme_desc="Owned unlisted world",
                theme_desc_better="Owned Unlisted World",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[{"id": "shade"}, {"id": "wisp"}],
                celltype_defs=[{"id": "fog"}],
                owner_id=owner["id"],
                visibility="unlisted"
            )
            manager.save_generator(
                theme_desc="Other private world",
                theme_desc_better="Other Private World",
                language="en",
                player_defs=[{"id": "other"}],
                item_defs=[{"id": "other-key"}],
                enemy_defs=[],
                celltype_defs={},
                owner_id="other-owner",
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                anonymous = client.get("/api/my/stats")
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.get("/api/my/stats")

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["username"], "owner")
        self.assertEqual(data["stats"], {
            "total_worlds": 3,
            "private_worlds": 1,
            "unlisted_worlds": 1,
            "public_worlds": 1,
            "total_entities": 10,
            "total_plays": 0,
            "total_completions": 0,
            "unique_completers": 0,
            "creator_reward_credits": 0,
        })

    def test_websocket_creation_succeeds_for_private_world_owner(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="Secret Base",
                theme_desc_better="Hidden Base",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=user["id"],
                visibility="private"
            )
            created_with = {}

            class FakeGame:
                state_manager = SimpleNamespace(generator_id=world_id, error_message=None)

                def add_client(self, websocket):
                    pass

                def remove_client(self, websocket):
                    pass

                async def handle_message(self, message):
                    return {"type": "update"}

            async def fake_create(**kwargs):
                created_with.update(kwargs)
                return FakeGame()

            with patch.object(main, 'db', manager), \
                    patch("main.Game.create", side_effect=fake_create):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/create_game_session", json={
                    "generator_id": world_id,
                    "language": "en",
                    "do_web_search": False
                })
                session_id = response.json()["session_id"]

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "ready")
                    self.assertEqual(websocket.receive_json()["type"], "connection_established")

            self.assertEqual(created_with["generator_id"], world_id)

    def test_logged_in_custom_world_appears_in_my_worlds_after_creation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            created_with = {}
            generated_world_id = None

            class FakeGame:
                state_manager = SimpleNamespace(generator_id=None, error_message=None)

                def add_client(self, websocket):
                    pass

                def remove_client(self, websocket):
                    pass

                async def handle_message(self, message):
                    return {"type": "update"}

            async def fake_create(**kwargs):
                nonlocal generated_world_id
                created_with.update(kwargs)
                generated_world_id = manager.save_generator(
                    theme_desc=kwargs["theme_desc"],
                    theme_desc_better="Clockwork Meadow",
                    language=kwargs["language"],
                    player_defs=[],
                    item_defs=[],
                    enemy_defs=[],
                    celltype_defs={},
                    owner_id=kwargs["owner_id"],
                    visibility=kwargs["visibility"],
                )
                game = FakeGame()
                game.state_manager.generator_id = generated_world_id
                return game

            with patch.object(main, 'db', manager), \
                    patch("main.Game.create", side_effect=fake_create), \
                    patch.dict(os.environ, {"DEFAULT_NEW_WORLD_VISIBILITY": "private"}):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/create_game_session", json={
                    "theme": "Clockwork meadow",
                    "language": "en",
                    "do_web_search": False,
                })
                session_id = response.json()["session_id"]

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "ready")
                    self.assertEqual(websocket.receive_json()["type"], "connection_established")

                my_worlds = client.get("/api/my/worlds")

            self.assertEqual(created_with["theme_desc"], "Clockwork meadow")
            self.assertTrue(created_with["do_web_search"])
            self.assertIsNotNone(created_with["owner_id"])
            self.assertEqual(created_with["visibility"], "private")
            self.assertEqual(my_worlds.status_code, 200)
            worlds = my_worlds.json()["worlds"]
            self.assertEqual([world["id"] for world in worlds], [generated_world_id])
            self.assertEqual(worlds[0]["visibility"], "private")
            self.assertTrue(worlds[0]["can_manage"])


class AuthTests(unittest.TestCase):
    def setUp(self):
        main.auth_rate_limiter.failures.clear()
        main.signup_rate_limiter.failures.clear()
        main.world_creation_rate_limiter.failures.clear()

    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "test_auth.db")
        manager.init_db()
        return manager

    def test_signup_creates_user_and_stores_session(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.post("/api/signup", json={"username": "alice", "password": VALID_TEST_PASSWORD})

            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["username"], "alice")
            self.assertNotIn("id", data)

    def test_signup_rejects_duplicate_username(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "bob", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/signup", json={"username": "bob", "password": OTHER_VALID_TEST_PASSWORD})

            self.assertEqual(response.status_code, 409)

    def test_signup_rejects_short_username_or_weak_password(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                r1 = client.post("/api/signup", json={"username": "ab", "password": VALID_TEST_PASSWORD})
                r2 = client.post("/api/signup", json={"username": "alice", "password": "short"})
                r3 = client.post("/api/signup", json={"username": "alice", "password": "alexandria"})
                r4 = client.post("/api/signup", json={"username": "alice", "password": "Aaaaaaaa1!"})
                r5 = client.post("/api/signup", json={"username": "alice", "password": "AliceSafe123!"})

            self.assertEqual(r1.status_code, 400)
            self.assertEqual(r2.status_code, 400)
            self.assertEqual(r3.status_code, 400)
            self.assertEqual(r3.json()["error"], main.PASSWORD_POLICY_MESSAGE)
            self.assertEqual(r4.status_code, 400)
            self.assertEqual(
                r4.json()["error"],
                "Password is too repetitive. Choose a less predictable password."
            )
            self.assertEqual(r5.status_code, 400)
            self.assertEqual(r5.json()["error"], "Password must not include your username.")

    def test_login_stores_session_and_me_returns_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "carol", "password": VALID_TEST_PASSWORD})
                login = client.post("/api/login", json={"username": "carol", "password": VALID_TEST_PASSWORD})
                self.assertEqual(login.status_code, 200)
                self.assertNotIn("id", login.json())

                me = client.get("/api/me")
                self.assertEqual(me.status_code, 200)
                self.assertEqual(me.json()["username"], "carol")
                self.assertNotIn("id", me.json())

    def test_login_rejects_bad_password(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "dave", "password": VALID_TEST_PASSWORD})
                response = client.post("/api/login", json={"username": "dave", "password": "wrongpass"})

            self.assertEqual(response.status_code, 401)

    def test_login_rate_limits_repeated_bad_passwords(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            rate_limiter = main.AuthRateLimiter(max_attempts=2, window_seconds=60)
            with patch.object(main, 'db', manager), \
                    patch.object(main, 'auth_rate_limiter', rate_limiter):
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "frank", "password": VALID_TEST_PASSWORD})
                first = client.post("/api/login", json={"username": "frank", "password": "wrongpass"})
                second = client.post("/api/login", json={"username": "frank", "password": "wrongpass"})
                limited = client.post("/api/login", json={"username": "frank", "password": VALID_TEST_PASSWORD})

            self.assertEqual(first.status_code, 401)
            self.assertEqual(second.status_code, 401)
            self.assertEqual(limited.status_code, 429)

    def test_signup_rate_limits_repeated_attempts_by_client(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            rate_limiter = main.AuthRateLimiter(max_attempts=2, window_seconds=60)
            with patch.object(main, 'db', manager), \
                    patch.object(main, 'signup_rate_limiter', rate_limiter):
                client = TestClient(main.app)
                first = client.post("/api/signup", json={"username": "alpha", "password": VALID_TEST_PASSWORD})
                second = client.post("/api/signup", json={"username": "bravo", "password": VALID_TEST_PASSWORD})
                limited = client.post("/api/signup", json={"username": "charlie", "password": VALID_TEST_PASSWORD})

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json()["error"], main.SIGNUP_RATE_LIMIT_MESSAGE)
            self.assertIn("Retry-After", limited.headers)

    def test_new_world_creation_rate_limits_repeated_attempts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            rate_limiter = main.AuthRateLimiter(max_attempts=1, window_seconds=60)
            with patch.object(main, 'db', manager), \
                    patch.object(main, 'world_creation_rate_limiter', rate_limiter), \
                    patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "0"}):
                main.game_session_manager.sessions.clear()
                client = TestClient(main.app)
                first = client.post("/api/create_game_session", json={
                    "theme": "Clockwork canyon",
                    "language": "en",
                    "do_web_search": False,
                })
                limited = client.post("/api/create_game_session", json={
                    "theme": "Crystal forest",
                    "language": "en",
                    "do_web_search": False,
                })

            self.assertEqual(first.status_code, 200)
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json()["error"], main.WORLD_CREATION_RATE_LIMIT_MESSAGE)
            self.assertIn("Retry-After", limited.headers)

    def test_legacy_new_world_creation_uses_world_creation_rate_limit(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            rate_limiter = main.AuthRateLimiter(max_attempts=1, window_seconds=60)
            with patch.object(main, 'db', manager), \
                    patch.object(main, 'world_creation_rate_limiter', rate_limiter), \
                    patch.dict(os.environ, {"REQUIRE_LOGIN_TO_CREATE_WORLD": "0"}):
                client = TestClient(main.app)
                first = client.post("/api/create_game", json={
                    "theme": "Clockwork canyon",
                    "language": "en",
                    "do_web_search": False,
                })
                limited = client.post("/api/create_game", json={
                    "theme": "Crystal forest",
                    "language": "en",
                    "do_web_search": False,
                })

            self.assertEqual(first.status_code, 200)
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json()["error"], main.WORLD_CREATION_RATE_LIMIT_MESSAGE)
            self.assertIn("Retry-After", limited.headers)

    def test_logout_clears_session(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/signup", json={"username": "eve", "password": VALID_TEST_PASSWORD})
                client.post("/api/logout")
                me = client.get("/api/me")

            self.assertEqual(me.status_code, 401)

    def test_me_returns_401_when_anonymous(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.get("/api/me")

            self.assertEqual(response.status_code, 401)


class AdminTests(unittest.TestCase):
    def setUp(self):
        main.auth_rate_limiter.failures.clear()
        main.signup_rate_limiter.failures.clear()
        main.world_creation_rate_limiter.failures.clear()

    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "test_admin.db")
        manager.init_db()
        return manager

    def test_admin_area_is_ignored_without_admin_access(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            manager.create_user("admin", VALID_TEST_PASSWORD)
            manager.create_user("player", VALID_TEST_PASSWORD)

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "ADMIN_USERNAMES": "",
                "ADMIN_USERNAME": "",
            }):
                client = TestClient(main.app)
                client.post("/api/login", json={
                    "username": "admin",
                    "password": VALID_TEST_PASSWORD,
                })
                disabled_page = client.get("/admin")
                disabled_api = client.get("/api/admin/users")

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "ADMIN_USERNAMES": "admin",
                "ADMIN_USERNAME": "",
            }):
                client = TestClient(main.app)
                anonymous_page = client.get("/admin")
                client.post("/api/login", json={
                    "username": "player",
                    "password": VALID_TEST_PASSWORD,
                })
                non_admin_page = client.get("/admin")
                non_admin_api = client.get("/api/admin/users")

        self.assertEqual(disabled_page.status_code, 404)
        self.assertEqual(disabled_api.status_code, 404)
        self.assertEqual(anonymous_page.status_code, 404)
        self.assertEqual(non_admin_page.status_code, 404)
        self.assertEqual(non_admin_api.status_code, 404)

    def test_admin_can_list_registered_users_with_world_counts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            manager.create_user("admin", VALID_TEST_PASSWORD)
            alice = manager.create_user("alice", VALID_TEST_PASSWORD)
            bob = manager.create_user("bob", VALID_TEST_PASSWORD)
            manager.set_user_password_reset_required(bob["id"], True)
            manager.save_generator(
                theme_desc="Alice private",
                theme_desc_better="Alice Private",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=alice["id"],
                visibility="private",
            )
            manager.save_generator(
                theme_desc="Alice public",
                theme_desc_better="Alice Public",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=alice["id"],
                visibility="public",
            )
            manager.save_generator(
                theme_desc="Bob unlisted",
                theme_desc_better="Bob Unlisted",
                language="en",
                player_defs=[],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=bob["id"],
                visibility="unlisted",
            )

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "ADMIN_USERNAMES": "admin",
                "ADMIN_USERNAME": "",
            }):
                client = TestClient(main.app)
                client.post("/api/login", json={
                    "username": "admin",
                    "password": VALID_TEST_PASSWORD,
                })
                page = client.get("/admin")
                response = client.get("/api/admin/users")

        self.assertEqual(page.status_code, 200)
        self.assertIn("/static/js/admin.js", page.text)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("password_hash", response.text)
        data = response.json()
        self.assertEqual(data["admin"]["username"], "admin")
        users = {user["username"]: user for user in data["users"]}
        self.assertEqual(users["admin"]["stats"]["total_worlds"], 0)
        self.assertEqual(users["alice"]["stats"], {
            "total_worlds": 2,
            "private_worlds": 1,
            "unlisted_worlds": 0,
            "public_worlds": 1,
        })
        self.assertEqual(users["bob"]["stats"], {
            "total_worlds": 1,
            "private_worlds": 0,
            "unlisted_worlds": 1,
            "public_worlds": 0,
        })
        self.assertTrue(users["bob"]["password_reset_required"])
        self.assertIsNotNone(users["bob"]["password_reset_marked_at"])

    def test_admin_can_toggle_password_reset_required(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            manager.create_user("admin", VALID_TEST_PASSWORD)
            target = manager.create_user("target", VALID_TEST_PASSWORD)

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "ADMIN_USERNAMES": "admin",
                "ADMIN_USERNAME": "",
            }):
                client = TestClient(main.app)
                client.post("/api/login", json={
                    "username": "admin",
                    "password": VALID_TEST_PASSWORD,
                })
                set_response = client.patch(
                    f"/api/admin/users/{target['id']}/password-reset",
                    json={"password_reset_required": True},
                )
                after_set = client.get("/api/admin/users")
                clear_response = client.patch(
                    f"/api/admin/users/{target['id']}/password-reset",
                    json={"password_reset_required": False},
                )
                after_clear = client.get("/api/admin/users")

        self.assertEqual(set_response.status_code, 200)
        self.assertTrue(set_response.json()["password_reset_required"])
        users_after_set = {
            user["username"]: user
            for user in after_set.json()["users"]
        }
        self.assertTrue(users_after_set["target"]["password_reset_required"])
        self.assertIsNotNone(users_after_set["target"]["password_reset_marked_at"])

        self.assertEqual(clear_response.status_code, 200)
        self.assertFalse(clear_response.json()["password_reset_required"])
        users_after_clear = {
            user["username"]: user
            for user in after_clear.json()["users"]
        }
        self.assertFalse(users_after_clear["target"]["password_reset_required"])
        self.assertIsNone(users_after_clear["target"]["password_reset_marked_at"])


class VisibilityControlTests(unittest.TestCase):
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

    def test_owner_can_change_visibility_to_unlisted(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            owner_id = user["id"]
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden\nA quiet place",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[{"id": "shears"}],
                enemy_defs=[{"id": "rabbit"}],
                celltype_defs={"grass": {"name": "Grass"}},
                owner_id=owner_id,
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "unlisted"})

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["visibility"], "unlisted")
            updated = manager.get_generator(world_id)
            self.assertEqual(updated["visibility"], "unlisted")
            self.assertEqual(updated["moderation_status"], "not_requested")

    def test_owner_public_visibility_reviews_immediately_when_queue_has_capacity(self):
        async def approve_public_review(db_manager, world):
            db_manager.record_public_review(
                generator_id=world["id"],
                requested_by_owner_id=world.get("owner_id"),
                model_name="internal-reviewer",
                decision="approve",
                confidence=0.98,
                categories=[],
                public_reason="Approved for public listing.",
                internal_notes="No issues found.",
            )
            return True

        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            owner_id = user["id"]
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden\nA quiet place",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[{"id": "shears"}],
                enemy_defs=[{"id": "rabbit"}],
                celltype_defs={"grass": {"name": "Grass"}},
                owner_id=owner_id,
                visibility="private"
            )

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "WORLD_PUBLIC_REVIEW_IMMEDIATE_ENABLED": "1",
                "WORLD_PUBLIC_REVIEW_IMMEDIATE_MAX_PENDING": "3",
                "WORLD_PUBLIC_REVIEW_DELAY_SECONDS": "0",
            }), patch("main.process_public_world_review", side_effect=approve_public_review) as review_mock:
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "public"})

            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["visibility"], "public")
            self.assertEqual(body["moderation_status"], "approved")
            self.assertNotIn("moderation_model", body)
            review_mock.assert_awaited_once()
            updated = manager.get_generator(world_id)
            self.assertEqual(updated["visibility"], "public")
            self.assertEqual(updated["moderation_status"], "approved")
            self.assertEqual(updated["moderation_model"], "internal-reviewer")

    def test_owner_public_visibility_queues_review_when_queue_is_overwhelmed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            owner_id = user["id"]
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden\nA quiet place",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[{"id": "shears"}],
                enemy_defs=[{"id": "rabbit"}],
                celltype_defs={"grass": {"name": "Grass"}},
                owner_id=owner_id,
                visibility="private"
            )

            with patch.object(main, 'db', manager), patch.dict(os.environ, {
                "WORLD_PUBLIC_REVIEW_IMMEDIATE_ENABLED": "1",
                "WORLD_PUBLIC_REVIEW_IMMEDIATE_MAX_PENDING": "0",
                "WORLD_PUBLIC_REVIEW_DELAY_SECONDS": "0",
                "WORLD_PUBLIC_REVIEW_MODEL_NAME": "review-model",
            }), patch("main.process_public_world_review", new_callable=AsyncMock) as review_mock:
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "public"})

            self.assertEqual(response.status_code, 202)
            body = response.json()
            self.assertEqual(body["visibility"], "private")
            self.assertEqual(body["moderation_status"], "pending")
            self.assertNotIn("moderation_model", body)
            review_mock.assert_not_awaited()
            updated = manager.get_generator(world_id)
            self.assertEqual(updated["visibility"], "private")
            self.assertEqual(updated["moderation_status"], "pending")
            self.assertEqual(updated["moderation_model"], "review-model")

    def test_public_review_approval_publishes_world(self):
        class ApprovingReviewer:
            model_name = "review-model"

            async def review_world(self, world):
                return WorldPublicReviewResult(
                    decision="approve",
                    confidence=0.98,
                    categories=[],
                    public_reason="Approved for public listing.",
                    internal_notes="No issues found.",
                )

        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden\nA quiet place",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[{"id": "shears"}],
                enemy_defs=[{"id": "rabbit"}],
                celltype_defs={"grass": {"name": "Grass"}},
                owner_id=user["id"],
                visibility="private"
            )
            queued = manager.request_public_visibility(
                world_id,
                requested_by_owner_id=user["id"],
                review_delay_seconds=0,
                reviewer_model="review-model",
            )
            self.assertEqual(queued["moderation_status"], "pending")

            processed_count = asyncio.run(process_due_public_world_reviews(
                manager,
                reviewer=ApprovingReviewer(),
            ))

            self.assertEqual(processed_count, 1)
            updated = manager.get_generator(world_id)
            self.assertEqual(updated["visibility"], "public")
            self.assertEqual(updated["moderation_status"], "approved")
            self.assertEqual(updated["moderation_model"], "review-model")
            self.assertEqual(updated["moderation_confidence"], 0.98)
            self.assertIsNotNone(updated["public_reviewed_at"])

    def test_public_review_rejection_does_not_publish_world(self):
        class RejectingReviewer:
            model_name = "review-model"

            async def review_world(self, world):
                return WorldPublicReviewResult(
                    decision="reject",
                    confidence=0.92,
                    categories=["pii"],
                    public_reason="This World cannot be published publicly in its current form.",
                    internal_notes="Private information risk.",
                )

        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden\nA quiet place",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[{"id": "shears"}],
                enemy_defs=[{"id": "rabbit"}],
                celltype_defs={"grass": {"name": "Grass"}},
                owner_id=user["id"],
                visibility="unlisted"
            )
            manager.request_public_visibility(
                world_id,
                requested_by_owner_id=user["id"],
                review_delay_seconds=0,
                reviewer_model="review-model",
            )

            processed_count = asyncio.run(process_due_public_world_reviews(
                manager,
                reviewer=RejectingReviewer(),
            ))

            self.assertEqual(processed_count, 1)
            updated = manager.get_generator(world_id)
            self.assertEqual(updated["visibility"], "unlisted")
            self.assertEqual(updated["moderation_status"], "rejected")
            self.assertEqual(updated["moderation_categories"], ["pii"])

    def test_anonymous_cannot_change_visibility(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id="owner-123",
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "public"})

            self.assertEqual(response.status_code, 401)

    def test_non_owner_cannot_change_visibility(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            owner = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=owner["id"],
                visibility="private"
            )
            manager.create_user("other", VALID_TEST_PASSWORD)

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "other", "password": VALID_TEST_PASSWORD})
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "public"})

            self.assertEqual(response.status_code, 403)

    def test_invalid_visibility_rejected(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            user = manager.create_user("owner", VALID_TEST_PASSWORD)
            world_id = manager.save_generator(
                theme_desc="A hidden garden",
                theme_desc_better="Hidden Garden",
                language="en",
                player_defs=[{"name": "Gardener"}],
                item_defs=[],
                enemy_defs=[],
                celltype_defs={},
                owner_id=user["id"],
                visibility="private"
            )

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.patch(f"/api/worlds/{world_id}/visibility", json={"visibility": "super-secret"})

            self.assertEqual(response.status_code, 400)

    def test_missing_world_returns_404(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = self.make_db(tmpdir)
            manager.create_user("owner", VALID_TEST_PASSWORD)

            with patch.object(main, 'db', manager):
                client = TestClient(main.app)
                client.post("/api/login", json={"username": "owner", "password": VALID_TEST_PASSWORD})
                response = client.patch("/api/worlds/nonexistent/visibility", json={"visibility": "public"})

            self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

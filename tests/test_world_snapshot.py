import os
import random
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from db import DatabaseManager
from game_state_manager import GameStateManager, WORLD_SNAPSHOT_VERSION
from world_moderation import build_world_review_payload, collect_baked_prose


CELLTYPE_DEFS = [
    {"id": "street", "name": "Street", "description": "A wet street"},
    {"id": "market", "name": "Market", "description": "A loud market"},
]


def make_manager(map_width=3, map_height=2, language="en", generator_id="world-1"):
    """Build a bare manager with only what the snapshot paths touch."""
    manager = GameStateManager.__new__(GameStateManager)
    manager.random = random.Random(0)
    manager.language = language
    manager.generator_id = generator_id
    manager.error_message = None
    manager._generated_tile_info = []
    manager._snapshot_tile_info_by_language = {}
    manager.entity_placements = []
    manager.definitions = SimpleNamespace(
        celltype_defs=list(CELLTYPE_DEFS),
        enemy_defs=[{"enemy_id": "punk"}],
        item_defs=[{"id": "coffee"}],
    )
    manager.state = SimpleNamespace(
        map_width=map_width,
        map_height=map_height,
        cell_types=[],
        tile_info=[],
        # Present on the real GameState; tile generation reads both to give the
        # prompt its area context.
        regions=[],
        region_ids=[],
    )
    return manager


class WorldSnapshotStorageTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "test_snapshot.db")
        manager.init_db()
        return manager

    def test_snapshot_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            db.save_generator_world(
                generator_id="world-1",
                language="en",
                map_csv="street,market\nmarket,street",
                entity_placements=[{"type": "enemy", "entity_id": "punk", "x": 1, "y": 0}],
                tile_info_by_language={"en": [{"x": 0, "y": 0, "label": "Wet Street"}]},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            snapshot = db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION)

        self.assertEqual(snapshot["language"], "en")
        self.assertEqual(snapshot["map_csv"], "street,market\nmarket,street")
        self.assertEqual(snapshot["entity_placements"][0]["entity_id"], "punk")
        self.assertEqual(snapshot["tile_info_by_language"]["en"][0]["label"], "Wet Street")

    def test_saving_twice_updates_instead_of_duplicating(self):
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            for csv in ("street,street", "market,market"):
                db.save_generator_world(
                    generator_id="world-1",
                    language="en",
                    map_csv=csv,
                    entity_placements=[],
                    tile_info_by_language={},
                    snapshot_version=WORLD_SNAPSHOT_VERSION,
                )

            snapshot = db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION)

        self.assertEqual(snapshot["map_csv"], "market,market")

    def test_manifest_and_snapshot_do_not_clobber_each_other(self):
        """The manifest is written at forge time and the snapshot when a run
        first initializes, so whichever lands second must leave the other."""
        manifest = {"style": "Muted pixel art", "palette": ["#101018"]}

        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)

            db.save_generator_visual_manifest("world-1", manifest, WORLD_SNAPSHOT_VERSION)
            db.save_generator_world(
                generator_id="world-1",
                language="en",
                map_csv="street,market",
                entity_placements=[{"type": "enemy", "entity_id": "punk", "x": 1, "y": 0}],
                tile_info_by_language={"en": [{"label": "Wet Street"}]},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            after_snapshot = db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION)

            # And the reverse order, which happens when a World is re-forged.
            db.save_generator_visual_manifest("world-1", manifest, WORLD_SNAPSHOT_VERSION)
            after_manifest = db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION)

        self.assertEqual(after_snapshot["visual_manifest"], manifest)
        self.assertEqual(after_snapshot["map_csv"], "street,market")
        self.assertEqual(after_manifest["map_csv"], "street,market")
        self.assertEqual(after_manifest["entity_placements"][0]["entity_id"], "punk")

    def test_manifest_is_absent_until_written(self):
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            db.save_generator_world(
                generator_id="world-1",
                language="en",
                map_csv="street,market",
                entity_placements=[],
                tile_info_by_language={},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            self.assertIsNone(
                db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION)["visual_manifest"]
            )

    def test_missing_snapshot_returns_none(self):
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            self.assertIsNone(db.get_generator_world("absent", WORLD_SNAPSHOT_VERSION))

    def test_stale_snapshot_version_is_not_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            db.save_generator_world(
                generator_id="world-1",
                language="en",
                map_csv="street,street",
                entity_placements=[],
                tile_info_by_language={},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            self.assertIsNone(
                db.get_generator_world("world-1", WORLD_SNAPSHOT_VERSION + 1)
            )

    def test_snapshot_survives_generator_resave(self):
        """save_generator uses INSERT OR REPLACE, which is why the snapshot
        lives in its own table rather than in extra generators columns."""
        with tempfile.TemporaryDirectory() as directory:
            db = self.make_db(directory)
            world_id = db.save_generator(
                theme_desc="A wet city",
                theme_desc_better="Wet City\nSecond line",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[{"id": "coffee"}],
                enemy_defs=[{"enemy_id": "punk"}],
                celltype_defs=CELLTYPE_DEFS,
            )
            db.save_generator_world(
                generator_id=world_id,
                language="en",
                map_csv="street,market",
                entity_placements=[],
                tile_info_by_language={},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            db.save_generator(
                theme_desc="A wet city",
                theme_desc_better="Wet City\nSecond line",
                language="en",
                player_defs=[{"name": "Runner"}],
                item_defs=[{"id": "coffee"}],
                enemy_defs=[{"enemy_id": "punk"}],
                celltype_defs=CELLTYPE_DEFS,
            )

            snapshot = db.get_generator_world(world_id, WORLD_SNAPSHOT_VERSION)

        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["map_csv"], "street,market")


class MapSerializationTests(unittest.TestCase):
    def test_map_csv_round_trips_through_cell_ids(self):
        manager = make_manager(map_width=2, map_height=2)
        manager.state.cell_types = [
            [CELLTYPE_DEFS[0], CELLTYPE_DEFS[1]],
            [CELLTYPE_DEFS[1], CELLTYPE_DEFS[0]],
        ]

        map_csv = manager._map_csv_from_cell_types()
        rehydrated = manager._cell_types_from_map_csv(map_csv)

        self.assertEqual(map_csv, "street,market\nmarket,street")
        self.assertEqual(rehydrated, manager.state.cell_types)

    def test_dimension_mismatch_falls_back_to_generation(self):
        manager = make_manager(map_width=3, map_height=2)

        self.assertIsNone(manager._cell_types_from_map_csv("street,market"))

    def test_unknown_cell_type_falls_back_to_generation(self):
        manager = make_manager(map_width=2, map_height=1)

        self.assertIsNone(manager._cell_types_from_map_csv("street,rooftop"))

    def test_missing_celltype_defs_falls_back_to_generation(self):
        manager = make_manager(map_width=2, map_height=1)
        manager.definitions.celltype_defs = []

        self.assertIsNone(manager._cell_types_from_map_csv("street,market"))


class SnapshotReuseTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_placements_are_used_without_generating(self):
        class ExplodingEntityManager:
            def __init__(self):
                self.entity_placements = []

            async def generate_placements(self, cell_types, map_width, map_height):
                raise AssertionError("placements must not be regenerated from a snapshot")

        manager = make_manager()
        manager.entity_manager = ExplodingEntityManager()
        placements = [{"type": "enemy", "entity_id": "punk", "x": 1, "y": 0}]

        await manager.initialize_game_placements(placements)

        self.assertEqual(manager.entity_placements, placements)
        self.assertEqual(manager.entity_manager.entity_placements, placements)

    async def test_snapshot_tiles_are_used_without_calling_the_model(self):
        calls = []

        async def exploding_generator(*args, **kwargs):
            calls.append(args)
            raise AssertionError("tile info must not be regenerated from a snapshot")

        manager = make_manager()
        manager.gen_ai = SimpleNamespace(gen_tile_quick_info=exploding_generator)
        manager.state.cell_types = [
            [CELLTYPE_DEFS[0], CELLTYPE_DEFS[1], CELLTYPE_DEFS[0]],
            [CELLTYPE_DEFS[1], CELLTYPE_DEFS[0], CELLTYPE_DEFS[1]],
        ]
        snapshot_tiles = [{"x": 0, "y": 0, "label": "Wet Street", "quick_desc": "Rain."}]

        await manager.initialize_tile_info(snapshot_tiles)

        self.assertEqual(calls, [])
        self.assertEqual(manager._generated_tile_info, snapshot_tiles)
        self.assertEqual(manager.state.tile_info[0][0]["label"], "Wet Street")

    async def test_tile_info_is_generated_when_snapshot_has_none(self):
        async def generator(*args, **kwargs):
            return [{"x": 0, "y": 0, "label": "Generated Street"}]

        manager = make_manager()
        manager.gen_ai = SimpleNamespace(gen_tile_quick_info=generator)
        manager.state.cell_types = [
            [CELLTYPE_DEFS[0], CELLTYPE_DEFS[1], CELLTYPE_DEFS[0]],
            [CELLTYPE_DEFS[1], CELLTYPE_DEFS[0], CELLTYPE_DEFS[1]],
        ]

        await manager.initialize_tile_info(None)

        self.assertEqual(manager.state.tile_info[0][0]["label"], "Generated Street")

    async def test_other_language_reuses_map_but_not_tile_prose(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {
                "DO_STORAGE_SERVER": "",
                "DO_SPACES_ACCESS_KEY": "",
                "DO_SPACES_SECRET_KEY": "",
                "DO_STORAGE_CONTAINER": "",
            }):
                database = DatabaseManager()
            database.db_path = os.path.join(directory, "test_snapshot.db")
            database.init_db()
            database.save_generator_world(
                generator_id="world-1",
                language="en",
                map_csv="street,market,street\nmarket,street,market",
                entity_placements=[{"type": "enemy", "entity_id": "punk", "x": 1, "y": 0}],
                tile_info_by_language={"en": [{"x": 0, "y": 0, "label": "Wet Street"}]},
                snapshot_version=WORLD_SNAPSHOT_VERSION,
            )

            manager = make_manager(language="ja")
            with patch("game_state_manager.db", database):
                snapshot = manager._load_world_snapshot()

        self.assertIsNotNone(snapshot)
        # Map and placements are language-independent and reused.
        self.assertEqual(len(snapshot["cell_types"]), 2)
        self.assertEqual(snapshot["entity_placements"][0]["entity_id"], "punk")
        # Generated prose is not, so Japanese starts empty and regenerates.
        self.assertEqual(snapshot["tile_info"], [])
        # The English prose is retained so saving Japanese will not clobber it.
        self.assertIn("en", manager._snapshot_tile_info_by_language)


class OpeningLineTests(unittest.TestCase):
    """The opening line was the last per-run model call: initialize_game
    returned a bare string with no description, so the websocket handler sent
    it through gen_adapt_sentence."""

    def test_opening_line_uses_the_world_summary(self):
        manager = make_manager()
        manager.theme_desc_better = "Neon Harbour\nRain never stops here.\nThe docks keep secrets."

        self.assertEqual(
            manager._opening_line(),
            "Rain never stops here.\nThe docks keep secrets.",
        )

    def test_opening_line_falls_back_to_localized_message(self):
        manager = make_manager()
        manager.theme_desc_better = "Neon Harbour"

        self.assertEqual(
            manager._opening_line(),
            "The run begins. This World is yours to explore.",
        )

    def test_opening_line_fallback_is_localized(self):
        manager = make_manager(language="it")
        manager.theme_desc_better = None

        self.assertEqual(
            manager._opening_line(),
            "La partita inizia. Questo mondo è tutto da esplorare.",
        )

    def test_opening_line_survives_missing_theme(self):
        manager = make_manager()

        self.assertEqual(
            manager._opening_line(),
            "The run begins. This World is yours to explore.",
        )


class RuntimeModelCallTests(unittest.IsolatedAsyncioTestCase):
    """Play must not call a model at all. Anything reintroducing a per-turn
    call should fail here."""

    async def test_gameplay_actions_never_reach_the_adapter(self):
        from game_websocket_handler import FAST_DESCRIPTION_ACTIONS

        gameplay_actions = {
            "move", "attack", "run", "use_item", "equip_item", "choose_story",
        }

        self.assertEqual(
            gameplay_actions - FAST_DESCRIPTION_ACTIONS,
            set(),
            "every gameplay action must bypass gen_adapt_sentence",
        )

    async def test_initialized_run_message_needs_no_adaptation(self):
        async def exploding_adapter(*args, **kwargs):
            raise AssertionError("gen_adapt_sentence must not run during play")

        manager = make_manager()
        manager.theme_desc_better = "Neon Harbour\nRain never stops here."
        manager.gen_ai = SimpleNamespace(gen_adapt_sentence=exploding_adapter)

        opening = manager._opening_line()
        message = {"description_raw": opening, "description": opening}

        # Mirrors create_message_description: a filled description short-circuits.
        result = await GameStateManager.create_message_description(manager, message)

        self.assertEqual(result["description"], "Rain never stops here.")


class BakedProseReviewTests(unittest.TestCase):
    """Baked prose is shown to players verbatim, so a public review that never
    sees it can approve a World containing unreviewed text."""

    def test_collect_baked_prose_extracts_player_visible_text(self):
        prose = collect_baked_prose({
            "tile_info_by_language": {
                "en": [
                    {
                        "x": 0, "y": 0,
                        "label": "Wet Street",
                        "quick_desc": "Rain sheets off the awnings.",
                        "inspect_desc": "A contact waits by the noodle stand.",
                    },
                    {"x": 1, "y": 0, "label": "Night Market"},
                ],
            },
        })

        self.assertEqual(prose["tile_text"]["en"], [
            "Wet Street",
            "Rain sheets off the awnings.",
            "A contact waits by the noodle stand.",
            "Night Market",
        ])

    def test_collect_baked_prose_keeps_languages_separate(self):
        prose = collect_baked_prose({
            "tile_info_by_language": {
                "en": [{"label": "Wet Street"}],
                "ja": [{"label": "濡れた通り"}],
            },
        })

        self.assertEqual(prose["tile_text"]["en"], ["Wet Street"])
        self.assertEqual(prose["tile_text"]["ja"], ["濡れた通り"])

    def test_collect_baked_prose_drops_non_text_fields(self):
        prose = collect_baked_prose({
            "tile_info_by_language": {
                "en": [{"x": 3, "y": 4, "terrain_icon": "fa-solid fa-road"}],
            },
        })

        self.assertEqual(prose, {})

    def test_collect_baked_prose_handles_missing_snapshot(self):
        self.assertEqual(collect_baked_prose(None), {})
        self.assertEqual(collect_baked_prose({}), {})

    def test_payload_includes_baked_prose_when_present(self):
        payload = build_world_review_payload({
            "id": "world-1",
            "theme_desc": "A wet city",
            "baked_prose": {"tile_text": {"en": ["Wet Street"]}},
        })

        self.assertEqual(payload["generated_prose"]["tile_text"]["en"], ["Wet Street"])

    def test_payload_omits_baked_prose_when_absent(self):
        payload = build_world_review_payload({"id": "world-1", "theme_desc": "A wet city"})

        self.assertNotIn("generated_prose", payload)


if __name__ == "__main__":
    unittest.main()

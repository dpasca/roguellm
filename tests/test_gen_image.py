import os
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from gen_image import (
    CHROMA_KEY,
    FRAME_NAMES,
    attach_art_to_definitions,
    build_portrait_prompt,
    build_sheet_prompt,
    build_style_block,
    generate_world_art,
    normalize_visual_manifest,
    get_image_model_name,
    get_image_model_quality,
    get_world_assets_dir,
    has_visible_content,
    is_world_art_enabled,
    make_token,
    remove_flat_background,
    save_asset,
    slice_sprite_sheet,
    trim_to_content,
)


def make_sheet(frame_count=3, frame_width=40, height=40, background=CHROMA_KEY):
    """A keyed sheet with one solid block per frame, each a different colour."""
    sheet = Image.new("RGB", (frame_width * frame_count, height), background)
    colors = [(200, 30, 30), (30, 200, 30), (30, 30, 200)]
    for index in range(frame_count):
        block = Image.new("RGB", (frame_width // 2, height // 2), colors[index % len(colors)])
        sheet.paste(block, (index * frame_width + frame_width // 4, height // 4))
    return sheet


class ConfigTests(unittest.TestCase):
    def test_art_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(is_world_art_enabled())

    def test_art_flag_accepts_common_falsey_spellings(self):
        for value in ("0", "false", "no", "off", ""):
            with patch.dict(os.environ, {"ENABLE_WORLD_ART": value}):
                self.assertFalse(is_world_art_enabled(), value)

    def test_art_flag_enables(self):
        with patch.dict(os.environ, {"ENABLE_WORLD_ART": "1"}):
            self.assertTrue(is_world_art_enabled())

    def test_model_defaults_to_a_non_deprecated_model(self):
        with patch.dict(os.environ, {}, clear=True):
            # gpt-image-1-mini is removed from the API on 2026-12-01 and
            # gpt-image-1 deprecates 2026-10-23, so neither may be the default.
            self.assertEqual(get_image_model_name(), "gpt-image-2")

    def test_quality_defaults_to_medium(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_image_model_quality(), "medium")

    def test_quality_is_overridable(self):
        with patch.dict(os.environ, {"IMAGE_MODEL_QUALITY": "LOW"}):
            self.assertEqual(get_image_model_quality(), "low")

    def test_assets_live_in_the_data_volume(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_world_assets_dir(), os.path.join("_data", "assets"))


class PromptTests(unittest.TestCase):
    def test_sheet_prompt_requests_one_character_across_frames(self):
        prompt = build_sheet_prompt("A tired detective", "muted pixel art")

        self.assertIn("SAME character", prompt)
        self.assertIn("A tired detective", prompt)
        self.assertIn("muted pixel art", prompt)
        self.assertIn("3 equal-width frames", prompt)

    def test_sheet_prompt_describes_every_frame_in_order(self):
        prompt = build_sheet_prompt("A tired detective", "pixel art")

        self.assertIn("1. standing ready", prompt)
        self.assertIn("2. mid-attack", prompt)
        self.assertIn("3. defeated", prompt)

    def test_sheet_prompt_can_request_a_keyed_background(self):
        prompt = build_sheet_prompt("A detective", "pixel art", transparent=False)

        self.assertIn("magenta", prompt)
        self.assertNotIn("transparent background", prompt)

    def test_prompts_exclude_scenery_that_would_break_sprite_use(self):
        for prompt in (
            build_sheet_prompt("A detective", "pixel art"),
            build_portrait_prompt("A rainy alley", "pixel art"),
        ):
            self.assertIn("no cast shadow", prompt)
            self.assertIn("no text", prompt)


class SlicingTests(unittest.TestCase):
    def test_sheet_splits_into_equal_frames(self):
        frames = slice_sprite_sheet(make_sheet(), 3)

        self.assertEqual(len(frames), 3)
        for frame in frames:
            self.assertEqual(frame.size, (40, 40))

    def test_last_frame_absorbs_a_non_divisible_remainder(self):
        sheet = Image.new("RGB", (100, 30), CHROMA_KEY)

        frames = slice_sprite_sheet(sheet, 3)

        self.assertEqual([frame.width for frame in frames], [33, 33, 34])
        self.assertEqual(sum(frame.width for frame in frames), 100)

    def test_frames_keep_their_own_content(self):
        frames = slice_sprite_sheet(make_sheet(), 3)

        colors = [
            frame.convert("RGB").getpixel((20, 20))
            for frame in frames
        ]
        self.assertEqual(colors, [(200, 30, 30), (30, 200, 30), (30, 30, 200)])

    def test_rejects_nonsense_frame_counts(self):
        with self.assertRaises(ValueError):
            slice_sprite_sheet(make_sheet(), 0)


class BackgroundRemovalTests(unittest.TestCase):
    def test_flat_background_becomes_transparent(self):
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (8, 8), (10, 120, 200)), (6, 6))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((10, 10))[3], 255)

    def test_subject_colour_away_from_the_key_is_kept(self):
        """Keying is a plain colour match now, so what protects the subject is
        distance from the key plus the prompt telling the model to keep the key
        colour off the character."""
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (10, 10), (10, 120, 200)), (5, 5))

        result = remove_flat_background(image, despill=False)

        self.assertEqual(result.getpixel((10, 10))[3], 255)
        self.assertEqual(result.getpixel((0, 0))[3], 0)

    def test_near_key_shades_are_removed_within_tolerance(self):
        image = Image.new("RGB", (20, 20), (250, 6, 250))
        image.paste(Image.new("RGB", (6, 6), (10, 120, 200)), (7, 7))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((0, 0))[3], 0)

    def test_background_reaching_an_edge_is_removed_from_any_corner(self):
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (20, 6), (10, 120, 200)), (0, 7))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((0, 19))[3], 0)
        self.assertEqual(result.getpixel((10, 9))[3], 255)


class EnclosedPocketTests(unittest.TestCase):
    """Background enclosed by the subject, such as the gap between an arm and a
    torso, is the case that killed the earlier flood-fill approach."""

    def test_enclosed_key_pocket_is_removed(self):
        image = Image.new("RGB", (30, 30), CHROMA_KEY)
        image.paste(Image.new("RGB", (20, 20), (10, 60, 120)), (5, 5))
        image.paste(Image.new("RGB", (6, 6), CHROMA_KEY), (12, 12))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((14, 14))[3], 0, "enclosed pocket should clear")
        self.assertEqual(result.getpixel((0, 0))[3], 0, "outer background should clear")
        self.assertEqual(result.getpixel((7, 7))[3], 255, "subject should survive")

    def test_subject_colour_outside_the_tolerance_survives(self):
        image = Image.new("RGB", (30, 30), CHROMA_KEY)
        image.paste(Image.new("RGB", (20, 20), (10, 60, 120)), (5, 5))
        image.paste(Image.new("RGB", (6, 6), (200, 30, 30)), (12, 12))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((14, 14))[3], 255)

    def test_prompt_warns_the_model_off_the_key_colour(self):
        """The global match has no connectivity protection, so the prompt has
        to carry it instead."""
        prompt = build_sheet_prompt("A detective", "pixel art", transparent=False)

        self.assertIn("must not appear anywhere on the subject", prompt)


class DespillTests(unittest.TestCase):
    """The model returns hard-edged art with no alpha, so key colour bleeds
    into outlines as fully opaque tinted pixels."""

    def test_magenta_fringe_on_the_outline_is_neutralised(self):
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (10, 10), (60, 60, 60)), (5, 5))
        # A contaminated outline pixel: grey lifted toward magenta.
        image.putpixel((5, 5), (180, 60, 180))

        result = remove_flat_background(image)
        r, g, b, a = result.getpixel((5, 5))

        self.assertEqual(a, 255)
        self.assertLess(r, 100, "red spill should be pulled down")
        self.assertLess(b, 100, "blue spill should be pulled down")

    def test_red_art_touching_the_edge_is_not_desaturated(self):
        """Red has only one channel elevated, so it carries no magenta spill."""
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (10, 10), (200, 30, 30)), (5, 5))

        result = remove_flat_background(image)
        r, g, b, _ = result.getpixel((5, 5))

        self.assertEqual((r, g, b), (200, 30, 30))

    def test_interior_pixels_are_left_alone(self):
        """Despill only applies at the boundary, so interior art keeps its
        intended colours even if they are magenta-ish."""
        image = Image.new("RGB", (30, 30), CHROMA_KEY)
        image.paste(Image.new("RGB", (20, 20), (60, 60, 60)), (5, 5))
        image.putpixel((15, 15), (180, 60, 180))

        result = remove_flat_background(image)

        self.assertEqual(result.getpixel((15, 15))[:3], (180, 60, 180))

    def test_despill_can_be_disabled(self):
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (10, 10), (60, 60, 60)), (5, 5))
        image.putpixel((5, 5), (180, 60, 180))

        result = remove_flat_background(image, despill=False)

        self.assertEqual(result.getpixel((5, 5))[:3], (180, 60, 180))


class TrimAndTokenTests(unittest.TestCase):
    def test_trim_crops_to_the_subject_with_padding(self):
        image = Image.new("RGBA", (60, 60), (0, 0, 0, 0))
        image.paste(Image.new("RGBA", (10, 10), (255, 0, 0, 255)), (25, 25))

        trimmed = trim_to_content(image, padding=4)

        self.assertEqual(trimmed.size, (18, 18))

    def test_trim_survives_a_fully_empty_frame(self):
        empty = Image.new("RGBA", (20, 20), (0, 0, 0, 0))

        self.assertEqual(trim_to_content(empty).size, (20, 20))

    def test_token_is_square_and_centred(self):
        image = Image.new("RGBA", (60, 20), (0, 0, 0, 0))
        image.paste(Image.new("RGBA", (20, 10), (255, 0, 0, 255)), (20, 5))

        token = make_token(image, size=64)

        self.assertEqual(token.size, (64, 64))
        self.assertEqual(token.getpixel((0, 0))[3], 0)
        self.assertGreater(token.getpixel((32, 32))[3], 0)

    def test_token_does_not_upscale_beyond_its_box(self):
        image = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        image.paste(Image.new("RGBA", (300, 300), (255, 0, 0, 255)), (50, 50))

        token = make_token(image, size=64)

        self.assertEqual(token.size, (64, 64))


class VisibleContentTests(unittest.TestCase):
    def test_empty_frame_is_rejected(self):
        self.assertFalse(has_visible_content(Image.new("RGBA", (50, 50), (0, 0, 0, 0))))

    def test_populated_frame_is_accepted(self):
        image = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
        image.paste(Image.new("RGBA", (30, 30), (255, 0, 0, 255)), (10, 10))

        self.assertTrue(has_visible_content(image))

    def test_a_few_stray_pixels_are_rejected(self):
        image = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
        image.putpixel((1, 1), (255, 0, 0, 255))

        self.assertFalse(has_visible_content(image))


class SaveAssetTests(unittest.TestCase):
    def test_saves_under_the_world_and_returns_its_url(self):
        image = Image.new("RGBA", (16, 16), (255, 0, 0, 255))

        with tempfile.TemporaryDirectory() as directory:
            url = save_asset(image, "world-1", "hero-neutral", assets_dir=directory)
            written = os.path.join(directory, "world-1", "hero-neutral.png")

            self.assertTrue(os.path.exists(written))
            self.assertEqual(Image.open(written).size, (16, 16))

        self.assertEqual(url, "/assets/worlds/world-1/hero-neutral.png")

    def test_worlds_do_not_share_a_directory(self):
        image = Image.new("RGBA", (16, 16), (255, 0, 0, 255))

        with tempfile.TemporaryDirectory() as directory:
            save_asset(image, "world-1", "hero", assets_dir=directory)
            save_asset(image, "world-2", "hero", assets_dir=directory)

            self.assertTrue(os.path.exists(os.path.join(directory, "world-1", "hero.png")))
            self.assertTrue(os.path.exists(os.path.join(directory, "world-2", "hero.png")))

    def test_frame_names_cover_the_states_the_renderer_expects(self):
        self.assertEqual(FRAME_NAMES, ("neutral", "attack", "defeat"))


WORLD = {
    "player": [{"id": "player", "name": "Runner", "description": "A courier"}],
    "enemies": [
        {"id": "punk", "name": "Street Punk", "description": "A thug"},
        {"id": "boss", "name": "Kingpin", "description": "The boss"},
    ],
    "terrain": [{"id": "street", "name": "Street", "description": "Wet asphalt"}],
}


def make_manifest(**overrides):
    manifest = {
        "style": "Muted 16-bit pixel art with heavy outlines.",
        "palette": ["#101018", "#e8e0d0"],
        "characters": [
            {"id": "player", "kind": "player", "identity": "A courier in a long coat"},
            {"id": "punk", "kind": "enemy", "identity": "A thug in a torn jacket"},
            {"id": "boss", "kind": "enemy", "identity": "A heavy in a white suit"},
        ],
        "locations": [{"id": "street", "identity": "Rain-slick asphalt at night"}],
        "exclusions": ["neon", "holograms"],
    }
    manifest.update(overrides)
    return manifest


class ManifestNormalizationTests(unittest.TestCase):
    def test_valid_manifest_passes_through(self):
        result = normalize_visual_manifest(make_manifest(), WORLD)

        self.assertEqual(len(result["characters"]), 3)
        self.assertEqual(len(result["locations"]), 1)
        self.assertEqual(result["palette"], ["#101018", "#e8e0d0"])

    def test_character_kinds_are_taken_from_the_world_not_the_model(self):
        manifest = make_manifest(characters=[
            {"id": "player", "kind": "enemy", "identity": "A courier"},
            {"id": "punk", "kind": "player", "identity": "A thug"},
            {"id": "boss", "kind": "enemy", "identity": "A heavy"},
        ])

        result = normalize_visual_manifest(manifest, WORLD)
        kinds = {c["id"]: c["kind"] for c in result["characters"]}

        self.assertEqual(kinds["player"], "player")
        self.assertEqual(kinds["punk"], "enemy")

    def test_invented_ids_are_dropped(self):
        manifest = make_manifest(characters=[
            {"id": "player", "kind": "player", "identity": "A courier"},
            {"id": "punk", "kind": "enemy", "identity": "A thug"},
            {"id": "boss", "kind": "enemy", "identity": "A heavy"},
            {"id": "dragon", "kind": "enemy", "identity": "A dragon nobody asked for"},
        ])

        result = normalize_visual_manifest(manifest, WORLD)

        self.assertEqual({c["id"] for c in result["characters"]}, {"player", "punk", "boss"})

    def test_omitted_character_falls_back_to_its_own_text(self):
        manifest = make_manifest(characters=[
            {"id": "player", "kind": "player", "identity": "A courier"},
        ])

        result = normalize_visual_manifest(manifest, WORLD)
        identities = {c["id"]: c["identity"] for c in result["characters"]}

        self.assertEqual(len(result["characters"]), 3)
        self.assertEqual(identities["punk"], "Street Punk. A thug")

    def test_blank_identity_falls_back_too(self):
        manifest = make_manifest(characters=[
            {"id": "player", "kind": "player", "identity": "   "},
            {"id": "punk", "kind": "enemy", "identity": "A thug"},
            {"id": "boss", "kind": "enemy", "identity": "A heavy"},
        ])

        result = normalize_visual_manifest(manifest, WORLD)
        identities = {c["id"]: c["identity"] for c in result["characters"]}

        self.assertEqual(identities["player"], "Runner. A courier")

    def test_missing_style_is_unusable(self):
        self.assertIsNone(normalize_visual_manifest(make_manifest(style=""), WORLD))
        self.assertIsNone(normalize_visual_manifest(make_manifest(style="   "), WORLD))

    def test_non_dict_manifest_is_unusable(self):
        for bad in (None, [], "a style", 42):
            self.assertIsNone(normalize_visual_manifest(bad, WORLD))

    def test_empty_world_yields_nothing_to_draw(self):
        empty = {"player": [], "enemies": [], "terrain": []}

        self.assertIsNone(normalize_visual_manifest(make_manifest(), empty))

    def test_ids_are_stringified_for_joining(self):
        world = {"player": [], "enemies": [], "terrain": [{"id": 7, "name": "Seven"}]}
        manifest = make_manifest(locations=[{"id": 7, "identity": "A numbered place"}])

        result = normalize_visual_manifest(manifest, world)

        self.assertEqual(result["locations"][0]["id"], "7")
        self.assertEqual(result["locations"][0]["identity"], "A numbered place")


class StyleBlockTests(unittest.TestCase):
    def test_style_block_carries_palette_and_exclusions(self):
        block = build_style_block(make_manifest())

        self.assertIn("Muted 16-bit pixel art", block)
        self.assertIn("#101018", block)
        self.assertIn("neon", block)

    def test_style_block_survives_a_bare_manifest(self):
        block = build_style_block({"style": "Ink wash"})

        self.assertEqual(block, "Ink wash")

    def test_style_block_is_identical_across_calls(self):
        """Every asset must receive the same wording, or they drift apart."""
        manifest = make_manifest()

        self.assertEqual(build_style_block(manifest), build_style_block(manifest))


class FakeArtGenerator:
    def __init__(self, fail_ids=()):
        self.fail_ids = set(fail_ids)
        self.calls = []

    async def generate_character(self, identity, style):
        self.calls.append({"identity": identity, "style": style})
        if any(bad in identity for bad in self.fail_ids):
            raise RuntimeError("generation failed")

        def swatch():
            image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            image.paste(Image.new("RGBA", (16, 16), (255, 0, 0, 255)), (8, 8))
            return image

        return {
            "frames": {name: swatch() for name in FRAME_NAMES},
            "token": swatch(),
        }


class WorldArtOrchestrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_generates_every_character_and_writes_files(self):
        generator = FakeArtGenerator()

        with tempfile.TemporaryDirectory() as directory:
            art = await generate_world_art(
                normalize_visual_manifest(make_manifest(), WORLD),
                "world-1",
                generator=generator,
                assets_dir=directory,
            )

            self.assertEqual(set(art), {"player", "punk", "boss"})
            self.assertTrue(os.path.exists(
                os.path.join(directory, "world-1", "punk-neutral.png")))
            self.assertTrue(os.path.exists(
                os.path.join(directory, "world-1", "punk-token.png")))

        self.assertEqual(art["punk"]["neutral"], "/assets/worlds/world-1/punk-neutral.png")

    async def test_every_character_receives_the_same_style_text(self):
        generator = FakeArtGenerator()

        with tempfile.TemporaryDirectory() as directory:
            await generate_world_art(
                normalize_visual_manifest(make_manifest(), WORLD),
                "world-1",
                generator=generator,
                assets_dir=directory,
            )

        styles = {call["style"] for call in generator.calls}
        self.assertEqual(len(styles), 1)

    async def test_one_failed_character_does_not_lose_the_others(self):
        generator = FakeArtGenerator(fail_ids=("torn jacket",))

        with tempfile.TemporaryDirectory() as directory:
            art = await generate_world_art(
                normalize_visual_manifest(make_manifest(), WORLD),
                "world-1",
                generator=generator,
                assets_dir=directory,
            )

        self.assertEqual(set(art), {"player", "boss"})

    async def test_empty_manifest_generates_nothing(self):
        generator = FakeArtGenerator()

        self.assertEqual(await generate_world_art(None, "world-1", generator=generator), {})
        self.assertEqual(generator.calls, [])


class AttachArtTests(unittest.TestCase):
    def test_art_lands_on_the_existing_sprite_contract(self):
        player_defs = [{"name": "Runner"}]
        enemy_defs = [{"enemy_id": "punk", "name": "Street Punk"}]
        art = {
            "player": {
                "neutral": "/assets/worlds/w/player-neutral.png",
                "attack": "/assets/worlds/w/player-attack.png",
                "token": "/assets/worlds/w/player-token.png",
            },
            "punk": {
                "neutral": "/assets/worlds/w/punk-neutral.png",
                "token": "/assets/worlds/w/punk-token.png",
            },
        }

        attach_art_to_definitions(art, player_defs, enemy_defs)

        self.assertEqual(player_defs[0]["sprite_url"], "/assets/worlds/w/player-neutral.png")
        self.assertEqual(player_defs[0]["sprite_token_url"], "/assets/worlds/w/player-token.png")
        self.assertEqual(enemy_defs[0]["sprite_url"], "/assets/worlds/w/punk-neutral.png")

    def test_extra_frames_ride_along_without_breaking_the_contract(self):
        player_defs = [{"name": "Runner"}]
        art = {"player": {
            "neutral": "/a/n.png", "attack": "/a/a.png", "defeat": "/a/d.png", "token": "/a/t.png",
        }}

        attach_art_to_definitions(art, player_defs, [])

        self.assertEqual(
            player_defs[0]["sprite_frames"],
            {"neutral": "/a/n.png", "attack": "/a/a.png", "defeat": "/a/d.png"},
        )
        self.assertNotIn("token", player_defs[0]["sprite_frames"])

    def test_entities_without_art_keep_their_icon_fallback(self):
        enemy_defs = [
            {"enemy_id": "punk", "name": "Street Punk"},
            {"enemy_id": "thug", "name": "Dock Thug", "font_awesome_icon": "fa-solid fa-skull"},
        ]

        attach_art_to_definitions({"punk": {"neutral": "/a/n.png"}}, [], enemy_defs)

        self.assertIn("sprite_url", enemy_defs[0])
        self.assertNotIn("sprite_url", enemy_defs[1])
        self.assertEqual(enemy_defs[1]["font_awesome_icon"], "fa-solid fa-skull")

    def test_sprite_frames_is_protected_from_translation(self):
        from gen_ai import PRESERVED_WORLD_FIELD_NAMES

        for field in ("sprite_url", "sprite_token_url", "sprite_frames"):
            self.assertIn(field, PRESERVED_WORLD_FIELD_NAMES)


class ForgeWiringTests(unittest.IsolatedAsyncioTestCase):
    def make_db(self, directory):
        from db import DatabaseManager

        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            database = DatabaseManager()
        database.db_path = os.path.join(directory, "test_art.db")
        database.init_db()
        return database

    def make_manager(self, database, manifest=make_manifest()):
        from game_state_manager import GameStateManager
        from types import SimpleNamespace

        manager = GameStateManager.__new__(GameStateManager)
        manager.language = "en"
        manager.definitions = SimpleNamespace(
            player_defs=[{"name": "Runner", "description": "A courier"}],
            item_defs=[{"id": "coffee"}],
            enemy_defs=[
                {"enemy_id": "punk", "name": "Street Punk", "description": "A thug"},
                {"enemy_id": "boss", "name": "Kingpin", "description": "The boss"},
            ],
            celltype_defs=[{"id": "street", "name": "Street", "description": "Wet asphalt"}],
        )

        async def gen_visual_manifest(player_defs, enemy_defs, celltype_defs):
            return normalize_visual_manifest(manifest, WORLD) if manifest else None

        manager.gen_ai = SimpleNamespace(gen_visual_manifest=gen_visual_manifest)
        manager.generator_id = database.save_generator(
            theme_desc="A wet city",
            theme_desc_better="Wet City\nRain never stops.",
            language="en",
            player_defs=manager.definitions.player_defs,
            item_defs=manager.definitions.item_defs,
            enemy_defs=manager.definitions.enemy_defs,
            celltype_defs=manager.definitions.celltype_defs,
        )
        return manager

    async def test_art_is_skipped_when_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_db(directory)
            manager = self.make_manager(database)

            with patch.dict(os.environ, {"ENABLE_WORLD_ART": "0"}), \
                    patch("game_state_manager.db", database):
                await manager.generate_and_attach_world_art()

            self.assertNotIn("sprite_url", manager.definitions.player_defs[0])

    async def test_attached_art_does_not_change_the_world_id(self):
        """save_generator hashes the definitions, so re-saving after attaching
        art would mint a new id and orphan the art directory."""
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_db(directory)
            manager = self.make_manager(database)
            original_id = manager.generator_id

            with patch.dict(os.environ, {
                "ENABLE_WORLD_ART": "1",
                "WORLD_ASSETS_DIR": os.path.join(directory, "assets"),
            }), \
                    patch("game_state_manager.db", database), \
                    patch("gen_image.WorldArtGenerator", lambda *a, **k: FakeArtGenerator()):
                await manager.generate_and_attach_world_art()

            self.assertEqual(manager.generator_id, original_id)

            stored = database.get_generator(original_id)
            self.assertIsNotNone(stored)
            self.assertEqual(
                stored["player_defs"][0]["sprite_url"],
                f"/assets/worlds/{original_id}/player-neutral.png",
            )
            self.assertEqual(len(database.list_worlds(local_dev=True)), 1)

    async def test_art_urls_are_persisted_for_enemies(self):
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_db(directory)
            manager = self.make_manager(database)
            world_id = manager.generator_id

            with patch.dict(os.environ, {
                "ENABLE_WORLD_ART": "1",
                "WORLD_ASSETS_DIR": os.path.join(directory, "assets"),
            }), \
                    patch("game_state_manager.db", database), \
                    patch("gen_image.WorldArtGenerator", lambda *a, **k: FakeArtGenerator()):
                await manager.generate_and_attach_world_art()

            stored = database.get_generator(world_id)

        enemies = {e["enemy_id"]: e for e in stored["enemy_defs"]}
        self.assertEqual(
            enemies["punk"]["sprite_token_url"],
            f"/assets/worlds/{world_id}/punk-token.png",
        )
        self.assertIn("sprite_frames", enemies["boss"])

    async def test_an_unusable_manifest_leaves_the_world_playable(self):
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_db(directory)
            manager = self.make_manager(database, manifest=None)

            with patch.dict(os.environ, {
                "ENABLE_WORLD_ART": "1",
                "WORLD_ASSETS_DIR": os.path.join(directory, "assets"),
            }), \
                    patch("game_state_manager.db", database):
                await manager.generate_and_attach_world_art()

            self.assertNotIn("sprite_url", manager.definitions.player_defs[0])

    async def test_generation_failure_never_breaks_the_forge(self):
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_db(directory)
            manager = self.make_manager(database)

            def explode(*args, **kwargs):
                raise RuntimeError("image API down")

            with patch.dict(os.environ, {
                "ENABLE_WORLD_ART": "1",
                "WORLD_ASSETS_DIR": os.path.join(directory, "assets"),
            }), \
                    patch("game_state_manager.db", database), \
                    patch("gen_image.WorldArtGenerator", explode):
                await manager.generate_and_attach_world_art()

            self.assertNotIn("sprite_url", manager.definitions.player_defs[0])


if __name__ == "__main__":
    unittest.main()

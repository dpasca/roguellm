import os
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from gen_image import (
    CHROMA_KEY,
    FRAME_NAMES,
    build_portrait_prompt,
    build_sheet_prompt,
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

    def test_subject_colour_matching_the_key_is_kept(self):
        """A plain colour match would punch a hole here; corner connectivity
        is what protects the subject."""
        image = Image.new("RGB", (20, 20), CHROMA_KEY)
        image.paste(Image.new("RGB", (10, 10), (10, 120, 200)), (5, 5))
        # A key-coloured pixel fully enclosed by the subject.
        image.putpixel((10, 10), CHROMA_KEY)

        result = remove_flat_background(image)

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


if __name__ == "__main__":
    unittest.main()

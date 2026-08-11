import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

import main
from game_state_manager import GameStateManager
from gen_image import generate_world_art, normalize_visual_manifest


WORLD = {
    "player": [{"id": "player", "name": "Runner"}],
    "enemies": [{"id": "punk", "name": "Street Punk"}, {"id": "boss", "name": "Kingpin"}],
    "terrain": [{"id": "street", "name": "Street"}],
}

MANIFEST = {
    "style": "Muted pixel art",
    "palette": ["#101018", "#e8e0d0"],
    "characters": [
        {"id": "player", "kind": "player", "identity": "A courier"},
        {"id": "punk", "kind": "enemy", "identity": "A thug"},
        {"id": "boss", "kind": "enemy", "identity": "A heavy"},
    ],
    "locations": [{"id": "street", "identity": "Wet asphalt"}],
    "exclusions": [],
}


class RecordingGenerator:
    def __init__(self, fail_ids=()):
        self.fail_ids = set(fail_ids)

    def _swatch(self):
        image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        image.paste(Image.new("RGBA", (16, 16), (200, 60, 60, 255)), (8, 8))
        return image

    async def generate_character(self, identity, style, quality=None):
        if any(bad in identity for bad in self.fail_ids):
            raise RuntimeError("generation failed")
        return {
            "frames": {n: self._swatch() for n in ("neutral", "attack", "defeat")},
            "token": self._swatch(),
        }

    async def generate_backdrop(self, identity, style, quality=None):
        return Image.new("RGBA", (64, 48), (20, 30, 50, 255))


class ForgeProgressTests(unittest.IsolatedAsyncioTestCase):
    """The reveal is what makes a multi-minute forge watchable, so the events
    that drive it are a contract, not incidental logging."""

    async def collect(self, generator, tmpdir):
        events = []

        async def on_progress(event):
            events.append(event)

        await generate_world_art(
            normalize_visual_manifest(MANIFEST, WORLD),
            "world-1",
            generator=generator,
            assets_dir=tmpdir,
            on_progress=on_progress,
            tier="full",
        )
        return events

    async def test_each_character_reports_as_it_is_drawn(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            events = await self.collect(RecordingGenerator(), tmpdir)

        art = [e for e in events if e["stage"] == "art"]
        # Characters draw concurrently, so completion order is not guaranteed.
        # The client fills slots by character_id; what must hold is that every
        # character reports exactly once and the counter runs 1..N.
        self.assertEqual({e["character_id"] for e in art}, {"player", "punk", "boss"})
        self.assertEqual(sorted(e["index"] for e in art), [1, 2, 3])
        self.assertTrue(all(e["total"] == 3 for e in art))
        self.assertTrue(all(e["sprite_url"] for e in art))

    async def test_characters_draw_concurrently(self):
        """Serialising them cost minutes and bought nothing, since style comes
        from the repeated manifest text rather than from ordering."""
        import asyncio
        import tempfile

        in_flight = 0
        peak = 0

        class SlowGenerator(RecordingGenerator):
            async def generate_character(self, identity, style, quality=None):
                nonlocal in_flight, peak
                in_flight += 1
                peak = max(peak, in_flight)
                try:
                    await asyncio.sleep(0.02)
                    return await RecordingGenerator.generate_character(
                        self, identity, style, quality=quality
                    )
                finally:
                    in_flight -= 1

        with tempfile.TemporaryDirectory() as tmpdir:
            await self.collect(SlowGenerator(), tmpdir)

        self.assertGreater(peak, 1, "characters must not be drawn one at a time")

    async def test_the_cover_is_reported_last(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            events = await self.collect(RecordingGenerator(), tmpdir)

        self.assertEqual(events[-1]["stage"], "cover")
        self.assertTrue(events[-1]["cover_url"])

    async def test_a_failed_character_is_reported_not_skipped_silently(self):
        """A silent gap would leave one slot spinning forever on the reveal."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            events = await self.collect(RecordingGenerator(fail_ids=("thug",)), tmpdir)

        failed = [e for e in events if e["stage"] == "art_failed"]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["character_id"], "punk")

    async def test_a_broken_callback_never_breaks_the_forge(self):
        """The reveal is decoration; it must not cost someone a paid World."""
        import tempfile

        async def exploding(event):
            raise RuntimeError("client vanished")

        with tempfile.TemporaryDirectory() as tmpdir:
            art = await generate_world_art(
                normalize_visual_manifest(MANIFEST, WORLD),
                "world-1",
                generator=RecordingGenerator(),
                assets_dir=tmpdir,
                on_progress=exploding,
                tier="full",
            )

        self.assertEqual(set(art["characters"]), {"player", "punk", "boss"})
        self.assertIsNotNone(art["cover"])

    async def test_report_progress_survives_a_failing_callback(self):
        manager = GameStateManager.__new__(GameStateManager)

        async def exploding(event):
            raise RuntimeError("socket closed")

        manager.on_progress = exploding
        await manager.report_progress("theme", title="X")  # must not raise

    async def test_report_progress_is_a_no_op_without_a_callback(self):
        manager = GameStateManager.__new__(GameStateManager)
        await manager.report_progress("theme", title="X")  # must not raise


class ForgeTimeoutTests(unittest.TestCase):
    """A flat 60s ceiling would have failed every art-enabled forge, since art
    adds roughly a dozen image calls at 10-25s each."""

    def test_text_only_forge_keeps_the_short_ceiling(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(main.get_world_creation_timeout_seconds(), 60.0)

    def test_art_raises_the_ceiling(self):
        with patch.dict(os.environ, {"ENABLE_WORLD_ART": "1"}):
            self.assertEqual(main.get_world_creation_timeout_seconds(), 600.0)

    def test_override_wins(self):
        with patch.dict(os.environ, {"WORLD_CREATION_TIMEOUT_SECONDS": "900"}):
            self.assertEqual(main.get_world_creation_timeout_seconds(), 900.0)

    def test_nonsense_override_falls_back_instead_of_crashing(self):
        with patch.dict(os.environ, {"WORLD_CREATION_TIMEOUT_SECONDS": "soon"}):
            self.assertEqual(main.get_world_creation_timeout_seconds(), 60.0)

    def test_override_cannot_be_set_absurdly_low(self):
        with patch.dict(os.environ, {"WORLD_CREATION_TIMEOUT_SECONDS": "1"}):
            self.assertEqual(main.get_world_creation_timeout_seconds(), 30.0)


if __name__ == "__main__":
    unittest.main()

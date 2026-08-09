"""Browser checks for the things a green Python suite cannot see.

Section 13 of docs/deployment-handoff.md lists the bugs that only ever appeared
in a browser: an element wider than the viewport, a stage overflowing its row,
CSS that never applied, a 404 on every page load. The area-crossing work added
two more - a handler defined in `computed` instead of `methods`, so every
crossing threw, and 249 unit tests stayed green throughout.

These run against a real server and a real browser. They are skipped, not
failed, when either is unavailable, so the default `pytest tests/` still works
on a machine without browsers installed.
"""

import json
import os
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - environment without playwright
    sync_playwright = None

# Phones the layout is expected to survive, per the handoff.
NARROW_VIEWPORTS = [(390, 844), (360, 780)]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def seed_playable_world():
    """Seed a dev World with a complete snapshot, so a run makes no model calls.

    Without the snapshot the first play generates placements and tile prose,
    which would make these tests slow, costly, and dependent on a live API key.
    """
    import sys
    sys.path.insert(0, REPO_ROOT)
    from db import db, WORLD_SNAPSHOT_VERSION
    from tools.ensure_dev_worlds import ensure_dev_worlds

    worlds = ensure_dev_worlds(db)
    world = next(w for w in worlds if w["key"] == "piedone")
    definitions = db.get_generator(world["id"])

    raw = definitions["celltype_defs"]
    cells = list(raw.values()) if isinstance(raw, dict) else raw
    ids = [str(c.get("id")) for c in cells]
    width, height = 10, 8

    # Two vertical bands, so there is exactly one crossing along any row.
    split = width // 2
    rows = [[ids[0] if x < split else ids[1] for x in range(width)] for _ in range(height)]
    map_csv = "\n".join(",".join(row) for row in rows)

    tiles = [
        {"x": x, "y": y, "label": f"Tile {x}-{y}",
         "quick_desc": f"Quiet corner {x}-{y}.", "inspect_desc": f"Nothing stirs at {x}-{y}."}
        for y in range(height) for x in range(width)
    ]
    regions = [
        {"id": "region-0", "terrain_id": ids[0], "name": "West Side", "cell_count": split * height,
         "distance_from_start": 0, "neighbours": ["region-1"],
         "borders": {"region-1": "You cross the line into the east side."}},
        {"id": "region-1", "terrain_id": ids[1], "name": "East Side",
         "cell_count": (width - split) * height, "distance_from_start": split,
         "neighbours": ["region-0"],
         "borders": {"region-0": "You cross back into the west side."}},
    ]

    db.save_generator_world(
        generator_id=world["id"],
        language="en",
        map_csv=map_csv,
        entity_placements=[],
        tile_info_by_language={"en": tiles},
        snapshot_version=WORLD_SNAPSHOT_VERSION,
        regions_by_language={"en": regions},
    )
    return world["id"]


class FrontendSmokeTests(unittest.TestCase):
    server = None
    base_url = None
    world_id = None

    @classmethod
    def setUpClass(cls):
        if sync_playwright is None:
            raise unittest.SkipTest("playwright is not installed")

        cls.world_id = seed_playable_world()
        port = free_port()
        cls.base_url = f"http://127.0.0.1:{port}"
        env = {
            **os.environ,
            # A fully snapshotted World makes no calls, but the client is still
            # constructed and refuses to build without a key.
            "LOW_SPEC_MODEL_API_KEY": os.environ.get("LOW_SPEC_MODEL_API_KEY", "test-key"),
            "HIGH_SPEC_MODEL_API_KEY": os.environ.get("HIGH_SPEC_MODEL_API_KEY", "test-key"),
            "ENABLE_DEBUG_SEED": "1",
        }
        cls.server = subprocess.Popen(
            [os.path.join(REPO_ROOT, "venv", "bin", "uvicorn"), "main:app", "--port", str(port)],
            cwd=REPO_ROOT, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        deadline = time.time() + 30
        while time.time() < deadline:
            if cls.server.poll() is not None:
                raise unittest.SkipTest("server exited during startup")
            try:
                urllib.request.urlopen(f"{cls.base_url}/health", timeout=1).read()
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                time.sleep(0.3)
        else:
            cls.tearDownClass()
            raise unittest.SkipTest("server did not become ready")

        try:
            cls.playwright = sync_playwright().start()
            cls.browser = cls.playwright.chromium.launch()
        except Exception as exc:  # pragma: no cover - no browser binary
            cls.tearDownClass()
            raise unittest.SkipTest(f"chromium unavailable: {exc}")

    @classmethod
    def tearDownClass(cls):
        for closer in (getattr(cls, "browser", None), getattr(cls, "playwright", None)):
            if closer:
                try:
                    closer.close() if hasattr(closer, "close") else closer.stop()
                except Exception:
                    pass
        if cls.server:
            cls.server.terminate()
            try:
                cls.server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.server.kill()
            cls.server = None

    def open_page(self, viewport=None):
        context = self.browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}
                                           if viewport else {"width": 1280, "height": 900})
        page = context.new_page()
        page.errors = []
        page.on("pageerror", lambda e: page.errors.append(str(e)))
        page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
        return context, page

    def open_landing(self, page):
        """Load the landing page and wait for it to finish hydrating.

        networkidle never fires here: the app keeps a websocket open, so the
        wait has to be on something the page actually renders.
        """
        page.goto(f"{self.base_url}/", wait_until="domcontentloaded")
        page.wait_for_selector("h2:has-text('Play Worlds')", timeout=30_000)

    def start_run(self, page):
        """Open a playable run of the snapshotted World and wait for the map."""
        response = page.request.post(
            f"{self.base_url}/api/create_game_session",
            data=json.dumps({"generator_id": self.world_id, "language": "en", "debug_seed": 7}),
            headers={"Content-Type": "application/json"},
        )
        self.assertTrue(response.ok, f"session creation failed: {response.status}")
        session_id = response.json()["session_id"]
        page.goto(f"{self.base_url}/game/{session_id}?lang=en")
        page.wait_for_selector("button[aria-label='Move east']:not([disabled])", timeout=45_000)

    def current_area(self, page):
        return page.evaluate("""() => {
            const label = [...document.querySelectorAll('*')]
                .find(e => e.children.length === 0 && e.textContent.trim() === 'Location');
            return label ? label.parentElement.parentElement.lastElementChild.textContent.trim() : '';
        }""")

    def step_east(self, page):
        """Move one cell east; report the arrival line and the area landed in.

        Story placements are added independently of entity placements, so even a
        World seeded with no enemies or items raises them, and an open sheet
        removes the movement buttons from the DOM entirely. Encounters are
        therefore cleared before moving - and the reveal is read before clearing
        the one that may open on arrival, since it self-dismisses in seconds and
        dismissing a sheet can take longer than that.
        """
        self.clear_encounter(page)
        page.click("button[aria-label='Move east']")
        page.wait_for_timeout(500)
        # Visibility, not presence. An earlier version of this checked only
        # count(), and passed while the reveal sat inside a stage that is
        # display:none for any World without art - which is the default.
        reveal = page.locator(".stage-arrival")
        showed = reveal.count() > 0 and reveal.first.is_visible()
        if showed:
            box = reveal.first.bounding_box()
            showed = bool(box and box["height"] > 0 and box["width"] > 0)
        area = self.current_area(page)
        self.clear_encounter(page)
        return showed, area

    def clear_encounter(self, page):
        for _ in range(4):
            dialog = page.locator("[role=dialog]")
            if not dialog.count():
                return
            choices = dialog.locator("button")
            if not choices.count():
                return
            choices.first.click()
            page.wait_for_timeout(700)

    def test_landing_page_loads_without_failed_requests(self):
        context, page = self.open_page()
        try:
            failures = []
            page.on("response", lambda r: failures.append((r.url, r.status)) if r.status >= 400 else None)
            self.open_landing(page)
            # /api/me answers 401 for a signed-out visitor by design; that is
            # the auth probe working, not a broken request.
            local = [(u, s) for u, s in failures
                     if "127.0.0.1" in u and not (u.endswith("/api/me") and s == 401)]
            self.assertEqual(local, [], f"failed requests on landing: {local}")
        finally:
            context.close()

    def test_no_horizontal_overflow_on_phones(self):
        for viewport in NARROW_VIEWPORTS:
            with self.subTest(viewport=viewport):
                context, page = self.open_page(viewport)
                try:
                    self.open_landing(page)
                    overflow = page.evaluate(
                        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
                    )
                    self.assertLessEqual(overflow, 1, f"landing overflows by {overflow}px at {viewport[0]}px")
                finally:
                    context.close()

    def test_world_cards_have_one_accessible_name_each(self):
        context, page = self.open_page()
        try:
            self.open_landing(page)
            page.get_by_role("button", name="Recent Dev").click()
            page.wait_for_timeout(400)
            names = page.get_by_role("button", name="Piedone a Tokyo").count()
            self.assertEqual(names, 1, "a World card should expose exactly one accessible name")
        finally:
            context.close()

    def test_movement_controls_are_above_the_fold_on_a_phone(self):
        context, page = self.open_page(NARROW_VIEWPORTS[0])
        try:
            self.start_run(page)
            box = page.locator("button[aria-label='Move east']").bounding_box()
            self.assertIsNotNone(box)
            self.assertLess(box["y"] + box["height"], NARROW_VIEWPORTS[0][1],
                            "movement controls must be reachable without scrolling")
        finally:
            context.close()

    def test_moving_raises_no_script_errors(self):
        # The regression this exists for: checkAreaCrossing was defined among the
        # computed properties, so every move threw and nothing else noticed.
        context, page = self.open_page()
        try:
            self.start_run(page)
            for _ in range(3):
                self.step_east(page)
            self.assertEqual(page.errors, [], f"script errors while moving: {page.errors}")
        finally:
            context.close()

    def test_the_seeded_world_has_no_art(self):
        """Guards the assumption the crossing test rests on.

        `ENABLE_WORLD_ART` is off by default, so the no-art path is the one most
        deployments run. If this World ever gains backdrops, the crossing test
        stops covering that path and should be paired with an art fixture.
        """
        import sys
        sys.path.insert(0, REPO_ROOT)
        from db import db
        raw = db.get_generator(self.world_id)["celltype_defs"]
        cells = list(raw.values()) if isinstance(raw, dict) else raw
        self.assertFalse(any(c.get("backdrop_url") for c in cells))

    def test_area_crossing_shows_its_line_and_only_then(self):
        context, page = self.open_page()
        try:
            self.start_run(page)
            start_area = self.current_area(page)
            steps_inside = 0

            # Walk east until the area changes rather than assuming which step
            # crosses: an encounter can cost a turn, and the assertion that
            # matters is the relationship, not the geometry.
            for _ in range(12):
                showed, area = self.step_east(page)
                if area == start_area:
                    self.assertFalse(showed, "no crossing text while inside one area")
                    steps_inside += 1
                else:
                    self.assertTrue(showed, f"entering {area!r} should show its crossing line")
                    break
            else:
                self.fail(f"never left {start_area!r} in 12 steps east")

            self.assertGreater(steps_inside, 0, "should have moved inside an area before crossing")
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()

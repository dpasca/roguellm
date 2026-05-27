import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager
from game_state_manager import WORLD_TRANSLATION_CACHE_VERSION
from tools.ensure_dev_worlds import DEV_PIEDONE_THEME, ensure_dev_worlds


REPO_ROOT = Path(__file__).resolve().parents[1]


async def passthrough_prerender(request, html_content):
    return html_content


class LandingSmokeTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "landing_smoke.db")
        manager.init_db()
        return manager

    def test_world_picker_landing_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            seeded_worlds = ensure_dev_worlds(manager)
            piedone = next(world for world in seeded_worlds if world["key"] == "piedone")
            piedone_translation = manager.get_generator_translation(
                piedone["id"],
                "en",
                WORLD_TRANSLATION_CACHE_VERSION,
            )

            self.assertIn("en", piedone["cached_translations"])
            self.assertIsNotNone(piedone_translation)
            self.assertEqual(piedone_translation["player_defs"][0]["name"], "Piedone")
            self.assertEqual(piedone_translation["item_defs"][0]["id"], "espresso")
            self.assertEqual(piedone_translation["enemy_defs"][0]["enemy_id"], "street_punk")

            with patch.dict(os.environ, {"ENABLE_WORLD_LIBRARY": "1"}), \
                    patch("main.db", manager), \
                    patch("main.get_prerendered_content", passthrough_prerender):
                main.game_session_manager.sessions.clear()
                with TestClient(main.app) as client:
                    landing = client.get("/?lang=en")
                    self.assertEqual(landing.status_code, 200)

                    html = landing.text
                    landing_js = (REPO_ROOT / "static/js/landing.js").read_text(encoding="utf-8")
                    self.assertIn('@click="quickStartPiedone()"', html)
                    self.assertIn('class="world-preview"', html)
                    self.assertIn(DEV_PIEDONE_THEME, landing_js)
                    self.assertNotIn('@click="quickStartPiedone"', html.replace('@click="quickStartPiedone()"', ""))
                    self.assertNotIn("selectedWorld()", landing_js)

                    world_label = html.index('class="world-option"')
                    inline_preview = html.index('class="world-preview"', world_label)
                    first_label_close = html.index("</label>", world_label)
                    self.assertLess(inline_preview, first_label_close)

                    worlds_response = client.get("/api/worlds/recent?limit=12")
                    self.assertEqual(worlds_response.status_code, 200)
                    worlds = worlds_response.json()["worlds"]
                    self.assertTrue(any(world["id"] == piedone["id"] for world in worlds))

                    session_response = client.post("/api/create_game_session", json={
                        "generator_id": piedone["id"],
                        "language": "en",
                        "do_web_search": False,
                    })
                    self.assertEqual(session_response.status_code, 200)
                    session_id = session_response.json()["session_id"]
                    self.assertEqual(
                        main.game_session_manager.sessions[session_id]["language"],
                        "en",
                    )


if __name__ == "__main__":
    unittest.main()

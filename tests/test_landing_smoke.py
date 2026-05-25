import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager


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
            piedone_id = manager.save_generator(
                theme_desc="piedone a tokyo",
                theme_desc_better="Piedone a Tokyo\nA testing world.",
                language="it",
                player_defs=[{"name": "Piedone"}],
                item_defs=[{"id": "espresso"}],
                enemy_defs=[{"enemy_id": "thug"}],
                celltype_defs={},
            )

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
                    self.assertNotIn('@click="quickStartPiedone"', html.replace('@click="quickStartPiedone()"', ""))
                    self.assertNotIn("selectedWorld()", landing_js)

                    world_label = html.index('class="world-option"')
                    inline_preview = html.index('class="world-preview"', world_label)
                    first_label_close = html.index("</label>", world_label)
                    self.assertLess(inline_preview, first_label_close)

                    worlds_response = client.get("/api/worlds/recent?limit=12")
                    self.assertEqual(worlds_response.status_code, 200)
                    worlds = worlds_response.json()["worlds"]
                    self.assertTrue(any(world["id"] == piedone_id for world in worlds))

                    session_response = client.post("/api/create_game_session", json={
                        "generator_id": piedone_id,
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

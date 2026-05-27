import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager
from tools.ensure_dev_worlds import ensure_dev_worlds


async def passthrough_prerender(request, html_content):
    return html_content


def make_test_map(celltype_defs, width=10, height=10):
    return [
        [celltype_defs[(x + y) % len(celltype_defs)] for x in range(width)]
        for y in range(height)
    ]


class GameSessionSmokeTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "game_session_smoke.db")
        manager.init_db()
        return manager

    def test_seeded_world_initializes_through_websocket_without_model_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            seeded_worlds = ensure_dev_worlds(manager)
            piedone = next(world for world in seeded_worlds if world["key"] == "piedone")
            piedone_data = manager.get_generator(piedone["id"])
            test_map = make_test_map(piedone_data["celltype_defs"])
            test_placements = [
                {"type": "item", "entity_id": "espresso", "x": 1, "y": 0},
                {"type": "enemy", "entity_id": "street_punk", "x": 2, "y": 0},
            ]

            with patch.dict(os.environ, {"ENABLE_DEBUG_SEED": "1"}), \
                    patch("main.db", manager), \
                    patch("game_state_manager.db", manager), \
                    patch("main.get_prerendered_content", passthrough_prerender), \
                    patch("gen_ai.GenAI.translate_world_definition") as translate_world, \
                    patch("gen_ai.GenAI.gen_game_map_from_celltypes", return_value=test_map), \
                    patch("gen_ai.GenAI.gen_entity_placements", return_value=test_placements), \
                    patch("gen_ai.GenAI.gen_adapt_sentence", side_effect=lambda state, events, text: text), \
                    patch("gen_ai.GenAI.gen_room_description", return_value="A quiet test room."):
                main.game_session_manager.sessions.clear()
                with TestClient(main.app) as client:
                    session_response = client.post("/api/create_game_session", json={
                        "generator_id": piedone["id"],
                        "language": "en",
                        "debug_seed": 123,
                    })
                    self.assertEqual(session_response.status_code, 200)
                    session_id = session_response.json()["session_id"]

                    with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                        self.assertEqual(websocket.receive_json()["status"], "creating")
                        self.assertEqual(websocket.receive_json()["status"], "creating")
                        self.assertEqual(websocket.receive_json()["status"], "ready")

                        connection = websocket.receive_json()
                        self.assertEqual(connection["type"], "connection_established")
                        self.assertEqual(connection["generator_id"], piedone["id"])

                        websocket.send_json({"action": "get_initial_state"})
                        initial = websocket.receive_json()

            translate_world.assert_not_called()
            self.assertEqual(initial["type"], "update")
            self.assertEqual(initial["generator_id"], piedone["id"])
            self.assertEqual(initial["state"]["game_title"], "Piedone a Tokyo")
            self.assertEqual(initial["state"]["player"]["name"], "Piedone")
            self.assertEqual(initial["state"]["player_pos"], [0, 0])
            self.assertEqual(initial["state"]["enemies"][0]["name"], "Street Punk")
            self.assertEqual(initial["state"]["enemies"][0]["x"], 2)
            self.assertEqual(initial["state"]["item_placements"][0]["name"], "Espresso")
            self.assertEqual(initial["state"]["item_placements"][0]["x"], 1)
            self.assertEqual(main.game_session_manager.sessions[session_id]["debug_seed"], 123)
            self.assertEqual(main.game_session_manager.sessions[session_id]["status"], "ready")


if __name__ == "__main__":
    unittest.main()

import unittest

from game_websocket_handler import WebSocketHandler
from models import Enemy, GameState
from websocket_schemas import QuitMessage, validate_websocket_message


class DummyGameStateManager:
    def __init__(self, state):
        self.state = state
        self.event_history = []

    async def create_message(self, description_raw="", description=""):
        return {
            "type": "update",
            "state": self.state.model_dump(mode="json"),
            "description_raw": description_raw,
            "description": description or description_raw,
        }

    async def create_message_description(self, message):
        message["description"] = message.get("description") or message.get("description_raw", "")
        return message

    def events_add(self, action, event_dict):
        self.event_history.append({
            "action": action,
            "event": event_dict,
        })


def make_state():
    enemy = Enemy(
        id="enemy_1",
        name="Test Enemy",
        hp=10,
        max_hp=10,
        attack=3,
        font_awesome_icon="fa-solid fa-skull",
        weapons=[],
    )
    return GameState(
        map_width=2,
        map_height=2,
        cell_types=[[{}, {}], [{}, {}]],
        explored=[[True, False], [False, False]],
        player_pos=(0, 0),
        player_pos_prev=(0, 0),
        player_hp=20,
        player_max_hp=20,
        player_attack=5,
        player_defense=0,
        current_enemy=enemy,
        in_combat=True,
        enemies=[],
        game_title="Quit Test",
        player={"font_awesome_icon": "fa-solid fa-user"},
    )


class WebSocketQuitTests(unittest.IsolatedAsyncioTestCase):
    def test_quit_message_validates(self):
        message = validate_websocket_message({"action": "quit", "client_action_id": 7})

        self.assertIsInstance(message, QuitMessage)
        self.assertEqual(message.client_action_id, 7)

    async def test_quit_marks_run_over_and_exits_combat(self):
        state = make_state()
        manager = DummyGameStateManager(state)
        handler = WebSocketHandler(manager, player_action_handler=None)

        response = await handler.handle_message({"action": "quit", "client_action_id": 7})

        self.assertTrue(state.game_over)
        self.assertFalse(state.in_combat)
        self.assertIsNone(state.current_enemy)
        self.assertEqual(response["response_action"], "quit")
        self.assertEqual(response["client_action_id"], 7)
        self.assertTrue(response["state"]["game_over"])
        self.assertFalse(response["state"]["in_combat"])
        self.assertIsNone(response["state"]["current_enemy"])
        self.assertEqual(manager.event_history[0]["action"], "quit")
        self.assertIn("You quit the run", response["description_raw"])


if __name__ == "__main__":
    unittest.main()

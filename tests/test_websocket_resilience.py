import json
import time
import unittest

from fastapi.testclient import TestClient

import main


class FakeStateManager:
    generator_id = "world-1"
    error_message = None


class FlakyGame:
    """Fails one action, then behaves. Mirrors a bad entity definition, which
    only raises on the turn the player happens to touch it."""

    def __init__(self, fail_on="move"):
        self.state_manager = FakeStateManager()
        self.fail_on = fail_on
        self.seen = []

    def add_client(self, websocket):
        pass

    def remove_client(self, websocket):
        pass

    async def handle_message(self, message):
        action = message.get("action")
        self.seen.append(action)
        if action == self.fail_on:
            raise ValueError("1 validation error for Item")
        return {"type": "update", "action": action}


class WebSocketResilienceTests(unittest.TestCase):
    """A failed action used to escape to the outer handler, closing the socket.
    The client reads that as code 1006 and redirects home, so one bad action
    ejected the player and lost the run."""

    def drive(self, game, actions):
        session_id = "session-1"
        main.game_session_manager.sessions[session_id] = {
            "created_at": time.time(),
            "last_accessed": time.time(),
            "game_instance": game,
            "generator_id": "world-1",
            "status": "ready",
        }
        try:
            client = TestClient(main.app)
            received = []
            with client.websocket_connect(f"/ws/game/{session_id}") as ws:
                ws.receive_json()  # connection_established
                for action in actions:
                    ws.send_json({"action": action})
                    # A regression closes the socket instead of replying, which
                    # would otherwise block this read forever. Surface it as a
                    # failure rather than a hung suite.
                    message = ws.receive()
                    if message["type"] == "websocket.close":
                        raise AssertionError(
                            f"server closed the socket on action '{action}'; "
                            "the run would be lost and the client redirected home"
                        )
                    received.append(json.loads(message["text"]))
            return received
        finally:
            main.game_session_manager.sessions.pop(session_id, None)

    def test_a_failing_action_does_not_end_the_session(self):
        game = FlakyGame(fail_on="move")

        received = self.drive(game, ["look", "move", "look"])

        self.assertEqual(len(received), 3, "the session must survive the failure")
        self.assertEqual(received[0]["type"], "update")
        self.assertEqual(received[1]["type"], "error")
        self.assertEqual(received[2]["type"], "update",
                         "play must continue after a failed action")

    def test_the_failure_is_reported_rather_than_swallowed(self):
        game = FlakyGame(fail_on="move")

        received = self.drive(game, ["move"])

        self.assertEqual(received[0]["type"], "error")
        self.assertIn("could not be completed", received[0]["message"])

    def test_every_action_still_reaches_the_game(self):
        game = FlakyGame(fail_on="move")

        self.drive(game, ["look", "move", "attack"])

        self.assertEqual(game.seen, ["look", "move", "attack"])

    def test_successful_responses_still_carry_the_world_id(self):
        game = FlakyGame(fail_on="nothing")

        received = self.drive(game, ["look"])

        self.assertEqual(received[0]["generator_id"], "world-1")


if __name__ == "__main__":
    unittest.main()

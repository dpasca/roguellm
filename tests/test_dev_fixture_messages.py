import unittest
from unittest.mock import AsyncMock

from game_state_manager import GameStateManager


class DevFixtureMessageTests(unittest.IsolatedAsyncioTestCase):
    async def test_loaded_dev_fixture_uses_raw_description_without_model_call(self):
        manager = GameStateManager.__new__(GameStateManager)
        manager.dev_fixture_loaded = True
        manager._gen_adapt_sentence = AsyncMock(side_effect=AssertionError("model should not be called"))

        message = {
            "type": "update",
            "description_raw": "A Test Enemy appears!",
            "description": "",
        }

        result = await manager.create_message_description(message)

        self.assertEqual(result["description"], "A Test Enemy appears!")
        manager._gen_adapt_sentence.assert_not_called()

    async def test_non_fixture_message_still_uses_model_adaptation(self):
        manager = GameStateManager.__new__(GameStateManager)
        manager.dev_fixture_loaded = False
        manager._gen_adapt_sentence = AsyncMock(return_value="Adapted event text")

        message = {
            "type": "update",
            "description_raw": "A Test Enemy appears!",
            "description": "",
        }

        result = await manager.create_message_description(message)

        self.assertEqual(result["description"], "Adapted event text")
        manager._gen_adapt_sentence.assert_awaited_once_with("A Test Enemy appears!")


if __name__ == "__main__":
    unittest.main()

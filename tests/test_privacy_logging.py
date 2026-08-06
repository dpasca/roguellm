import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from gen_ai import GenAI, MODEL_QUALITY_LOW


class FakeCompletions:
    async def create(self, **kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="PRIVATE RESPONSE BODY")
                )
            ]
        )


class PrivacyLoggingTests(unittest.TestCase):
    def test_quick_completion_does_not_log_prompt_or_response_by_default(self):
        fake_client = SimpleNamespace(
            chat=SimpleNamespace(completions=FakeCompletions())
        )
        fake_model = SimpleNamespace(
            model_name="fake-model",
            client=fake_client,
            completion_params=lambda: {"model": "fake-model"},
        )
        gen_ai = GenAI(lo_model=fake_model, hi_model=fake_model)

        with patch.dict(os.environ, {"ENABLE_LLM_CONTENT_LOGGING": ""}):
            with self.assertLogs(level="INFO") as logs:
                result = asyncio.run(gen_ai._quick_completion(
                    system_msg="PRIVATE SYSTEM BODY",
                    user_msg="PRIVATE USER BODY",
                    quality=MODEL_QUALITY_LOW,
                ))

        logged_text = "\n".join(logs.output)
        self.assertEqual(result, "PRIVATE RESPONSE BODY")
        self.assertIn("Requesting completion with model fake-model", logged_text)
        self.assertIn("Obtained completion", logged_text)
        self.assertNotIn("PRIVATE SYSTEM BODY", logged_text)
        self.assertNotIn("PRIVATE USER BODY", logged_text)
        self.assertNotIn("PRIVATE RESPONSE BODY", logged_text)


if __name__ == "__main__":
    unittest.main()

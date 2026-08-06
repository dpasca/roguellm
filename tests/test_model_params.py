import unittest

from gen_ai import (
    DEFAULT_HIGH_SPEC_MODEL,
    DEFAULT_LOW_SPEC_MODEL,
    GenAIModel,
    resolve_reasoning_effort,
)


def params(model_name, reasoning_effort):
    model = GenAIModel(
        model_name=model_name,
        api_key="test-key",
        reasoning_effort=reasoning_effort,
    )
    return model.completion_params()


class CompletionParamsTests(unittest.TestCase):
    """Reasoning effort is the only generation knob we send."""

    def test_reasoning_model_receives_the_effort(self):
        self.assertEqual(
            params(DEFAULT_HIGH_SPEC_MODEL, "low"),
            {"model": DEFAULT_HIGH_SPEC_MODEL, "reasoning_effort": "low"},
        )

    def test_legacy_model_never_receives_the_effort_parameter(self):
        # A deployment still pinning gpt-4.1-mini in its .env keeps working:
        # the older model 400s on reasoning_effort, so it is stripped.
        self.assertEqual(params("gpt-4.1-mini", "none"), {"model": "gpt-4.1-mini"})

    def test_resolve_reasoning_effort_matches_model_family(self):
        self.assertEqual(resolve_reasoning_effort("gpt-5.6-terra", "low"), "low")
        self.assertEqual(resolve_reasoning_effort("o3", "high"), "high")
        self.assertIsNone(resolve_reasoning_effort("gpt-4.1-mini", "low"))
        self.assertIsNone(resolve_reasoning_effort("gpt-5.6-terra", None))

    def test_defaults_name_distinct_tiers(self):
        # The previous defaults pointed both tiers at the same model, which made
        # the high tier a no-op.
        self.assertNotEqual(DEFAULT_LOW_SPEC_MODEL, DEFAULT_HIGH_SPEC_MODEL)


if __name__ == "__main__":
    unittest.main()

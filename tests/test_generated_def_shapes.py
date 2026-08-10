import asyncio
import json
import unittest
from types import SimpleNamespace

from gen_ai import (
    GenAI,
    MODEL_QUALITY_LOW,
    generated_defs_response_format,
    json_schema_from_sample,
    normalize_generated_defs,
)


class RecordingCompletions:
    def __init__(self, content, fail_first=False):
        self.content = content
        self.fail_first = fail_first
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail_first and len(self.calls) == 1:
            raise RuntimeError("response_format is unsupported")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))],
            usage=None,
        )


def make_gen_ai(completions):
    model = SimpleNamespace(
        model_name="test-model",
        client=SimpleNamespace(chat=SimpleNamespace(completions=completions)),
        completion_params=lambda: {"model": "test-model"},
    )
    gen_ai = GenAI(lo_model=model, hi_model=model)
    gen_ai.theme_desc = "A test world"
    return gen_ai


class NormalizeGeneratedDefsTests(unittest.TestCase):
    """The model puts the right content in the wrong container intermittently.

    Every shape here was observed from a real call. The bare-object case broke a
    forge partway through, after the definitions and theme had already been paid
    for, because gen_visual_manifest sliced it.
    """

    def test_list_passes_through(self):
        defs = [{"name": "A"}, {"name": "B"}]
        self.assertEqual(normalize_generated_defs(defs), defs)

    def test_bare_object_becomes_one_entry(self):
        # What a one-element sample tends to produce: the object, not an array.
        player = {"name": "Courier", "class": "Runner", "hp": 100}
        self.assertEqual(normalize_generated_defs(player), [player])

    def test_wrapper_key_is_unwrapped(self):
        entries = [{"name": "A"}, {"name": "B"}]
        self.assertEqual(normalize_generated_defs({"player_defs": entries}), entries)

    def test_id_keyed_mapping_keeps_its_ids(self):
        # The key is the id in this shape, so dropping it would break the map,
        # which joins terrain to backdrops by id.
        result = normalize_generated_defs({"0": {"name": "Open"}, "1": {"name": "Shelter"}})
        self.assertEqual(
            result,
            [{"name": "Open", "id": "0"}, {"name": "Shelter", "id": "1"}],
        )

    def test_existing_ids_are_not_overwritten(self):
        result = normalize_generated_defs({"0": {"id": "open-ground", "name": "Open"}})
        self.assertEqual(result[0]["id"], "open-ground")

    def test_junk_is_dropped_rather_than_raising(self):
        # A partial response should cost the caller nothing worse than an
        # artless World; it must not take the forge down.
        self.assertEqual(normalize_generated_defs(None), [])
        self.assertEqual(normalize_generated_defs("not json"), [])
        self.assertEqual(normalize_generated_defs([{"ok": 1}, "junk", 5]), [{"ok": 1}])

    def test_single_entry_mapping_is_not_read_as_a_wrapper(self):
        # {"0": {...}} has one key like a wrapper does, but its value is an
        # object, not an array, so it is an id-keyed mapping.
        self.assertEqual(
            normalize_generated_defs({"0": {"name": "Open"}}),
            [{"name": "Open", "id": "0"}],
        )


class StructuredGeneratedDefsTests(unittest.TestCase):
    def test_schema_preserves_nested_object_variants(self):
        schema = json_schema_from_sample({
            "item_defs": [
                {"name": "Weapon", "effect": {"attack": 3}},
                {"name": "Remedy", "effect": {"health": 10}},
            ],
        })

        self.assertEqual(schema["type"], "object")
        self.assertEqual(schema["required"], ["item_defs"])
        self.assertFalse(schema["additionalProperties"])
        variants = schema["properties"]["item_defs"]["items"]["anyOf"]
        self.assertEqual(len(variants), 2)
        self.assertTrue(all(variant["additionalProperties"] is False for variant in variants))
        self.assertEqual(
            {tuple(variant["properties"]["effect"]["required"]) for variant in variants},
            {("attack",), ("health",)},
        )

    def test_definition_response_format_is_strict_and_named(self):
        response_format = generated_defs_response_format(
            "player_defs",
            [{"name": "Courier", "hp": 100}],
        )

        self.assertEqual(response_format["type"], "json_schema")
        self.assertEqual(response_format["json_schema"]["name"], "generated_player_defs")
        self.assertTrue(response_format["json_schema"]["strict"])
        self.assertEqual(
            response_format["json_schema"]["schema"]["required"],
            ["player_defs"],
        )

    def test_generation_preserves_the_template_wrapper(self):
        completions = RecordingCompletions('{"name":"Courier","hp":100}')
        gen_ai = make_gen_ai(completions)
        template = json.dumps({
            "player_defs": [{"name": "Sample", "hp": 50}],
        })

        result = asyncio.run(gen_ai.gen_players_from_json_sample(template))

        self.assertEqual(result, {"player_defs": [{"name": "Courier", "hp": 100}]})
        request = completions.calls[0]
        self.assertEqual(json.loads(request["messages"][1]["content"]), json.loads(template))
        self.assertEqual(request["response_format"]["type"], "json_schema")

    def test_list_template_is_canonicalized_to_the_public_wrapper(self):
        completions = RecordingCompletions(
            '{"player_defs":[{"name":"Courier","hp":100}]}'
        )
        gen_ai = make_gen_ai(completions)

        result = asyncio.run(gen_ai.gen_players_from_json_sample(
            '[{"name":"Sample","hp":50}]'
        ))

        self.assertEqual(result, {"player_defs": [{"name": "Courier", "hp": 100}]})
        user_sample = json.loads(completions.calls[0]["messages"][1]["content"])
        self.assertEqual(user_sample, {"player_defs": [{"name": "Sample", "hp": 50}]})

    def test_empty_generation_falls_back_to_the_playable_sample(self):
        completions = RecordingCompletions('{"player_defs":[]}')
        gen_ai = make_gen_ai(completions)
        template = {"player_defs": [{"name": "Sample", "hp": 50}]}

        result = asyncio.run(gen_ai.gen_players_from_json_sample(json.dumps(template)))

        self.assertEqual(result, template)

    def test_unsupported_response_format_retries_without_it(self):
        completions = RecordingCompletions("fallback response", fail_first=True)
        gen_ai = make_gen_ai(completions)

        result = asyncio.run(gen_ai._quick_completion(
            system_msg="system",
            user_msg="user",
            quality=MODEL_QUALITY_LOW,
            response_format={"type": "json_object"},
        ))

        self.assertEqual(result, "fallback response")
        self.assertIn("response_format", completions.calls[0])
        self.assertNotIn("response_format", completions.calls[1])


if __name__ == "__main__":
    unittest.main()

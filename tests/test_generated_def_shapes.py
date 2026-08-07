import unittest

from gen_ai import normalize_generated_defs


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


if __name__ == "__main__":
    unittest.main()

import json
import os
import unittest
from unittest.mock import patch

from game_state_manager import GameStateManager, MAX_REGIONS
from models import GameState

with open("game_config.json", encoding="utf-8") as handle:
    CONFIG = json.load(handle)
with open("game_celltypes.json", encoding="utf-8") as handle:
    CELLTYPE_DEFS = json.load(handle)["celltype_defs"]


def build_map(seed, celltype_defs=None):
    """Lay out one map without touching the network or the database."""
    with patch.dict(os.environ, {
        "LOW_SPEC_MODEL_API_KEY": "test-key",
        "HIGH_SPEC_MODEL_API_KEY": "test-key",
    }):
        manager = GameStateManager(seed=seed, theme_desc="test")
    manager.state = GameState.from_config(CONFIG)
    manager.definitions.celltype_defs = celltype_defs or CELLTYPE_DEFS
    manager.state.cell_types = manager.build_region_map()
    manager.state.regions = manager.derive_regions()
    return manager


class RegionLayoutTests(unittest.TestCase):
    """The map must read as a few contiguous places, not per-cell noise.

    derive_regions finds connected components of equal terrain, so asserting
    that it returns exactly one region per terrain is also an assertion that
    every region is contiguous - a split region would show up as two.
    """

    def test_regions_are_contiguous_and_cover_the_map(self):
        cells = CONFIG["map_size"]["width"] * CONFIG["map_size"]["height"]
        for seed in range(25):
            with self.subTest(seed=seed):
                manager = build_map(seed)
                regions = manager.state.regions
                self.assertEqual(len(regions), len(CELLTYPE_DEFS))
                self.assertEqual(sum(r["cell_count"] for r in regions), cells)

    def test_no_two_regions_share_a_terrain(self):
        # Two areas that look identical would defeat the point, and would also
        # merge into one component if they ever touched.
        for seed in range(25):
            with self.subTest(seed=seed):
                regions = build_map(seed).state.regions
                terrain_ids = [r["terrain_id"] for r in regions]
                self.assertEqual(len(set(terrain_ids)), len(terrain_ids))

    def test_regions_are_evenly_sized(self):
        # Round-robin growth exists for this: plain BFS hands most of the map to
        # whichever seed had the most room, which is a run spent in one place.
        cells = CONFIG["map_size"]["width"] * CONFIG["map_size"]["height"]
        expected = cells / len(CELLTYPE_DEFS)
        for seed in range(25):
            with self.subTest(seed=seed):
                for region in build_map(seed).state.regions:
                    self.assertLess(abs(region["cell_count"] - expected), expected * 0.5)

    def test_layout_is_deterministic_for_a_seed(self):
        first, second = build_map(4242), build_map(4242)
        self.assertEqual(
            [[first._cell_id(c) for c in row] for row in first.state.cell_types],
            [[second._cell_id(c) for c in row] for row in second.state.cell_types],
        )

    def test_regions_are_ordered_outward_from_the_spawn(self):
        regions = build_map(11).state.regions
        distances = [r["distance_from_start"] for r in regions]
        self.assertEqual(distances, sorted(distances))
        self.assertEqual(regions[0]["distance_from_start"], 0)

    def test_one_region_per_terrain(self):
        # Every terrain gets an area, so no backdrop the forge paid for goes
        # unused, and a World with fewer terrains simply gets fewer areas.
        for count in (2, 3, len(CELLTYPE_DEFS)):
            with self.subTest(terrains=count):
                regions = build_map(5, celltype_defs=CELLTYPE_DEFS[:count]).state.regions
                self.assertEqual(len(regions), count)

    def test_region_count_is_capped(self):
        many = [dict(CELLTYPE_DEFS[i % len(CELLTYPE_DEFS)], id=f"t{i}") for i in range(12)]
        self.assertEqual(len(build_map(5, celltype_defs=many).state.regions), MAX_REGIONS)

    def test_random_map_is_the_noise_this_replaces(self):
        # Guards the contrast: if make_random_map ever became the default again,
        # this is what the map would look like.
        manager = build_map(3)
        manager.state.cell_types = manager.make_random_map()
        self.assertGreater(len(manager.derive_regions()), len(CELLTYPE_DEFS) * 3)



class RegionAdjacencyTests(unittest.TestCase):
    """Crossings are only coherent if the geography handed to the model is real."""

    def test_every_region_touches_at_least_one_other(self):
        for seed in range(15):
            with self.subTest(seed=seed):
                for region in build_map(seed).state.regions:
                    self.assertTrue(region["neighbours"])

    def test_adjacency_is_symmetric(self):
        # An asymmetric pair would produce a crossing in one direction only,
        # so walking back would silently say nothing.
        for seed in range(15):
            with self.subTest(seed=seed):
                regions = {r["id"]: r for r in build_map(seed).state.regions}
                for region in regions.values():
                    for other in region["neighbours"]:
                        self.assertIn(region["id"], regions[other]["neighbours"])

    def test_region_ids_grid_matches_the_map(self):
        manager = build_map(9)
        grid = manager.state.region_ids
        by_id = {r["id"]: r for r in manager.state.regions}
        self.assertEqual(len(grid), manager.state.map_height)
        for y, row in enumerate(grid):
            self.assertEqual(len(row), manager.state.map_width)
            for x, region_id in enumerate(row):
                self.assertEqual(
                    by_id[region_id]["terrain_id"],
                    manager._cell_id(manager.state.cell_types[y][x]),
                )

    def test_border_line_only_fires_on_a_crossing(self):
        manager = build_map(9)
        grid = manager.state.region_ids
        for region in manager.state.regions:
            region["borders"] = {other: f"into {other}" for other in region["neighbours"]}

        inside = crossing = None
        for y in range(manager.state.map_height):
            for x in range(manager.state.map_width - 1):
                pair = ((x, y), (x + 1, y))
                if grid[y][x] == grid[y][x + 1]:
                    inside = inside or pair
                else:
                    crossing = crossing or pair

        self.assertEqual(manager.border_line(*inside), "")
        self.assertTrue(manager.border_line(*crossing).startswith("into "))

if __name__ == "__main__":
    unittest.main()

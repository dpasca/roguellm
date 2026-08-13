#!/usr/bin/env python3
"""Seed a deterministic, model-free World for exercising Auto Review locally."""

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db import WORLD_SNAPSHOT_VERSION, db  # noqa: E402
from tools.ensure_dev_worlds import ensure_dev_worlds  # noqa: E402


WIDTH = 10
HEIGHT = 8
TERRAIN_BANDS = (
    ("street", "Neon Street", 0, 3),
    ("market", "Market Stall", 3, 5),
    ("dock", "Harbor Dock", 5, 8),
    ("alley", "Back Alley", 8, 10),
)

QUICK_DESCRIPTIONS = {
    "street": "Rain shines beneath impatient neon and the traffic never quite stops.",
    "market": "Steam, bargaining voices, and paper lanterns crowd the narrow passage.",
    "dock": "Dark water knocks against the pilings beyond stacks of wet cargo.",
    "alley": "Fire escapes and humming signs turn the shortcut into a tunnel of shadow.",
}


def terrain_at(x):
    return next(band for band in TERRAIN_BANDS if band[2] <= x < band[3])


def build_regions():
    borders = {
        (0, 1): "The neon avenue narrows until market lanterns replace the traffic lights.",
        (1, 0): "The market noise falls behind as the broad neon street opens again.",
        (1, 2): "The smell of broth gives way to salt air and the knock of loose rigging.",
        (2, 1): "Leaving the water, you step back into the market's warmth and noise.",
        (2, 3): "The open harbor closes around you as stacked buildings form a dark alley.",
        (3, 2): "The alley spills out beside the harbor, where the horizon opens over black water.",
    }
    regions = []
    for index, (terrain_id, name, start, end) in enumerate(TERRAIN_BANDS):
        neighbours = []
        if index > 0:
            neighbours.append(f"region-{index - 1}")
        if index < len(TERRAIN_BANDS) - 1:
            neighbours.append(f"region-{index + 1}")
        regions.append({
            "id": f"region-{index}",
            "terrain_id": terrain_id,
            "name": name,
            "cell_count": (end - start) * HEIGHT,
            "distance_from_start": start,
            "neighbours": neighbours,
            "borders": {
                f"region-{other}": line
                for (origin, other), line in borders.items()
                if origin == index
            },
        })
    return regions


def seed_showcase(database=db):
    worlds = ensure_dev_worlds(database)
    world = next(candidate for candidate in worlds if candidate["key"] == "piedone")

    rows = []
    tiles = []
    for y in range(HEIGHT):
        row = []
        for x in range(WIDTH):
            terrain_id, terrain_name, _, _ = terrain_at(x)
            row.append(terrain_id)
            tiles.append({
                "x": x,
                "y": y,
                "label": terrain_name,
                "quick_desc": QUICK_DESCRIPTIONS[terrain_id],
                "inspect_desc": (
                    f"{QUICK_DESCRIPTIONS[terrain_id]} "
                    "Every route is open, but the map only reveals what Piedone has crossed."
                ),
            })
        rows.append(",".join(row))

    placements = [
        {"type": "item", "entity_id": "espresso", "x": 1, "y": 0},
        {"type": "item", "entity_id": "frying_pan", "x": 4, "y": 1},
        {"type": "item", "entity_id": "police_badge", "x": 6, "y": 3},
        {"type": "enemy", "entity_id": "street_punk", "x": 2, "y": 2},
        {"type": "enemy", "entity_id": "dock_thug", "x": 7, "y": 2},
        {"type": "enemy", "entity_id": "yakuza_lieutenant", "x": 9, "y": 6},
    ]

    database.save_generator_world(
        generator_id=world["id"],
        language="en",
        map_csv="\n".join(rows),
        entity_placements=placements,
        tile_info_by_language={"en": tiles},
        snapshot_version=WORLD_SNAPSHOT_VERSION,
        regions_by_language={"en": build_regions()},
    )
    return world


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print machine-readable metadata.")
    args = parser.parse_args()
    world = seed_showcase()
    payload = {
        "world_id": world["id"],
        "title": world["title"],
        "language": "en",
        "spectator_path": f"/?lang=en",
    }
    if args.json:
        print(json.dumps(payload, indent=2))
        return
    print(f"Seeded Auto Review showcase: {payload['title']} ({payload['world_id']})")


if __name__ == "__main__":
    main()

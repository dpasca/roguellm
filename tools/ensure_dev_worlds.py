#!/usr/bin/env python3
"""Seed deterministic local Worlds for development and smoke testing."""

import argparse
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db import db  # noqa: E402


DEV_PIEDONE_THEME = "dev:piedone-a-tokyo"
DEV_FANTASY_THEME = "dev:clockwork-library"


DEV_WORLDS = [
    {
        "key": "piedone",
        "theme_desc": DEV_PIEDONE_THEME,
        "theme_desc_better": (
            "Piedone a Tokyo\n"
            "A compact dev world for testing reusable worlds, language switching, "
            "items, and visible enemy encounters without generating new definitions."
        ),
        "language": "it",
        "player_defs": [
            {
                "name": "Piedone",
                "age": 45,
                "class": "detective",
                "height_cm": 190,
                "weight_kg": 110,
                "font_awesome_icon": "fa-solid fa-user",
            }
        ],
        "item_defs": [
            {
                "id": "espresso",
                "name": "Espresso",
                "type": "consumable",
                "effect": {"health": 20},
                "description": "A tiny cup of coffee with suspicious restorative force.",
                "font_awesome_icon": "fa-solid fa-mug-hot",
            },
            {
                "id": "frying_pan",
                "name": "Frying Pan",
                "type": "weapon",
                "effect": {"attack": 4},
                "description": "Heavy, loud, and useful in a disagreement.",
                "font_awesome_icon": "fa-solid fa-utensils",
            },
            {
                "id": "police_badge",
                "name": "Police Badge",
                "type": "armor",
                "effect": {"defense": 2},
                "description": "A badge that makes small-time crooks reconsider.",
                "font_awesome_icon": "fa-solid fa-shield-halved",
            },
        ],
        "enemy_defs": [
            {
                "enemy_id": "street_punk",
                "name": "Street Punk",
                "font_awesome_icon": "fa-solid fa-user-ninja",
                "hp": {"min": 24, "max": 36},
                "attack": {"min": 6, "max": 10},
                "defense": {"min": 1, "max": 3},
                "xp": 8,
                "weapons": ["Chain", "Cheap Knife"],
            },
            {
                "enemy_id": "dock_thug",
                "name": "Dock Thug",
                "font_awesome_icon": "fa-solid fa-anchor",
                "hp": {"min": 35, "max": 48},
                "attack": {"min": 8, "max": 12},
                "defense": {"min": 2, "max": 4},
                "xp": 12,
                "weapons": ["Crowbar", "Broken Oar"],
            },
            {
                "enemy_id": "yakuza_lieutenant",
                "name": "Yakuza Lieutenant",
                "font_awesome_icon": "fa-solid fa-user-tie",
                "hp": {"min": 50, "max": 70},
                "attack": {"min": 12, "max": 16},
                "defense": {"min": 4, "max": 6},
                "xp": 22,
                "weapons": ["Cane Sword", "Pistol"],
            },
        ],
        "celltype_defs": [
            {
                "id": "street",
                "name": "Neon Street",
                "description": "A rain-slick street under buzzing signs.",
                "map_color": "#2F6F7E",
                "font_awesome_icon": "fa-solid fa-road",
            },
            {
                "id": "market",
                "name": "Market Stall",
                "description": "A cramped row of food stalls and shouted bargains.",
                "map_color": "#6F8E3F",
                "font_awesome_icon": "fa-solid fa-store",
            },
            {
                "id": "dock",
                "name": "Harbor Dock",
                "description": "Wooden piers, stacked crates, and dark water.",
                "map_color": "#31547A",
                "font_awesome_icon": "fa-solid fa-anchor",
            },
            {
                "id": "alley",
                "name": "Back Alley",
                "description": "A narrow shortcut where trouble likes to wait.",
                "map_color": "#4A4A4A",
                "font_awesome_icon": "fa-solid fa-dumpster",
            },
        ],
    },
    {
        "key": "fantasy",
        "theme_desc": DEV_FANTASY_THEME,
        "theme_desc_better": (
            "Clockwork Library\n"
            "A stable English dev world with simple enemies and items for quick "
            "non-Piedone testing."
        ),
        "language": "en",
        "player_defs": [
            {
                "name": "Archivist",
                "age": 31,
                "class": "scribe",
                "height_cm": 170,
                "weight_kg": 68,
                "font_awesome_icon": "fa-solid fa-user",
            }
        ],
        "item_defs": [
            {
                "id": "brass_key",
                "name": "Brass Key",
                "type": "consumable",
                "effect": {"health": 15},
                "description": "A warm little key that hums beside locked shelves.",
                "font_awesome_icon": "fa-solid fa-key",
            },
            {
                "id": "index_blade",
                "name": "Index Blade",
                "type": "weapon",
                "effect": {"attack": 3},
                "description": "A paper-thin sword with alphabetized runes.",
                "font_awesome_icon": "fa-solid fa-book",
            },
        ],
        "enemy_defs": [
            {
                "enemy_id": "ink_imp",
                "name": "Ink Imp",
                "font_awesome_icon": "fa-solid fa-droplet",
                "hp": {"min": 18, "max": 30},
                "attack": {"min": 5, "max": 8},
                "defense": {"min": 1, "max": 2},
                "xp": 7,
                "weapons": ["Ink Splash"],
            },
            {
                "enemy_id": "shelf_golem",
                "name": "Shelf Golem",
                "font_awesome_icon": "fa-solid fa-book-open",
                "hp": {"min": 42, "max": 58},
                "attack": {"min": 9, "max": 13},
                "defense": {"min": 4, "max": 6},
                "xp": 16,
                "weapons": ["Falling Volume"],
            },
        ],
        "celltype_defs": [
            {
                "id": "reading_room",
                "name": "Reading Room",
                "description": "Quiet desks lit by brass lamps.",
                "map_color": "#6B5B3E",
                "font_awesome_icon": "fa-solid fa-book-open",
            },
            {
                "id": "stacks",
                "name": "Book Stacks",
                "description": "Tall shelves arranged like a maze.",
                "map_color": "#4D6A50",
                "font_awesome_icon": "fa-solid fa-book",
            },
            {
                "id": "gear_hall",
                "name": "Gear Hall",
                "description": "A corridor of ticking brass machinery.",
                "map_color": "#7B6F3A",
                "font_awesome_icon": "fa-solid fa-gear",
            },
        ],
    },
]


def ensure_dev_worlds(db_manager=db):
    db_manager.init_db()
    seeded = []
    for world in DEV_WORLDS:
        world_id = db_manager.save_generator(
            theme_desc=world["theme_desc"],
            theme_desc_better=world["theme_desc_better"],
            language=world["language"],
            player_defs=world["player_defs"],
            item_defs=world["item_defs"],
            enemy_defs=world["enemy_defs"],
            celltype_defs=world["celltype_defs"],
        )
        seeded.append({
            "key": world["key"],
            "id": world_id,
            "title": world["theme_desc_better"].splitlines()[0],
            "theme": world["theme_desc"],
            "language": world["language"],
        })
    return seeded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print seeded world metadata as JSON.",
    )
    args = parser.parse_args()

    seeded = ensure_dev_worlds()
    if args.json:
        print(json.dumps({"worlds": seeded}, indent=2))
        return

    print("Seeded dev worlds:")
    for world in seeded:
        print(
            f"- {world['key']}: {world['title']} "
            f"({world['language']}) -> {world['id']}"
        )


if __name__ == "__main__":
    main()

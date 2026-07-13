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
from game_state_manager import WORLD_TRANSLATION_CACHE_VERSION  # noqa: E402


DEV_PIEDONE_THEME = "dev:piedone-a-tokyo"
DEV_FANTASY_THEME = "dev:clockwork-library"

PIEDONE_ENCOUNTERS = {
    "street": [{
        "id": "noodle_stall_tip",
        "title": "The Nervous Noodle Vendor",
        "description": "A vendor keeps glancing at a black sedan while pretending to polish bowls.",
        "resolved_description": "The vendor concentrates very hard on serving noodles.",
        "font_awesome_icon": "fa-solid fa-bowl-food",
        "choices": [
            {
                "id": "buy_and_listen",
                "label": "Buy a bowl and listen",
                "result": "Over a heroic portion of noodles, the vendor quietly names the gang's dock contact.",
                "effect": {"item_id": "espresso", "xp": 4},
            },
            {
                "id": "flash_badge",
                "label": "Flash the badge",
                "result": "The badge gets an answer—and the sedan's passenger gets out swinging.",
                "effect": {"combat_enemy_id": "street_punk", "xp": 2},
            },
        ],
    }],
    "market": [{
        "id": "shuttered_pachinko",
        "title": "Shuttered Pachinko Parlor",
        "description": "The front is locked, but fresh cigarette smoke curls from a side window.",
        "resolved_description": "The parlor is quiet now, its neon sign blinking to nobody.",
        "font_awesome_icon": "fa-solid fa-coins",
        "choices": [
            {
                "id": "force_shutter",
                "label": "Force the shutter",
                "result": "The metal gives way with all the subtlety of a train crash. Someone was waiting inside.",
                "effect": {"health": -3, "combat_enemy_id": "dock_thug", "xp": 5},
            },
            {
                "id": "check_side_window",
                "label": "Check the side window",
                "result": "Patience reveals a betting ledger and the route used to move protection money.",
                "effect": {"xp": 9},
            },
        ],
    }],
    "dock": [{
        "id": "manifest_in_rain",
        "title": "Manifest in the Rain",
        "description": "A shipping manifest is pinned beneath a crate while footsteps approach along the pier.",
        "resolved_description": "Rain washes ink from the empty space beneath the crate.",
        "font_awesome_icon": "fa-solid fa-file-lines",
        "choices": [
            {
                "id": "grab_manifest",
                "label": "Grab the manifest",
                "result": "You wrench it free, bark your knuckles, and catch the name of the racket's lieutenant.",
                "effect": {"health": -4, "xp": 11},
            },
            {
                "id": "shadow_footsteps",
                "label": "Shadow the footsteps",
                "result": "You let the paper go and follow a courier to the gang's next meeting point.",
                "effect": {"xp": 8},
            },
        ],
    }],
    "alley": [{
        "id": "dumpster_whistle",
        "title": "A Whistle Behind the Dumpster",
        "description": "Someone whistles the police march badly, then slides a wrapped parcel into view.",
        "resolved_description": "Only rainwater and a badly whistled tune remain.",
        "font_awesome_icon": "fa-solid fa-box-open",
        "choices": [
            {
                "id": "open_parcel",
                "label": "Open the parcel",
                "result": "Inside is a stolen police badge and a note: 'They know you're here.'",
                "effect": {"item_id": "police_badge", "xp": 4},
            },
            {
                "id": "follow_whistler",
                "label": "Follow the whistler",
                "result": "The informant bolts. The man covering his escape does not.",
                "effect": {"combat_enemy_id": "street_punk", "xp": 6},
            },
        ],
    }],
}

CLOCKWORK_ENCOUNTERS = {
    "reading_room": [{
        "id": "arguing_marginalia",
        "title": "Arguing Marginalia",
        "description": "Two handwritten notes dispute which reader is real—you or the one reflected in the lamp.",
        "resolved_description": "The margins have settled on an uneasy footnote.",
        "font_awesome_icon": "fa-solid fa-pen-nib",
        "choices": [
            {"id": "answer_notes", "label": "Answer in the margin", "result": "The book accepts your proof and reveals a forbidden shelf mark.", "effect": {"xp": 8}},
            {"id": "close_book", "label": "Close the book", "result": "The cover snaps shut, catching your fingers but trapping the false reflection.", "effect": {"health": -3, "xp": 5}},
        ],
    }],
    "stacks": [{
        "id": "moving_shelf",
        "title": "The Moving Shelf",
        "description": "A whole bookcase inches sideways whenever you look away.",
        "resolved_description": "The shelf has stopped moving, for now.",
        "font_awesome_icon": "fa-solid fa-book-bookmark",
        "choices": [
            {"id": "wedge_key", "label": "Wedge it open", "result": "A brass key jams the mechanism and exposes a narrow catalog passage.", "effect": {"item_id": "brass_key", "xp": 4}},
            {"id": "ride_shelf", "label": "Ride the shelf", "result": "The shelf carries you through a wall and drops you among several offended books.", "effect": {"health": -5, "xp": 10}},
        ],
    }],
    "gear_hall": [{
        "id": "runaway_index",
        "title": "Runaway Index Cards",
        "description": "A flock of brass-edged index cards circles a jammed sorting engine.",
        "resolved_description": "The sorter ticks contentedly beside a neat stack of cards.",
        "font_awesome_icon": "fa-solid fa-gears",
        "choices": [
            {"id": "repair_sorter", "label": "Repair the sorter", "result": "The cards file themselves and reveal the archive's corrupted entries.", "effect": {"xp": 9}},
            {"id": "catch_card", "label": "Catch a card", "result": "You seize the master index. Its metal edge strongly objects.", "effect": {"health": -4, "xp": 11}},
        ],
    }],
}


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
                "sprite_url": "/static/assets/worlds/piedone/piedone.png",
                "sprite_token_url": "/static/assets/worlds/piedone/piedone-token.png",
                "objective": {
                    "title": "Break the Tokyo racket",
                    "description": "Follow the street clues and defeat every gang enforcer in your way.",
                },
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
                "sprite_url": "/static/assets/worlds/piedone/street-punk.png",
                "sprite_token_url": "/static/assets/worlds/piedone/street-punk-token.png",
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
                "sprite_url": "/static/assets/worlds/piedone/yakuza-lieutenant.png",
                "sprite_token_url": "/static/assets/worlds/piedone/yakuza-lieutenant-token.png",
            },
        ],
        "celltype_defs": [
            {
                "id": "street",
                "name": "Neon Street",
                "description": "A rain-slick street under buzzing signs.",
                "map_color": "#2F6F7E",
                "font_awesome_icon": "fa-solid fa-road",
                "encounters": PIEDONE_ENCOUNTERS["street"],
            },
            {
                "id": "market",
                "name": "Market Stall",
                "description": "A cramped row of food stalls and shouted bargains.",
                "map_color": "#6F8E3F",
                "font_awesome_icon": "fa-solid fa-store",
                "encounters": PIEDONE_ENCOUNTERS["market"],
            },
            {
                "id": "dock",
                "name": "Harbor Dock",
                "description": "Wooden piers, stacked crates, and dark water.",
                "map_color": "#31547A",
                "font_awesome_icon": "fa-solid fa-anchor",
                "encounters": PIEDONE_ENCOUNTERS["dock"],
            },
            {
                "id": "alley",
                "name": "Back Alley",
                "description": "A narrow shortcut where trouble likes to wait.",
                "map_color": "#4A4A4A",
                "font_awesome_icon": "fa-solid fa-dumpster",
                "encounters": PIEDONE_ENCOUNTERS["alley"],
            },
        ],
        "translations": {
            "en": {
                "theme_desc_better": (
                    "Piedone a Tokyo\n"
                    "A compact dev world for testing reusable worlds, language switching, "
                    "items, and visible enemy encounters without generating new definitions."
                ),
                "player_defs": [
                    {
                        "name": "Piedone",
                        "age": 45,
                        "class": "detective",
                        "height_cm": 190,
                        "weight_kg": 110,
                        "font_awesome_icon": "fa-solid fa-user",
                        "sprite_url": "/static/assets/worlds/piedone/piedone.png",
                        "sprite_token_url": "/static/assets/worlds/piedone/piedone-token.png",
                        "objective": {
                            "title": "Break the Tokyo racket",
                            "description": "Follow the street clues and defeat every gang enforcer in your way.",
                        },
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
                        "sprite_url": "/static/assets/worlds/piedone/street-punk.png",
                        "sprite_token_url": "/static/assets/worlds/piedone/street-punk-token.png",
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
                        "sprite_url": "/static/assets/worlds/piedone/yakuza-lieutenant.png",
                        "sprite_token_url": "/static/assets/worlds/piedone/yakuza-lieutenant-token.png",
                    },
                ],
                "celltype_defs": [
                    {
                        "id": "street",
                        "name": "Neon Street",
                        "description": "A rain-slick street under buzzing signs.",
                        "map_color": "#2F6F7E",
                        "font_awesome_icon": "fa-solid fa-road",
                        "encounters": PIEDONE_ENCOUNTERS["street"],
                    },
                    {
                        "id": "market",
                        "name": "Market Stall",
                        "description": "A cramped row of food stalls and shouted bargains.",
                        "map_color": "#6F8E3F",
                        "font_awesome_icon": "fa-solid fa-store",
                        "encounters": PIEDONE_ENCOUNTERS["market"],
                    },
                    {
                        "id": "dock",
                        "name": "Harbor Dock",
                        "description": "Wooden piers, stacked crates, and dark water.",
                        "map_color": "#31547A",
                        "font_awesome_icon": "fa-solid fa-anchor",
                        "encounters": PIEDONE_ENCOUNTERS["dock"],
                    },
                    {
                        "id": "alley",
                        "name": "Back Alley",
                        "description": "A narrow shortcut where trouble likes to wait.",
                        "map_color": "#4A4A4A",
                        "font_awesome_icon": "fa-solid fa-dumpster",
                        "encounters": PIEDONE_ENCOUNTERS["alley"],
                    },
                ],
            }
        },
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
                "objective": {
                    "title": "Silence the rogue archive",
                    "description": "Defeat every creature corrupting the Clockwork Library.",
                },
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
                "encounters": CLOCKWORK_ENCOUNTERS["reading_room"],
            },
            {
                "id": "stacks",
                "name": "Book Stacks",
                "description": "Tall shelves arranged like a maze.",
                "map_color": "#4D6A50",
                "font_awesome_icon": "fa-solid fa-book",
                "encounters": CLOCKWORK_ENCOUNTERS["stacks"],
            },
            {
                "id": "gear_hall",
                "name": "Gear Hall",
                "description": "A corridor of ticking brass machinery.",
                "map_color": "#7B6F3A",
                "font_awesome_icon": "fa-solid fa-gear",
                "encounters": CLOCKWORK_ENCOUNTERS["gear_hall"],
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
        translation_languages = []
        for language, translation in world.get("translations", {}).items():
            db_manager.save_generator_translation(
                generator_id=world_id,
                language=language,
                theme_desc_better=translation["theme_desc_better"],
                player_defs=translation["player_defs"],
                item_defs=translation["item_defs"],
                enemy_defs=translation["enemy_defs"],
                celltype_defs=translation["celltype_defs"],
                translation_version=WORLD_TRANSLATION_CACHE_VERSION,
            )
            translation_languages.append(language)

        seeded.append({
            "key": world["key"],
            "id": world_id,
            "title": world["theme_desc_better"].splitlines()[0],
            "theme": world["theme_desc"],
            "language": world["language"],
            "cached_translations": translation_languages,
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

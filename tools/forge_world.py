#!/usr/bin/env python3
"""Forge one World and report what the image model actually returned.

Art generation is the first thing in this project that spends real money per
run, and three of its assumptions can only be checked by eye: whether the model
honours the transparent-background request, whether it lays out cleanly
separated frames, and whether the style block holds identity across characters.

`--probe` generates a single character so those can be checked for roughly the
cost of one image before committing to a full bundle.

Usage:
    python tools/forge_world.py --probe "a rain-soaked harbour city"
    python tools/forge_world.py "a rain-soaked harbour city"
"""

import argparse
import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

# The app reads per-role keys; fall back to a plain OPENAI_API_KEY so a one-off
# forge does not require writing a .env file.
_fallback = os.getenv("OPENAI_API_KEY")
if _fallback:
    for name in ("LOW_SPEC_MODEL_API_KEY", "HIGH_SPEC_MODEL_API_KEY", "IMAGE_MODEL_API_KEY"):
        os.environ.setdefault(name, _fallback)

from db import db  # noqa: E402
from gen_ai import (  # noqa: E402
    GenAI,
    GenAIModel,
    DEFAULT_LOW_SPEC_EFFORT,
    DEFAULT_LOW_SPEC_MODEL,
)
from gen_image import (  # noqa: E402
    FRAME_NAMES,
    WorldArtGenerator,
    attach_art_to_definitions,
    build_style_block,
    generate_world_art,
    get_image_model_name,
    get_image_model_quality,
    get_world_assets_dir,
    save_asset,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def describe_frame(name, image):
    alpha = image.convert("RGBA").getchannel("A")
    lo, hi = alpha.getextrema()
    opaque = sum(1 for v in alpha.getdata() if v > 8)
    coverage = opaque / (image.width * image.height)
    return f"    {name:<8} {image.width}x{image.height}  alpha {lo}-{hi}  subject {coverage:.0%}"


async def build_world(theme, language):
    """Generate just the definitions and manifest, without a playable run."""
    model = GenAIModel(
        model_name=os.getenv("LOW_SPEC_MODEL_NAME", DEFAULT_LOW_SPEC_MODEL),
        base_url=os.getenv("LOW_SPEC_MODEL_BASE_URL"),
        api_key=os.getenv("LOW_SPEC_MODEL_API_KEY"),
        reasoning_effort=os.getenv("LOW_SPEC_MODEL_REASONING_EFFORT", DEFAULT_LOW_SPEC_EFFORT),
    )
    gen_ai = GenAI(lo_model=model, hi_model=model)
    gen_ai.language = language

    logger.info("Generating world definitions for: %s", theme)
    gen_ai.theme_desc_better = await gen_ai.set_theme_description(
        theme_desc=theme, theme_desc_better=None, do_web_search=False, language=language
    )
    print(f"\n=== {gen_ai.game_title} ===\n{gen_ai.theme_desc_better}\n")

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def sample(filename, key):
        with open(os.path.join(here, filename), encoding="utf-8") as f:
            return json.dumps(json.load(f)[key])

    players, items, enemies, celltypes = await asyncio.gather(
        gen_ai.gen_players_from_json_sample(sample("game_players.json", "player_defs")),
        gen_ai.gen_game_items_from_json_sample(sample("game_items.json", "item_defs")),
        gen_ai.gen_game_enemies_from_json_sample(sample("game_enemies.json", "enemy_defs")),
        gen_ai.gen_game_celltypes_from_json_sample(sample("game_celltypes.json", "celltype_defs")),
    )

    logger.info("Generating visual manifest")
    manifest = await gen_ai.gen_visual_manifest(players, enemies, celltypes)
    if not manifest:
        raise SystemExit("No usable visual manifest was produced")

    return {
        "gen_ai": gen_ai,
        "manifest": manifest,
        "player_defs": players,
        "item_defs": items,
        "enemy_defs": enemies,
        "celltype_defs": celltypes,
    }


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("theme", help="World theme prompt")
    parser.add_argument("--probe", action="store_true",
                        help="Generate only the first character")
    parser.add_argument("--language", default="en")
    parser.add_argument("--world-id", default="forge-probe")
    parser.add_argument("--out", default=os.path.join("_data", "forge-out"))
    args = parser.parse_args()

    if not os.getenv("IMAGE_MODEL_API_KEY"):
        raise SystemExit("Set OPENAI_API_KEY or IMAGE_MODEL_API_KEY first")

    print(f"Image model: {get_image_model_name()} at {get_image_model_quality()} quality")

    world = await build_world(args.theme, args.language)
    manifest = world["manifest"]

    print("=== visual manifest ===")
    print(f"style: {manifest['style']}")
    print(f"palette: {', '.join(manifest['palette'])}")
    print(f"exclusions: {', '.join(manifest['exclusions'])}")
    for character in manifest["characters"]:
        print(f"  [{character['kind']}] {character['id']}: {character['identity']}")
    print()

    debug_dir = os.path.join(args.out, "raw")
    generator = WorldArtGenerator(debug_dir=debug_dir)

    if args.probe:
        character = manifest["characters"][0]
        print(f"Probing one character: {character['id']}\n")
        result = await generator.generate_character(
            character["identity"], build_style_block(manifest)
        )

        print(f"  background: {'keyed from corners' if result['was_opaque'] else 'transparent from model'}")
        for name in FRAME_NAMES:
            print(describe_frame(name, result["frames"][name]))
            save_asset(result["frames"][name], args.world_id,
                       f"{character['id']}-{name}", args.out)
        save_asset(result["token"], args.world_id, f"{character['id']}-token", args.out)

        print(f"\nRaw sheet: {debug_dir}")
        print(f"Sliced:    {os.path.join(args.out, args.world_id)}")
        return

    # Save first: assets are stored under the World id, and that id is a hash
    # of the definitions, so it has to exist before any art is written.
    world_id = db.save_generator(
        theme_desc=args.theme,
        theme_desc_better=world["gen_ai"].theme_desc_better,
        language=args.language,
        player_defs=world["player_defs"],
        item_defs=world["item_defs"],
        enemy_defs=world["enemy_defs"],
        celltype_defs=world["celltype_defs"],
        visibility="unlisted",
    )
    print(f"Saved World {world_id}")

    print(f"Generating art for {len(manifest['characters'])} characters\n")
    art = await generate_world_art(manifest, world_id, generator, get_world_assets_dir())
    characters = art.get("characters") or {}

    attach_art_to_definitions(art, world["player_defs"], world["enemy_defs"],
                              world["celltype_defs"])
    db.update_generator_definitions(
        generator_id=world_id,
        player_defs=world["player_defs"],
        enemy_defs=world["enemy_defs"],
        celltype_defs=world["celltype_defs"],
    )
    db.save_generator_visual_manifest(
        generator_id=world_id,
        manifest={**manifest, "cover_url": art.get("cover")},
    )

    for character_id, urls in characters.items():
        print(f"  {character_id}: {len(urls)} files")
    print(f"  locations: {len(art.get('locations') or {})} backdrops")
    print(f"  cover: {art.get('cover') or 'not generated'}")
    print(f"\nRaw sheets: {debug_dir}")
    print(f"Assets:     {os.path.join(get_world_assets_dir(), world_id)}")
    print(f"\nPlay it at: /?generator_id={world_id}")


if __name__ == "__main__":
    asyncio.run(main())

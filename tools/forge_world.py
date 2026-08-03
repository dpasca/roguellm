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

from gen_ai import GenAI, GenAIModel  # noqa: E402
from gen_image import (  # noqa: E402
    FRAME_NAMES,
    WorldArtGenerator,
    build_style_block,
    generate_world_art,
    get_image_model_name,
    get_image_model_quality,
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
        model_name=os.getenv("LOW_SPEC_MODEL_NAME", "gpt-4.1-mini"),
        base_url=os.getenv("LOW_SPEC_MODEL_BASE_URL"),
        api_key=os.getenv("LOW_SPEC_MODEL_API_KEY"),
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

    players, enemies, celltypes = await asyncio.gather(
        gen_ai.gen_players_from_json_sample(sample("game_players.json", "player_defs")),
        gen_ai.gen_game_enemies_from_json_sample(sample("game_enemies.json", "enemy_defs")),
        gen_ai.gen_game_celltypes_from_json_sample(sample("game_celltypes.json", "celltype_defs")),
    )

    logger.info("Generating visual manifest")
    manifest = await gen_ai.gen_visual_manifest(players, enemies, celltypes)
    if not manifest:
        raise SystemExit("No usable visual manifest was produced")

    return manifest


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

    manifest = await build_world(args.theme, args.language)

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

    print(f"Generating art for {len(manifest['characters'])} characters\n")
    art = await generate_world_art(manifest, args.world_id, generator, args.out)

    for character_id, urls in art.items():
        print(f"  {character_id}: {len(urls)} files")
    print(f"\nRaw sheets: {debug_dir}")
    print(f"Sliced:     {os.path.join(args.out, args.world_id)}")


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""
Test script to verify pixel art integration in game creation.
"""

import asyncio
import os
import sys
import logging
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger()

# Load environment variables
load_dotenv()

# Import our modules
from gen_ai import GenAI, GenAIModel
from game_definitions import GameDefinitionsManager
from db import db

async def test_game_creation_with_pixel_art():
    """Test complete game creation with pixel art generation."""

    print("=== Game Creation with Pixel Art Integration Test ===")

    # Initialize database
    db.init_db()

    # Check if API keys are available
    low_spec_api_key = os.getenv("LOW_SPEC_MODEL_API_KEY")
    if not low_spec_api_key:
        print("ERROR: LOW_SPEC_MODEL_API_KEY not found in environment!")
        return False

    try:
        # Create AI models
        lo_model = GenAIModel(
            model_name=os.getenv("LOW_SPEC_MODEL_NAME", "gpt-4o-mini"),
            base_url=os.getenv("LOW_SPEC_MODEL_BASE_URL"),
            api_key=low_spec_api_key,
        )
        hi_model = GenAIModel(
            model_name=os.getenv("HIGH_SPEC_MODEL_NAME", "gpt-4o-mini"),
            base_url=os.getenv("HIGH_SPEC_MODEL_BASE_URL"),
            api_key=os.getenv("HIGH_SPEC_MODEL_API_KEY", low_spec_api_key),
        )

        # Create GenAI instance
        gen_ai = GenAI(lo_model=lo_model, hi_model=hi_model)

        # Test theme
        theme = "cyberpunk futuristic neon city"

        print(f"Testing game definitions creation with theme: {theme}")

        # Create game definitions manager
        definitions_manager = GameDefinitionsManager(gen_ai, "en", theme)

        print("Initializing game definitions...")

        # Initialize definitions (minimal test)
        await definitions_manager.initialize_player_defs()
        await definitions_manager.initialize_item_defs()
        await definitions_manager.initialize_enemy_defs()
        await definitions_manager.initialize_celltype_defs()

        print(f"Generated {len(definitions_manager.player_defs)} player definitions")
        print(f"Generated {len(definitions_manager.item_defs)} item definitions")
        print(f"Generated {len(definitions_manager.enemy_defs)} enemy definitions")
        print(f"Generated {len(definitions_manager.celltype_defs)} cell type definitions")

        # Test pixel art enhancement
        print("\nStarting pixel art enhancement...")
        await definitions_manager.enhance_with_pixel_art()

        # Check if pixel art was generated
        pixel_art_count = 0

        for enemy in definitions_manager.enemy_defs:
            if 'pixel_art_data_url' in enemy:
                pixel_art_count += 1
                print(f"✅ Enemy '{enemy['name']}' has pixel art (URL length: {len(enemy['pixel_art_data_url'])})")

        for item in definitions_manager.item_defs:
            if 'pixel_art_data_url' in item:
                pixel_art_count += 1
                print(f"✅ Item '{item['name']}' has pixel art (URL length: {len(item['pixel_art_data_url'])})")

        for celltype in definitions_manager.celltype_defs:
            if 'pixel_art_data_url' in celltype:
                pixel_art_count += 1
                print(f"✅ Cell type '{celltype['name']}' has pixel art (URL length: {len(celltype['pixel_art_data_url'])})")

        for player in definitions_manager.player_defs:
            if 'pixel_art_data_url' in player:
                pixel_art_count += 1
                print(f"✅ Player '{player['name']}' has pixel art (URL length: {len(player['pixel_art_data_url'])})")

        print(f"\nTotal entities with pixel art: {pixel_art_count}")

        total_entities = len(definitions_manager.enemy_defs) + len(definitions_manager.item_defs) + len(definitions_manager.celltype_defs) + len(definitions_manager.player_defs)
        success_rate = (pixel_art_count / total_entities) * 100 if total_entities > 0 else 0

        print(f"Pixel art generation success rate: {success_rate:.1f}% ({pixel_art_count}/{total_entities})")

        if success_rate >= 80:
            print("🎉 Pixel art integration test PASSED!")
            return True
        else:
            print("❌ Pixel art integration test FAILED - success rate too low")
            return False

    except Exception as e:
        print(f"❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Run the integration test."""
    print("Starting Pixel Art Integration Test...\n")

    success = await test_game_creation_with_pixel_art()

    print(f"\n=== Final Result ===")
    if success:
        print("✅ Integration test PASSED")
        return True
    else:
        print("❌ Integration test FAILED")
        return False

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
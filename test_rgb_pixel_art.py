#!/usr/bin/env python3
"""
Test script for RGB-based pixel art generation system.
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
from pixel_art_generator import PixelArtGenerator
from db import db

async def test_rgb_pixel_art_generation():
    """Test RGB-based pixel art generation with various themes and entities."""

    print("=== RGB Pixel Art Generation Test ===")

    # Initialize database
    db.init_db()

    # Check if API keys are available
    low_spec_api_key = os.getenv("LOW_SPEC_MODEL_API_KEY")
    if not low_spec_api_key:
        print("ERROR: LOW_SPEC_MODEL_API_KEY not found in environment!")
        print("Please set up your .env file with API keys.")
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

        # Test different themes
        themes = [
            "cyberpunk futuristic neon city",
            "medieval fantasy kingdom",
            "space exploration adventure",
            "horror zombie apocalypse",
            "steampunk Victorian era"
        ]

        test_cases = [
            ("enemy", "Cyber Assassin", "Deadly assassin with chrome implants and energy weapons"),
            ("item", "Magic Sword", "Enchanted blade that glows with mystical power"),
            ("terrain", "Ancient Library", "Dusty library filled with arcane knowledge"),
            ("player", "Space Marine", "Heavily armored soldier ready for alien combat"),
        ]

        results = []

        for theme in themes:
            print(f"\n=== Testing Theme: {theme} ===")

            # Create pixel art generator for this theme
            pixel_generator = PixelArtGenerator(gen_ai, theme, "en")

            # Test one entity for this theme
            entity_type, entity_name, description = test_cases[0]  # Use first test case

            try:
                print(f"\n--- Generating {entity_type}: {entity_name} ---")

                pixel_data = await pixel_generator.generate_pixel_art(entity_type, entity_name, description)

                if pixel_data:
                    print(f"✅ Successfully generated pixel art for {entity_name}")
                    print(f"   Data length: {len(pixel_data)} characters")

                    # Show first few lines of the result
                    lines = pixel_data.split('\n')
                    print(f"   First 5 lines:")
                    for i in range(min(5, len(lines))):
                        print(f"     {lines[i]}")

                    # Test data URL conversion
                    data_url = pixel_generator.pixel_art_to_data_url(pixel_data, scale=2)
                    print(f"   Data URL length: {len(data_url)} characters")
                    print(f"   Data URL preview: {data_url[:50]}...")

                    results.append((f"{theme}-{entity_name}", True, len(pixel_data)))
                else:
                    print(f"❌ Failed to generate pixel art for {entity_name}")
                    results.append((f"{theme}-{entity_name}", False, 0))

            except Exception as e:
                print(f"❌ Error generating pixel art for {entity_name}: {str(e)}")
                results.append((f"{theme}-{entity_name}", False, 0))

        # Test detailed generation for multiple entities with cyberpunk theme
        print(f"\n=== Detailed Cyberpunk Test ===")
        cyberpunk_generator = PixelArtGenerator(gen_ai, "cyberpunk futuristic", "en")

        for entity_type, entity_name, description in test_cases:
            try:
                print(f"\n--- Generating {entity_type}: {entity_name} ---")

                pixel_data = await cyberpunk_generator.generate_pixel_art(entity_type, entity_name, description)

                if pixel_data:
                    print(f"✅ Generated {entity_name}")

                    # Parse and display color information
                    if 'COLORS:' in pixel_data:
                        color_line = [line for line in pixel_data.split('\n') if line.startswith('COLORS:')][0]
                        colors_part = color_line.replace('COLORS:', '').strip()
                        color_count = len(colors_part.split(','))
                        print(f"   Colors used: {color_count}")
                        print(f"   Color palette: {colors_part[:50]}...")

                    results.append((entity_name, True, len(pixel_data)))
                else:
                    print(f"❌ Failed: {entity_name}")
                    results.append((entity_name, False, 0))

            except Exception as e:
                print(f"❌ Error with {entity_name}: {str(e)}")
                results.append((entity_name, False, 0))

        # Test caching
        print(f"\n=== Testing RGB Pixel Art Caching ===")
        print("Generating the same icon again (should use cache)...")

        entity_type, entity_name, description = test_cases[0]  # Use first test case
        pixel_data_cached = await cyberpunk_generator.generate_pixel_art(entity_type, entity_name, description)

        if pixel_data_cached:
            print(f"✅ Cache test successful for {entity_name}")
        else:
            print(f"❌ Cache test failed for {entity_name}")

        # Summary
        print(f"\n=== Test Summary ===")
        successful = sum(1 for _, success, _ in results if success)
        total = len(results)
        print(f"Successful generations: {successful}/{total}")

        for name, success, length in results:
            status = "✅" if success else "❌"
            print(f"  {status} {name} ({length} chars)")

        return successful >= total * 0.7  # Consider 70% success rate as passing

    except Exception as e:
        print(f"❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Run the RGB pixel art test."""
    print("Starting RGB Pixel Art Generation Test...\n")

    success = await test_rgb_pixel_art_generation()

    print(f"\n=== Final Result ===")
    if success:
        print("✅ RGB Pixel Art test PASSED")
        return True
    else:
        print("❌ RGB Pixel Art test FAILED")
        return False

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
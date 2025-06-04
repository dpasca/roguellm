#!/usr/bin/env python3
"""
Script to test and manage game instance cache for RogueLLM.
This helps with testing by managing cached game instances.
"""

import os
import sys
import argparse

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import db

def clear_cache(generator_id=None):
    """Clear game instance cache."""
    db.clear_game_instance_cache(generator_id)
    if generator_id:
        print(f"✅ Cleared cache for generator: {generator_id}")
    else:
        print("✅ Cleared all cached game instances")

def list_cached_instances():
    """List all cached game instances."""
    with db.get_connection() as conn:
        cursor = conn.execute("""
            SELECT gic.id, gic.generator_id, g.theme_desc, gic.map_width, gic.map_height, gic.created_at
            FROM game_instance_cache gic
            LEFT JOIN generators g ON gic.generator_id = g.id
            ORDER BY gic.created_at DESC
        """)
        rows = cursor.fetchall()

        if not rows:
            print("🔍 No cached game instances found")
            return

        print("📋 Cached Game Instances:")
        print("-" * 80)
        for row in rows:
            cache_id, gen_id, theme, width, height, created = row
            theme_short = (theme[:40] + "...") if theme and len(theme) > 40 else theme
            print(f"Cache ID: {cache_id}")
            print(f"Generator: {gen_id}")
            print(f"Theme: {theme_short}")
            print(f"Map Size: {width}x{height}")
            print(f"Created: {created}")
            print("-" * 80)

def clear_cache_via_api(base_url="http://127.0.0.1:8000", generator_id=None):
    """Clear cache via API endpoint."""
    if not REQUESTS_AVAILABLE:
        print("❌ requests module not available. Install with: pip install requests")
        return

    url = f"{base_url}/api/admin/clear_cache"
    params = {"generator_id": generator_id} if generator_id else {}

    try:
        response = requests.post(url, params=params)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ {data['message']}")
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")
    except requests.RequestException as e:
        print(f"❌ Failed to connect to API: {e}")

def main():
    parser = argparse.ArgumentParser(description="Manage RogueLLM game instance cache")
    parser.add_argument("action", choices=["clear", "list", "clear-api"],
                       help="Action to perform")
    parser.add_argument("--generator-id", "-g", help="Generator ID (for clear action)")
    parser.add_argument("--base-url", "-u", default="http://127.0.0.1:8000",
                       help="Base URL for API calls (default: http://127.0.0.1:8000)")

    args = parser.parse_args()

    if args.action == "clear":
        clear_cache(args.generator_id)
    elif args.action == "list":
        list_cached_instances()
    elif args.action == "clear-api":
        clear_cache_via_api(args.base_url, args.generator_id)

if __name__ == "__main__":
    main()
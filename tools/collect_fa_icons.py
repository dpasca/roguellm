#!/usr/bin/env python3

import requests
import json
import os
from typing import Dict, List, Set

def fetch_fontawesome_metadata() -> Dict:
    """Fetch the latest FontAwesome metadata from the CDN."""
    url = "https://raw.githubusercontent.com/FortAwesome/Font-Awesome/master/metadata/icons.json"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def extract_free_icons(metadata: Dict) -> Dict[str, Set[str]]:
    """Extract all free icons and their styles from the metadata."""
    free_icons = {
        "solid": set(),
        "regular": set(),
        "brands": set()
    }
    
    for icon_name, icon_data in metadata.items():
        # Check each style the icon is available in
        if "styles" in icon_data:
            for style in icon_data["styles"]:
                # Map internal style names to fa- prefix names
                style_map = {
                    "solid": "fa-solid",
                    "regular": "fa-regular",
                    "brands": "fa-brands"
                }
                
                # Only include free styles
                if style in style_map and icon_data.get("free", []):
                    if style in icon_data["free"]:
                        free_icons[style].add(f"{style_map[style]} fa-{icon_name}")

    return free_icons

def save_icons(icons: Dict[str, Set[str]], output_dir: str):
    """Save the collected icons to JSON files."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Save all icons in one file
    all_icons = []
    for style, icon_set in icons.items():
        all_icons.extend(sorted(icon_set))
    
    with open(os.path.join(output_dir, "fontawesome_free_icons.json"), "w") as f:
        json.dump({
            "icons": sorted(all_icons),
            "total_count": len(all_icons)
        }, f, indent=2)
    
    # Save icons separated by style
    for style, icon_set in icons.items():
        filename = f"fontawesome_free_{style}.json"
        with open(os.path.join(output_dir, filename), "w") as f:
            json.dump({
                "style": style,
                "icons": sorted(icon_set),
                "count": len(icon_set)
            }, f, indent=2)

def main():
    print("Fetching FontAwesome metadata...")
    metadata = fetch_fontawesome_metadata()
    
    print("Extracting free icons...")
    free_icons = extract_free_icons(metadata)
    
    # Calculate total icons
    total_icons = sum(len(icons) for icons in free_icons.values())
    print(f"\nFound {total_icons} free icons:")
    for style, icons in free_icons.items():
        print(f"- {style}: {len(icons)} icons")
    
    # Save the results
    output_dir = os.path.join(os.path.dirname(__file__), "fontawesome_data")
    print(f"\nSaving results to {output_dir}...")
    save_icons(free_icons, output_dir)
    print("Done!")

if __name__ == "__main__":
    main()

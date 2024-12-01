#!/usr/bin/env python3

import json
import os
from typing import Set, Optional, Dict, List
import logging

logger = logging.getLogger(__name__)

class FontAwesomeValidator:
    def __init__(self):
        self.free_icons: Set[str] = set()
        self.icons_by_style: Dict[str, Set[str]] = {
            "solid": set(),
            "regular": set(),
            "brands": set()
        }
        self._load_icons()

    def _load_icons(self):
        """Load the free icons from the JSON files."""
        data_dir = os.path.join(os.path.dirname(__file__), "fontawesome_data")
        
        # Load all icons
        all_icons_file = os.path.join(data_dir, "fontawesome_free_icons.json")
        try:
            with open(all_icons_file, 'r') as f:
                data = json.load(f)
                self.free_icons = set(data["icons"])
        except FileNotFoundError:
            logger.error(f"Icons file not found: {all_icons_file}")
            logger.error("Please run collect_fa_icons.py first to generate the icon data.")
            raise
        
        # Load style-specific icons
        for style in self.icons_by_style:
            style_file = os.path.join(data_dir, f"fontawesome_free_{style}.json")
            try:
                with open(style_file, 'r') as f:
                    data = json.load(f)
                    self.icons_by_style[style] = set(data["icons"])
            except FileNotFoundError:
                logger.error(f"Style-specific icons file not found: {style_file}")
                raise

    def is_valid_icon(self, icon: str) -> bool:
        """Check if an icon is in the free set."""
        return icon in self.free_icons

    def get_icon_style(self, icon: str) -> Optional[str]:
        """Get the style of a given icon (solid, regular, or brands)."""
        for style, icons in self.icons_by_style.items():
            if icon in icons:
                return style
        return None

    def validate_json_file(self, file_path: str, icon_field: str = "font_awesome_icon") -> List[Dict]:
        """
        Validate all FontAwesome icons in a JSON file.
        Returns a list of validation errors.
        """
        errors = []
        
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            return [{"error": f"Error reading JSON file: {str(e)}"}]

        def check_object(obj, path=""):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    new_path = f"{path}.{key}" if path else key
                    if key == icon_field and isinstance(value, str):
                        if not self.is_valid_icon(value):
                            errors.append({
                                "path": new_path,
                                "icon": value,
                                "error": "Icon not found in free FontAwesome set"
                            })
                    else:
                        check_object(value, new_path)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    check_object(item, f"{path}[{i}]")

        check_object(data)
        return errors

    def suggest_alternatives(self, icon: str, max_suggestions: int = 5) -> List[str]:
        """
        Suggest alternative free icons when an invalid icon is provided.
        This is helpful for providing alternatives when a Pro icon is attempted to be used.
        """
        # Extract the icon name without the prefix
        if ' fa-' in icon:
            icon_name = icon.split(' fa-')[1]
        else:
            icon_name = icon

        # Find similar icons based on name
        suggestions = []
        for free_icon in self.free_icons:
            if icon_name in free_icon:
                suggestions.append(free_icon)
            if len(suggestions) >= max_suggestions:
                break
        
        return suggestions

def main():
    """CLI interface for quick validation."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Validate FontAwesome icons in JSON files')
    parser.add_argument('file', help='JSON file to validate')
    parser.add_argument('--field', default='font_awesome_icon', 
                      help='Field name containing FontAwesome icons')
    
    args = parser.parse_args()
    
    validator = FontAwesomeValidator()
    errors = validator.validate_json_file(args.file, args.field)
    
    if not errors:
        print(f"✅ All FontAwesome icons in {args.file} are valid!")
        return
    
    print(f"❌ Found {len(errors)} invalid FontAwesome icons:")
    for error in errors:
        print(f"\nPath: {error['path']}")
        print(f"Icon: {error['icon']}")
        print(f"Error: {error['error']}")
        
        # Suggest alternatives
        suggestions = validator.suggest_alternatives(error['icon'])
        if suggestions:
            print("Suggested alternatives:")
            for suggestion in suggestions:
                print(f"  - {suggestion}")

if __name__ == "__main__":
    main()

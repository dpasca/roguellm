#!/usr/bin/env python3

from fa_validator import FontAwesomeValidator
import re

def find_themed_icons(validator: FontAwesomeValidator, theme: str, max_results: int = 10):
    """Find icons that match a specific theme."""
    theme_words = theme.lower().split()
    matches = []
    
    for icon in validator.free_icons:
        # Extract the icon name without the prefix
        icon_name = icon.split(' fa-')[1]
        # Convert to words
        icon_words = re.findall(r'[a-zA-Z]+', icon_name)
        
        # Check if any theme word matches any icon word
        for theme_word in theme_words:
            if any(theme_word in word.lower() for word in icon_words):
                matches.append(icon)
                break
                
        if len(matches) >= max_results:
            break
            
    return matches

def main():
    validator = FontAwesomeValidator()
    
    # Search for desert-themed icons
    print("\nDesert-themed alternatives:")
    desert_icons = find_themed_icons(validator, "desert sun hot dry sand dune")
    for icon in desert_icons:
        print(f"  - {icon}")
        
    # Search for cave-themed icons
    print("\nCave-themed alternatives:")
    cave_icons = find_themed_icons(validator, "cave mountain rock stone hole tunnel")
    for icon in cave_icons:
        print(f"  - {icon}")

if __name__ == "__main__":
    main()

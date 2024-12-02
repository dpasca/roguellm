#!/usr/bin/env python3

import json
import os
from typing import Dict, Optional, Set
import logging

logger = logging.getLogger(__name__)

class FontAwesomeRuntime:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FontAwesomeRuntime, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Load the free icons directly from our collected data
        data_dir = os.path.join(os.path.dirname(__file__), "fontawesome_data")
        try:
            with open(os.path.join(data_dir, "fontawesome_free_icons.json"), 'r') as f:
                data = json.load(f)
                self.free_icons = set(data["icons"])
        except FileNotFoundError:
            logger.error("Free icons data not found. Please run collect_fa_icons.py first.")
            self.free_icons = set()

        self.fallback_icons = {
            "default": "fa-solid fa-question",  # Default fallback
            "desert": "fa-solid fa-sun",
            "forest": "fa-solid fa-tree",
            "mountain": "fa-solid fa-mountain",
            "cave": "fa-solid fa-mountain",
            "water": "fa-solid fa-water",
            "player": "fa-solid fa-user",
            "enemy": "fa-solid fa-skull",
            "item": "fa-solid fa-box",
            "weapon": "fa-solid fa-sword",
            "armor": "fa-solid fa-shield",
            "potion": "fa-solid fa-flask",
        }

        # Validate fallback icons
        for context, icon in list(self.fallback_icons.items()):
            if icon not in self.free_icons:
                logger.warning(f"Fallback icon {icon} for context {context} is not in free set, using default")
                self.fallback_icons[context] = self.fallback_icons["default"]

        self._initialized = True

    def is_valid_icon(self, icon: str) -> bool:
        """Check if an icon is in the free set."""
        return icon in self.free_icons

    def get_valid_icon(self, icon: str, context: str = "default") -> str:
        """
        Get a valid FontAwesome icon, falling back to alternatives if needed.
        
        Args:
            icon: The requested FontAwesome icon
            context: Context hint for better fallback selection (e.g., 'desert', 'enemy', etc.)
            
        Returns:
            A valid FontAwesome icon string
        """
        # If icon is valid, return it
        if self.is_valid_icon(icon):
            return icon

        # Log the invalid icon
        logger.warning(f"Invalid FontAwesome icon detected: {icon} (context: {context})")

        # Try to find a thematic replacement
        if context in self.fallback_icons:
            fallback = self.fallback_icons[context]
            logger.info(f"Using themed fallback for {icon}: {fallback}")
            return fallback

        # Use default fallback
        logger.info(f"Using default fallback for {icon}: {self.fallback_icons['default']}")
        return self.fallback_icons["default"]

    def process_game_data(self, data: Dict, context: str = "default") -> Dict:
        """
        Process game data recursively, replacing any invalid FontAwesome icons.
        
        Args:
            data: The data structure to process
            context: Context hint for better fallback selection (e.g., 'enemy', 'item', etc.)
        """
        def process_value(value, inner_context=context):
            if isinstance(value, dict):
                return {k: process_value(v, inner_context) for k, v in value.items()}
            elif isinstance(value, list):
                return [process_value(item, inner_context) for item in value]
            elif isinstance(value, str) and ("fa-" in value):
                return self.get_valid_icon(value, inner_context)
            return value

        return process_value(data)

# Global instance
fa_runtime = FontAwesomeRuntime()

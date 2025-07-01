import hashlib
import re
from typing import Dict, List, Optional, Tuple
import logging

from gen_ai import GenAI
from db import db

logger = logging.getLogger()

class PixelArtGenerator:
    """Generates and manages 16x16 pixel art icons using LLM with dynamic RGB colors."""

    def __init__(self, gen_ai: GenAI, theme_desc: str, language: str = "en"):
        self.gen_ai = gen_ai
        self.theme_desc = theme_desc.lower()
        self.language = language

    def _create_cache_key(self, entity_type: str, entity_name: str, entity_description: str) -> str:
        """Create a deterministic cache key for pixel art."""
        content = f"PIXEL_RGB|{self.theme_desc}|{entity_type}|{entity_name}|{entity_description}"
        return hashlib.md5(content.encode()).hexdigest()

    def _parse_llm_response(self, response: str) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
        """Parse LLM response to extract colors and pixel grid."""
        try:
            lines = response.strip().split('\n')
            colors = {}
            grid_lines = []

            current_section = None

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Check for section headers
                if line.upper().startswith('COLORS:'):
                    current_section = 'colors'
                    # Parse colors from the same line if present
                    color_part = line[7:].strip()  # Remove "COLORS:"
                    if color_part:
                        self._parse_color_line(color_part, colors)
                    continue
                elif line.upper().startswith('GRID:'):
                    current_section = 'grid'
                    # Parse grid from the same line if present
                    grid_part = line[5:].strip()  # Remove "GRID:"
                    if grid_part and len(grid_part) == 16:
                        grid_lines.append(grid_part.upper())
                    continue

                # Parse content based on current section
                if current_section == 'colors':
                    self._parse_color_line(line, colors)
                elif current_section == 'grid':
                    if len(line) == 16 and all(c in 'ABCDEFGHIJKLMNOP0123456789' for c in line.upper()):
                        grid_lines.append(line.upper())
                else:
                    # If no section header found, try to detect format
                    if '#' in line and '=' in line:
                        self._parse_color_line(line, colors)
                    elif len(line) == 16 and all(c in 'ABCDEFGHIJKLMNOP0123456789' for c in line.upper()):
                        grid_lines.append(line.upper())

            # Validate we have the right amount of data
            if len(grid_lines) != 16:
                logger.warning(f"Expected 16 grid lines, got {len(grid_lines)}")
                return None, None

            if len(colors) < 2:
                logger.warning(f"Expected at least 2 colors, got {len(colors)}")
                return None, None

            grid_data = '\n'.join(grid_lines)
            return colors, grid_data

        except Exception as e:
            logger.error(f"Error parsing LLM response: {str(e)}")
            return None, None

    def _parse_color_line(self, line: str, colors: Dict[str, str]):
        """Parse a line containing color definitions."""
        # Handle multiple formats:
        # #FF0000=A #00FF00=B
        # A=#FF0000 B=#00FF00
        # #FF0000:A #00FF00:B

        # Split by spaces and process each color definition
        parts = line.split()
        for part in parts:
            # Try different separators
            for sep in ['=', ':']:
                if sep in part:
                    left, right = part.split(sep, 1)

                    # Determine which is color and which is letter
                    if left.startswith('#') and len(left) == 7:
                        color, letter = left, right.strip().upper()
                    elif right.startswith('#') and len(right) == 7:
                        letter, color = left.strip().upper(), right
                    else:
                        continue

                    # Validate hex color
                    if re.match(r'^#[0-9A-Fa-f]{6}$', color):
                        colors[letter] = color.upper()
                    break

    def _validate_pixel_art(self, pixel_data: str, colors: Dict[str, str]) -> Tuple[bool, str]:
        """Validate pixel art hex grid format and color mapping."""
        try:
            lines = pixel_data.strip().split('\n')

            # Should have exactly 16 lines
            if len(lines) != 16:
                return False, f"Expected 16 lines, got {len(lines)}"

            # Each line should have exactly 16 characters
            for i, line in enumerate(lines):
                line = line.strip()
                if len(line) != 16:
                    return False, f"Line {i+1} has {len(line)} characters, expected 16"

                # Check if all characters have corresponding colors
                for j, char in enumerate(line):
                    if char not in colors:
                        return False, f"Line {i+1}, position {j+1}: character '{char}' not found in color palette"

            return True, "Valid pixel art"

        except Exception as e:
            return False, f"Validation error: {str(e)}"

    async def _generate_pixel_art_with_llm(self, entity_type: str, entity_name: str, entity_description: str) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
        """Generate pixel art content and colors using LLM."""

        prompt = f"""Create 16x16 pixel art for a {entity_type} in a {self.theme_desc} themed game.

Entity: {entity_name}
Description: {entity_description}

Instructions:
1. First, choose 8-12 colors (hex codes) that fit this entity and theme perfectly
2. Assign each color a letter (A, B, C, D, E, F, G, H, I, J, K, L)
3. Create a 16x16 pixel grid using these letters

IMPORTANT FORMAT:
Start with "COLORS:" followed by your color definitions like: #FF0000=A #00FF00=B #0000FF=C
Then "GRID:" followed by exactly 16 lines of exactly 16 letters each

Requirements:
- Make the icon recognizable and distinctive at small size
- Use colors that actually fit the theme and entity
- Focus on clear silhouettes and simple shapes
- Use darker colors for outlines and lighter for highlights
- Keep the design centered in the 16x16 grid
- Choose colors that work well together

Example response:
COLORS: #000000=A #FF0000=B #FFFF00=C #00FF00=D
GRID:
AAAAAAAAAAAAAAAA
AAABBBBBBBBBBAA
AABBCCCCCCCCBBAA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
ABBCDDDDDDDDCBBA
AABBCCCCCCCCBBAA
AAABBBBBBBBBBAA
AAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAA

Return your response in this exact format."""

        try:
            response = await self.gen_ai._quick_completion(
                system_msg="You are an expert pixel artist specializing in 16x16 game icons. Generate beautiful, themed pixel art with custom color palettes.",
                user_msg=prompt,
                quality="high",  # Use high-spec model for better quality
                temp=0.7
            )

            # Parse the response
            colors, grid_data = self._parse_llm_response(response)

            if colors is None or grid_data is None:
                logger.warning(f"Failed to parse LLM response for {entity_name}")
                return None, None

            return colors, grid_data

        except Exception as e:
            logger.error(f"Error generating pixel art for {entity_name}: {str(e)}")
            return None, None

    async def generate_pixel_art(self, entity_type: str, entity_name: str, entity_description: str = "") -> Optional[str]:
        """Generate or retrieve cached pixel art for an entity."""

        # Create cache key
        cache_key = self._create_cache_key(entity_type, entity_name, entity_description)

        # Check cache first
        cached_result = db.get_pixel_art(cache_key)
        if cached_result:
            logger.info(f"Using cached pixel art for {entity_name}")
            return cached_result

        try:
            # Generate new pixel art
            logger.info(f"Generating new pixel art for {entity_name}")
            colors, grid_data = await self._generate_pixel_art_with_llm(entity_type, entity_name, entity_description)

            if colors is None or grid_data is None:
                return None

            # Validate pixel art
            is_valid, validation_message = self._validate_pixel_art(grid_data, colors)
            if not is_valid:
                logger.warning(f"Generated pixel art for {entity_name} failed validation: {validation_message}")
                return None

            # Store colors and grid together (we'll need colors for data URL conversion)
            pixel_data_with_colors = f"COLORS:{','.join([f'{letter}={color}' for letter, color in colors.items()])}\nGRID:\n{grid_data}"

            # Cache the pixel art
            db.save_pixel_art(cache_key, pixel_data_with_colors, entity_type, entity_name)

            logger.info(f"Successfully generated and cached pixel art for {entity_name}")
            return pixel_data_with_colors

        except Exception as e:
            logger.error(f"Failed to generate pixel art for {entity_name}: {str(e)}")
            return None

    def pixel_art_to_data_url(self, pixel_data_with_colors: str, scale: int = 2) -> str:
        """Convert pixel art with colors to data URL for embedding in HTML."""
        if not pixel_data_with_colors:
            return ""

        try:
            # Parse the stored data
            lines = pixel_data_with_colors.strip().split('\n')
            colors = {}
            grid_lines = []

            # Find colors and grid sections
            in_grid = False
            for line in lines:
                line = line.strip()
                if line.startswith('COLORS:'):
                    # Parse colors
                    color_data = line[7:]  # Remove "COLORS:"
                    color_pairs = color_data.split(',')
                    for pair in color_pairs:
                        if '=' in pair:
                            letter, color = pair.split('=', 1)
                            colors[letter.strip()] = color.strip()
                elif line.startswith('GRID:'):
                    in_grid = True
                elif in_grid and len(line) == 16:
                    grid_lines.append(line)

            if len(grid_lines) != 16:
                logger.warning(f"Invalid grid data: expected 16 lines, got {len(grid_lines)}")
                return ""

            # Create SVG representation
            svg_elements = []

            for y, line in enumerate(grid_lines):
                for x, letter in enumerate(line):
                    if letter in colors:
                        color = colors[letter]
                        # Skip black/transparent pixels (optional)
                        if color.upper() != "#000000":
                            svg_elements.append(f'<rect x="{x*scale}" y="{y*scale}" width="{scale}" height="{scale}" fill="{color}"/>')

            svg_content = f'''<svg viewBox="0 0 {16*scale} {16*scale}" xmlns="http://www.w3.org/2000/svg">
{chr(10).join(svg_elements)}
</svg>'''

            # Convert to data URL
            import base64
            encoded_svg = base64.b64encode(svg_content.encode('utf-8')).decode('utf-8')
            return f"data:image/svg+xml;base64,{encoded_svg}"

        except Exception as e:
            logger.error(f"Error converting pixel art to data URL: {str(e)}")
            return ""
import hashlib
import uuid
import logging
from io import BytesIO
from typing import List, Dict, Optional
from PIL import Image, ImageDraw, ImageFont
from models import TextureAtlas, TextureAtlasCell
from texture_storage_manager import TextureStorageManager
from db import db
import random

logger = logging.getLogger(__name__)


class TextureGenerator:
    def __init__(self, gen_ai=None):
        self.gen_ai = gen_ai  # Optional for placeholder mode
        self.storage_manager = TextureStorageManager()

    def _generate_theme_hash(self, theme_description: str, cell_types: List[Dict]) -> str:
        """Generate hash for theme + cell types combination"""
        data = {
            'theme': theme_description,
            'cell_types': [ct.get('id', ct.get('name', '')) for ct in cell_types]
        }
        data_str = str(sorted(data.items()))
        return hashlib.sha256(data_str.encode()).hexdigest()[:16]

    def _generate_atlas_id(self, generator_id: str, theme_hash: str) -> str:
        """Generate unique atlas ID"""
        return f"atlas_{generator_id}_{theme_hash}"

    def _calculate_uv_coordinates(self, grid_x: int, grid_y: int, grid_size: int) -> tuple:
        """Calculate UV coordinates for a cell in the atlas"""
        cell_width = 1.0 / grid_size
        cell_height = 1.0 / grid_size

        uv_x = grid_x * cell_width
        uv_y = grid_y * cell_height

        return uv_x, uv_y, cell_width, cell_height

    def _get_color_from_string(self, s: str) -> tuple:
        """Generate a deterministic, vibrant color from a string."""
        h = hashlib.sha256(s.encode()).digest()
        # Use different parts of the hash for hue, saturation, and value
        hue = h[0] / 255.0
        saturation = h[1] / 255.0 * 0.5 + 0.5  # Bias towards more saturated colors
        value = h[2] / 255.0 * 0.5 + 0.5      # Bias towards brighter colors

        # Convert HSV to RGB
        c = value * saturation
        x = c * (1 - abs((hue * 6) % 2 - 1))
        m = value - c

        if 0 <= hue < 1/6:
            r, g, b = c, x, 0
        elif 1/6 <= hue < 2/6:
            r, g, b = x, c, 0
        elif 2/6 <= hue < 3/6:
            r, g, b = 0, c, x
        elif 3/6 <= hue < 4/6:
            r, g, b = 0, x, c
        elif 4/6 <= hue < 5/6:
            r, g, b = x, 0, c
        else: # 5/6 <= hue < 1
            r, g, b = c, 0, x

        return int((r + m) * 255), int((g + m) * 255), int((b + m) * 255)

    def generate_placeholder_atlas(
        self,
        cell_types: List[Dict],
        atlas_size: int = 1024,
        grid_size: int = 4
    ) -> bytes:
        """Generate simple color-based atlas using PIL"""
        try:
            # Create new image with a random background color
            bg_color = (random.randint(20, 50), random.randint(20, 50), random.randint(20, 50))
            image = Image.new('RGB', (atlas_size, atlas_size), color=bg_color)
            draw = ImageDraw.Draw(image)

            cell_size = atlas_size // grid_size

            # Fill grid with cell type colors
            for i in range(grid_size * grid_size):
                grid_x = i % grid_size
                grid_y = i // grid_size

                # Use cell type data if available, otherwise create a placeholder name
                if i < len(cell_types):
                    cell_type = cell_types[i]
                    cell_name = cell_type.get('name', f'cell_{i}')
                else:
                    cell_name = f'placeholder_{i}'

                # Generate a vibrant color from the cell name
                color_rgb = self._get_color_from_string(cell_name)

                # Calculate cell position
                x1 = grid_x * cell_size
                y1 = grid_y * cell_size
                x2 = x1 + cell_size
                y2 = y1 + cell_size

                # Draw filled rectangle
                draw.rectangle([x1, y1, x2, y2], fill=color_rgb)

                # Add subtle border
                border_color = tuple(max(0, c - 40) for c in color_rgb)
                draw.rectangle([x1, y1, x2, y2], outline=border_color, width=3)

                logger.debug(f"Drew cell {cell_name} at ({grid_x}, {grid_y}) with color {color_rgb}")

            # Convert to bytes
            buffer = BytesIO()
            image.save(buffer, format='PNG', optimize=True)
            return buffer.getvalue()

        except Exception as e:
            logger.error(f"Failed to generate placeholder atlas: {e}")
            raise

    def generate_enhanced_procedural_atlas(
        self,
        theme_description: str,
        cell_types: List[Dict],
        atlas_size: int = 1024,
        grid_size: int = 4
    ) -> bytes:
        """Generate enhanced procedural textures (gradients, patterns)"""
        # TODO: Implement enhanced procedural generation
        # For now, fall back to placeholder generation
        logger.info("Enhanced procedural generation not yet implemented, using placeholder")
        return self.generate_placeholder_atlas(cell_types, atlas_size, grid_size)

    async def generate_texture_atlas(
        self,
        generator_id: str,
        theme_description: str,
        cell_types: List[Dict],
        atlas_size: int = 1024,
        grid_size: int = 4,
        use_ai: bool = False
    ) -> TextureAtlas:
        """Generate atlas with fallback hierarchy"""
        try:
            # Generate theme hash and atlas ID
            theme_hash = self._generate_theme_hash(theme_description, cell_types)
            atlas_id = self._generate_atlas_id(generator_id, theme_hash)

            # Check if atlas already exists
            existing_atlas = db.find_texture_atlas_by_generator_and_hash(generator_id, theme_hash)
            if existing_atlas and self.storage_manager.atlas_exists(generator_id, atlas_id):
                logger.info(f"Using existing atlas {atlas_id}")
                return TextureAtlas(**existing_atlas)

            # Generate atlas image
            if use_ai and self.gen_ai:
                # TODO: Implement AI generation
                logger.warning("AI generation not yet implemented, using placeholder")
                image_data = self.generate_placeholder_atlas(cell_types, atlas_size, grid_size)
            else:
                logger.info(f"Generating placeholder atlas for {len(cell_types)} cell types")
                image_data = self.generate_placeholder_atlas(cell_types, atlas_size, grid_size)

            # Store atlas image
            local_path = await self.storage_manager.store_atlas(generator_id, atlas_id, image_data)

            # Create UV mapping data
            cells = {}
            for i, cell_type in enumerate(cell_types):
                if i >= grid_size * grid_size:
                    break

                grid_x = i % grid_size
                grid_y = i // grid_size
                uv_x, uv_y, uv_width, uv_height = self._calculate_uv_coordinates(grid_x, grid_y, grid_size)

                cell_key = cell_type.get('id', cell_type.get('name', f'cell_{i}'))
                cells[cell_key] = TextureAtlasCell(
                    cell_type=cell_key,
                    grid_x=grid_x,
                    grid_y=grid_y,
                    uv_x=uv_x,
                    uv_y=uv_y,
                    uv_width=uv_width,
                    uv_height=uv_height
                )

            # Create atlas model
            atlas = TextureAtlas(
                id=atlas_id,
                generator_id=generator_id,
                theme_hash=theme_hash,
                atlas_size=atlas_size,
                grid_size=grid_size,
                local_path=local_path,
                cells=cells
            )

            # Save to database
            db.save_texture_atlas(atlas.dict())

            logger.info(f"Generated texture atlas {atlas_id} with {len(cells)} cells")
            return atlas

        except Exception as e:
            logger.error(f"Failed to generate texture atlas: {e}")
            raise

    async def get_atlas_by_id(self, atlas_id: str) -> Optional[TextureAtlas]:
        """Get atlas by ID from database"""
        atlas_data = db.get_texture_atlas(atlas_id)
        if atlas_data:
            return TextureAtlas(**atlas_data)
        return None

    async def get_atlas_image_data(self, generator_id: str, atlas_id: str) -> Optional[bytes]:
        """Get atlas image data from storage"""
        return await self.storage_manager.retrieve_atlas(generator_id, atlas_id)
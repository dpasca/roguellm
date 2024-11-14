from pathlib import Path
from typing import Dict, List, Tuple
from PIL import Image
import os

# Constants
FAVICON_DIR = Path("static/favicon")
IMAGES_DIR = Path("static/images")

SIZES: Dict[str, List[int]] = {
    "favicon": [16, 32],
    "apple": [60, 76, 120, 152, 180],
    "android": [192, 512]
}

OG_SIZE: Tuple[int, int] = (1200, 630)

def ensure_directories() -> None:
    FAVICON_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

def validate_icon_source(source_path: str) -> None:
    with Image.open(source_path) as img:
        width, height = img.size
        if width != height:
            raise ValueError("Icon source image must be square")
        if width < 512:
            raise ValueError("Icon source image must be at least 512x512 pixels")

def validate_og_source(source_path: str) -> None:
    with Image.open(source_path) as img:
        width, height = img.size
        if width < OG_SIZE[0] or height < OG_SIZE[1]:
            raise ValueError(f"OG image must be at least {OG_SIZE[0]}x{OG_SIZE[1]} pixels")

def generate_icons(icon_source_path: str) -> None:
    ensure_directories()
    validate_icon_source(icon_source_path)

    with Image.open(icon_source_path) as img:
        # Generate favicons
        for size in SIZES["favicon"]:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(FAVICON_DIR / f"favicon-{size}x{size}.png")

        # Generate Apple touch icons
        for size in SIZES["apple"]:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(FAVICON_DIR / f"apple-touch-icon-{size}x{size}.png")

        # Copy largest apple icon as default
        img.resize((180, 180), Image.Resampling.LANCZOS).save(
            FAVICON_DIR / "apple-touch-icon.png"
        )

        # Generate Android icons
        for size in SIZES["android"]:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(FAVICON_DIR / f"android-chrome-{size}x{size}.png")

def generate_og_image(og_source_path: str) -> None:
    ensure_directories()
    validate_og_source(og_source_path)

    with Image.open(og_source_path) as img:
        img.resize(OG_SIZE, Image.Resampling.LANCZOS).save(
            IMAGES_DIR / "og-image.png"
        )

if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage: python generate_icons.py <icon-source> <og-source>")
        sys.exit(1)

    icon_source, og_source = sys.argv[1:3]

    try:
        generate_icons(icon_source)
        generate_og_image(og_source)
        print("Icon generation complete!")
    except Exception as e:
        print(f"Error generating icons: {e}", file=sys.stderr)
        sys.exit(1)
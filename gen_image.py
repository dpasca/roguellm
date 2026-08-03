"""Forge-time image generation for World art.

Art is generated once when a World is built and persisted with it, the same way
the playable snapshot is. Nothing here runs during play.

Two decisions shape this module:

- Character frames come from a single sprite sheet, not one call per frame.
  Identity is then exact rather than approximate, because every frame is
  literally the same generated image, and it costs a third as much.
- The first generated character becomes the style reference for every later
  call in the same World. Without that, each asset reads as a different game.
"""

import base64
import io
import logging
import os
from collections import Counter
from typing import List, Optional, Sequence, Tuple

from openai import AsyncOpenAI
from PIL import Image

from gen_ai_utils import with_exponential_backoff

logger = logging.getLogger()

DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_IMAGE_QUALITY = "medium"

# 1536x1024 gives ~512px per frame across three frames, more than a mobile
# sprite needs. Portraits and backdrops stay square.
SHEET_SIZE = "1536x1024"
PORTRAIT_SIZE = "1024x1024"

FRAME_NAMES: Tuple[str, ...] = ("neutral", "attack", "defeat")

# Flat key colour requested when transparent output is unavailable. Chosen to be
# implausible in character art so the corner fill does not eat the subject.
CHROMA_KEY = (255, 0, 255)
CHROMA_TOLERANCE = 60

TOKEN_SIZE = 256


def _flat_pixels(image: Image.Image) -> list:
    """Pillow 12 renamed getdata(); requirements.txt does not pin a floor, so
    support both spellings until it does."""
    getter = getattr(image, "get_flattened_data", None)
    return list(getter() if callable(getter) else image.getdata())


def is_world_art_enabled() -> bool:
    """Art generation costs real money, so it stays off unless asked for."""
    return os.getenv("ENABLE_WORLD_ART", "0").strip().lower() not in {"0", "false", "no", "off", ""}


def get_image_model_name() -> str:
    return os.getenv("IMAGE_MODEL_NAME") or DEFAULT_IMAGE_MODEL


def get_image_model_quality() -> str:
    return (os.getenv("IMAGE_MODEL_QUALITY") or DEFAULT_IMAGE_QUALITY).strip().lower()


def get_image_model_api_key() -> Optional[str]:
    return os.getenv("IMAGE_MODEL_API_KEY") or os.getenv("LOW_SPEC_MODEL_API_KEY")


def get_image_model_base_url() -> Optional[str]:
    return os.getenv("IMAGE_MODEL_BASE_URL")


def get_world_assets_dir() -> str:
    """Assets live inside the existing data volume, so there is one thing to
    move or snapshot when the app changes hosts."""
    return os.getenv("WORLD_ASSETS_DIR") or os.path.join("_data", "assets")


STYLE_RULES = (
    "Flat 2D game sprite art. Full body, front facing, centred, feet on an "
    "invisible ground line. Even lighting, no cast shadow on the background, "
    "no ground plane, no scenery, no text, no logos, no frame or border, no "
    "drop shadow. Consistent scale across frames."
)


def build_sheet_prompt(
        identity: str,
        style: str,
        frames: Sequence[str] = FRAME_NAMES,
        transparent: bool = True,
) -> str:
    """One prompt producing every frame of one character in a single image.

    The frames are described as a strip so the model keeps one identity across
    them; asking three times would produce three similar-but-different
    characters.
    """
    frame_directions = {
        "neutral": "standing ready, calm",
        "attack": "mid-attack, lunging forward, weapon or fists committed",
        "defeat": "defeated, collapsing, head down",
    }
    described = [
        f"{index + 1}. {frame_directions.get(frame, frame)}"
        for index, frame in enumerate(frames)
    ]

    background = (
        "a fully transparent background"
        if transparent
        else f"a solid flat rgb{CHROMA_KEY} magenta background, the exact same colour everywhere"
    )

    return (
        f"A horizontal sprite sheet of {len(frames)} equal-width frames showing "
        f"the SAME character in the same art style, same colours, same scale, "
        f"evenly spaced with clear separation and no overlap.\n\n"
        f"Character: {identity}\n\n"
        f"Art style: {style}\n{STYLE_RULES}\n\n"
        f"Frames, left to right:\n" + "\n".join(described) + "\n\n"
        f"Render on {background}."
    )


def build_portrait_prompt(identity: str, style: str, transparent: bool = True) -> str:
    """Single-pose prompt for assets that do not need frames."""
    background = (
        "a fully transparent background"
        if transparent
        else f"a solid flat rgb{CHROMA_KEY} magenta background, the exact same colour everywhere"
    )
    return (
        f"Subject: {identity}\n\n"
        f"Art style: {style}\n{STYLE_RULES}\n\n"
        f"Render on {background}."
    )


def slice_sprite_sheet(sheet: Image.Image, frame_count: int = len(FRAME_NAMES)) -> List[Image.Image]:
    """Cut a sheet into equal-width frames.

    Frames are trimmed to their own content afterwards, so small drift in where
    the model actually placed each pose does not matter.
    """
    if frame_count < 1:
        raise ValueError("frame_count must be at least 1")

    width, height = sheet.size
    frame_width = width // frame_count

    frames = []
    for index in range(frame_count):
        left = index * frame_width
        # The last frame takes any remainder so no column is dropped.
        right = width if index == frame_count - 1 else left + frame_width
        frames.append(sheet.crop((left, 0, right, height)))

    return frames


def remove_flat_background(
        image: Image.Image,
        tolerance: int = CHROMA_TOLERANCE,
) -> Image.Image:
    """Make a flat background transparent by filling inward from the corners.

    Connectivity matters: a plain colour match would punch holes anywhere the
    subject happens to use the key colour. Only background reachable from an
    edge is removed.
    """
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = _flat_pixels(rgba)

    corners = [0, width - 1, (height - 1) * width, width * height - 1]
    corner_colors = [pixels[index][:3] for index in corners]
    key = Counter(corner_colors).most_common(1)[0][0]

    threshold = tolerance * tolerance

    def matches(index: int) -> bool:
        r, g, b = pixels[index][:3]
        dr, dg, db = r - key[0], g - key[1], b - key[2]
        return dr * dr + dg * dg + db * db <= threshold

    is_background = bytearray(width * height)
    stack = [index for index in corners if matches(index)]
    for index in stack:
        is_background[index] = 1

    while stack:
        index = stack.pop()
        x = index % width
        y = index // width

        neighbours = []
        if x > 0:
            neighbours.append(index - 1)
        if x < width - 1:
            neighbours.append(index + 1)
        if y > 0:
            neighbours.append(index - width)
        if y < height - 1:
            neighbours.append(index + width)

        for neighbour in neighbours:
            if not is_background[neighbour] and matches(neighbour):
                is_background[neighbour] = 1
                stack.append(neighbour)

    cleared = [
        (pixel[0], pixel[1], pixel[2], 0) if is_background[index] else pixel
        for index, pixel in enumerate(pixels)
    ]
    result = Image.new("RGBA", rgba.size)
    result.putdata(cleared)
    return result


def trim_to_content(image: Image.Image, padding: int = 8) -> Image.Image:
    """Crop to the visible subject, keeping a little breathing room."""
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        return rgba

    left, top, right, bottom = bbox
    width, height = rgba.size
    return rgba.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    ))


def make_token(image: Image.Image, size: int = TOKEN_SIZE) -> Image.Image:
    """Derive the square map token from the same art as the combat sprite.

    Deriving rather than generating keeps the token and the sprite the same
    character, which a second generation could not guarantee.
    """
    trimmed = trim_to_content(image, padding=0)
    trimmed.thumbnail((size, size), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(
        trimmed,
        ((size - trimmed.width) // 2, (size - trimmed.height) // 2),
        trimmed,
    )
    return canvas


def has_visible_content(image: Image.Image, min_ratio: float = 0.02) -> bool:
    """Reject frames that came back empty or fully keyed out."""
    alpha = image.convert("RGBA").getchannel("A")
    visible = sum(1 for value in _flat_pixels(alpha) if value > 8)
    return visible >= min_ratio * (image.width * image.height)


class WorldArtGenerator:
    """Generates one World's art bundle, holding the style reference between calls."""

    def __init__(
            self,
            model_name: Optional[str] = None,
            quality: Optional[str] = None,
            api_key: Optional[str] = None,
            base_url: Optional[str] = None,
    ):
        self.model_name = model_name or get_image_model_name()
        self.quality = quality or get_image_model_quality()
        self.api_key = api_key or get_image_model_api_key()
        self.base_url = base_url or get_image_model_base_url()

        if not self.api_key:
            raise ValueError(
                "Image generation requires IMAGE_MODEL_API_KEY or LOW_SPEC_MODEL_API_KEY."
            )

        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

        # Set from the first generated asset and reused to hold the style.
        self.style_reference: Optional[bytes] = None

    async def _generate(self, prompt: str, size: str) -> Image.Image:
        async def call():
            return await self.client.images.generate(
                model=self.model_name,
                prompt=prompt,
                size=size,
                quality=self.quality,
                background="transparent",
                output_format="png",
            )

        response = await with_exponential_backoff(call)
        payload = response.data[0].b64_json
        if not payload:
            raise ValueError("Image response contained no image data")

        return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGBA")

    async def generate_character(
            self,
            identity: str,
            style: str,
            frame_names: Sequence[str] = FRAME_NAMES,
    ) -> dict:
        """Generate one character's frames plus its map token.

        Falls back to the neutral pose for any frame that comes back empty, so a
        partial sheet still yields a usable character.
        """
        prompt = build_sheet_prompt(identity, style, frame_names)
        sheet = await self._generate(prompt, SHEET_SIZE)

        # Transparent output is requested but not guaranteed; if the model
        # returned an opaque image, key it out from the corners instead.
        if sheet.getchannel("A").getextrema()[0] == 255:
            sheet = remove_flat_background(sheet)

        frames = {}
        for name, frame in zip(frame_names, slice_sprite_sheet(sheet, len(frame_names))):
            trimmed = trim_to_content(frame)
            if has_visible_content(trimmed):
                frames[name] = trimmed
            else:
                logger.warning("Sprite frame '%s' came back empty for %s", name, identity)

        if not frames:
            raise ValueError(f"No usable frames generated for {identity}")

        neutral = frames.get("neutral") or next(iter(frames.values()))
        for name in frame_names:
            frames.setdefault(name, neutral)

        return {"frames": frames, "token": make_token(neutral)}


def save_asset(image: Image.Image, world_id: str, name: str, assets_dir: Optional[str] = None) -> str:
    """Write one asset and return the URL the world definition should carry."""
    base_dir = assets_dir or get_world_assets_dir()
    world_dir = os.path.join(base_dir, world_id)
    os.makedirs(world_dir, exist_ok=True)

    filename = f"{name}.png"
    image.save(os.path.join(world_dir, filename), format="PNG", optimize=True)
    return f"/assets/worlds/{world_id}/{filename}"

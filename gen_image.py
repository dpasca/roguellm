"""Forge-time image generation for World art.

Art is generated once when a World is built and persisted with it, the same way
the playable snapshot is. Nothing here runs during play.

Two decisions shape this module:

- Character frames come from a single sprite sheet, not one call per frame.
  Identity is then exact rather than approximate, because every frame is
  literally the same generated image, and it costs a third as much.
- Every prompt repeats the same manifest verbatim. Each image is a separate
  call with no memory of the others, so identical wording is what makes them
  read as one game.
"""

import asyncio
import base64
import io
import logging
import os
import re
from collections import Counter
from typing import Any, List, Optional, Sequence, Tuple

from openai import AsyncOpenAI, BadRequestError
from PIL import Image, ImageDraw, ImageFilter

from gen_ai_utils import with_exponential_backoff

logger = logging.getLogger()

DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_IMAGE_QUALITY = "medium"
WORLD_ASSET_EXTENSION = ".webp"
WORLD_ASSET_FORMAT = "WEBP"
WORLD_ASSET_WEBP_QUALITY = 85
WORLD_ASSET_WEBP_METHOD = 6

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

# 16:9 so the same asset works as a gallery card and a social preview.
COVER_SIZE = (1200, 675)

# Characters draw concurrently. Style cohesion comes from repeating the manifest
# text in every prompt, not from ordering, so serialising them bought nothing
# and cost minutes: a World with 11 characters took over nine of them.
ART_CONCURRENCY = 4
BACKDROP_SIZE = "1536x1024"


def _despill_pixel(pixel: tuple, key: tuple) -> tuple:
    """Pull key-colour contamination out of one outline pixel.

    A magenta key bleeds into edges as pixels whose red and blue both sit well
    above green. The excess over green is the spill, so removing it neutralises
    the cast while leaving genuinely red or blue art alone: those have only one
    channel elevated, not both.
    """
    r, g, b, a = pixel

    # Only the two channels the key is strong in can carry its spill.
    high = [index for index, value in enumerate(key[:3]) if value >= 128]
    if len(high) != 2:
        return pixel

    low = next(index for index in range(3) if index not in high)
    channels = [r, g, b]
    floor = channels[low]

    excess = min(channels[high[0]] - floor, channels[high[1]] - floor)
    if excess <= 0:
        return pixel

    for index in high:
        channels[index] = max(floor, channels[index] - excess)

    return (channels[0], channels[1], channels[2], a)


def _is_background_unsupported(exc: BadRequestError) -> bool:
    """Tell 'this model has no transparent output' apart from other 400s."""
    body = getattr(exc, "body", None)
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict) and error.get("param") == "background":
        return True
    return "transparent background is not supported" in str(exc).lower()


def normalize_visual_manifest(manifest: dict, world: dict) -> Optional[dict]:
    """Validate a generated manifest against the World it must describe.

    The model can hallucinate ids, drop entries, or return the wrong shape. Ids
    are the join key between the manifest and the world definition, so entries
    whose ids do not exist are dropped rather than trusted, and entries the
    model forgot fall back to their own name and description. Returns None when
    there is nothing usable, so the caller skips art instead of generating a
    mess.
    """
    if not isinstance(manifest, dict):
        return None

    style = str(manifest.get("style") or "").strip()
    if not style:
        return None

    palette = [
        str(color).strip()
        for color in (manifest.get("palette") or [])
        if str(color).strip()
    ]
    exclusions = [
        str(item).strip()
        for item in (manifest.get("exclusions") or [])
        if str(item).strip()
    ]

    def index_by_id(entries):
        return {
            str(entry.get("id")): entry
            for entry in (entries or [])
            if isinstance(entry, dict) and entry.get("id")
        }

    def fallback_identity(source: dict) -> str:
        parts = [source.get("name"), source.get("description")]
        return ". ".join(str(part).strip() for part in parts if part) or str(source.get("id"))

    generated_characters = index_by_id(manifest.get("characters"))
    generated_locations = index_by_id(manifest.get("locations"))

    characters = []
    for kind, sources in (("player", world.get("player")), ("enemy", world.get("enemies"))):
        for source in sources or []:
            source_id = str(source.get("id"))
            generated = generated_characters.get(source_id)
            identity = str((generated or {}).get("identity") or "").strip()
            if not identity:
                logger.warning("Visual manifest missing character '%s'; using its own text", source_id)
                identity = fallback_identity(source)
            characters.append({"id": source_id, "kind": kind, "identity": identity})

    locations = []
    for source in world.get("terrain") or []:
        source_id = str(source.get("id"))
        generated = generated_locations.get(source_id)
        identity = str((generated or {}).get("identity") or "").strip()
        if not identity:
            logger.warning("Visual manifest missing location '%s'; using its own text", source_id)
            identity = fallback_identity(source)
        locations.append({"id": source_id, "identity": identity})

    invented = (set(generated_characters) | set(generated_locations)) - (
        {c["id"] for c in characters} | {location["id"] for location in locations}
    )
    if invented:
        logger.warning("Visual manifest invented unknown ids, dropped: %s", sorted(invented))

    if not characters and not locations:
        return None

    return {
        "style": style,
        "palette": palette,
        "characters": characters,
        "locations": locations,
        "exclusions": exclusions,
    }


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


def build_style_block(manifest: dict) -> str:
    """The shared art direction, repeated verbatim in every prompt.

    Repetition is the point: each image is a separate call with no memory of the
    others, so identical wording is what makes them belong together.
    """
    parts = [str(manifest.get("style") or "").strip()]

    palette = manifest.get("palette") or []
    if palette:
        parts.append(f"Use only this colour palette: {', '.join(palette)}.")

    exclusions = manifest.get("exclusions") or []
    if exclusions:
        parts.append(f"Never include: {', '.join(exclusions)}.")

    return "\n".join(part for part in parts if part)


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
        else (
            f"a solid flat rgb{CHROMA_KEY} magenta background, the exact same "
            f"colour everywhere. This magenta is a chroma key and is removed "
            f"afterwards, so it must not appear anywhere on the subject itself"
        )
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


BACKDROP_RULES = (
    "Wide establishing shot of an empty place. No people, no creatures, no "
    "characters, no figures of any kind. No text, no logos, no UI, no frame or "
    "border. Nothing in sharp focus in the lower centre foreground, which is "
    "left open and uncluttered."
)


def build_backdrop_prompt(identity: str, style: str) -> str:
    """A location with nothing in it, for characters to be composited onto.

    The lower centre is kept deliberately empty because that is where the hero
    sprite lands on a cover; anything detailed there fights the subject.
    """
    return (
        f"Location: {identity}\n\n"
        f"Art style: {style}\n{BACKDROP_RULES}"
    )


def build_portrait_prompt(identity: str, style: str, transparent: bool = True) -> str:
    """Single-pose prompt for assets that do not need frames."""
    background = (
        "a fully transparent background"
        if transparent
        else (
            f"a solid flat rgb{CHROMA_KEY} magenta background, the exact same "
            f"colour everywhere. This magenta is a chroma key and is removed "
            f"afterwards, so it must not appear anywhere on the subject itself"
        )
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
        despill: bool = True,
) -> Image.Image:
    """Make the key colour transparent everywhere, then de-spill the outline.

    This deliberately does not care about connectivity. An earlier version
    flooded inward from the corners so that subject pixels sharing the key
    colour would survive, but that protection cost more than it was worth:
    it stranded background in every gap enclosed by the subject, and the
    prompt already tells the model to keep the key colour off the character.
    A plain colour match catches every spot and is far faster.

    De-spill is still restricted to pixels touching transparency, so interior
    art keeps its intended colours. It is needed because the model returns
    hard-edged art with no alpha, which leaves key colour bleeding into
    outlines as fully opaque tinted pixels that no alpha threshold can catch.
    """
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = _flat_pixels(rgba)

    corners = [0, width - 1, (height - 1) * width, width * height - 1]
    key = Counter(pixels[index][:3] for index in corners).most_common(1)[0][0]

    threshold = tolerance * tolerance
    is_background = bytearray(width * height)
    cleared = []
    for index, pixel in enumerate(pixels):
        dr, dg, db = pixel[0] - key[0], pixel[1] - key[1], pixel[2] - key[2]
        if dr * dr + dg * dg + db * db <= threshold:
            is_background[index] = 1
            cleared.append((pixel[0], pixel[1], pixel[2], 0))
        else:
            cleared.append(pixel)

    if despill:
        for index in range(width * height):
            if is_background[index]:
                continue

            x = index % width
            y = index // width
            touches_background = (
                (x > 0 and is_background[index - 1])
                or (x < width - 1 and is_background[index + 1])
                or (y > 0 and is_background[index - width])
                or (y < height - 1 and is_background[index + width])
            )
            if touches_background:
                cleared[index] = _despill_pixel(cleared[index], key)

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
            debug_dir: Optional[str] = None,
    ):
        self.model_name = model_name or get_image_model_name()
        self.quality = quality or get_image_model_quality()
        self.api_key = api_key or get_image_model_api_key()
        self.base_url = base_url or get_image_model_base_url()
        # When set, the untouched model output is written here before slicing
        # or keying, so a bad bundle can be diagnosed without paying again.
        self.debug_dir = debug_dir

        if not self.api_key:
            raise ValueError(
                "Image generation requires IMAGE_MODEL_API_KEY or LOW_SPEC_MODEL_API_KEY."
            )

        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

        # Latches to False the first time the model rejects transparent output.
        self.supports_transparent = True

    async def _generate(self, prompt: str, size: str, transparent: bool) -> Image.Image:
        async def call():
            kwargs = {
                "model": self.model_name,
                "prompt": prompt,
                "size": size,
                "quality": self.quality,
                "output_format": "png",
            }
            if transparent:
                kwargs["background"] = "transparent"
            return await self.client.images.generate(**kwargs)

        response = await with_exponential_backoff(call)
        payload = response.data[0].b64_json
        if not payload:
            raise ValueError("Image response contained no image data")

        return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGBA")

    async def _generate_with_background_fallback(self, build_prompt, size: str) -> Image.Image:
        """Ask for transparent output, falling back to a keyed background.

        gpt-image-2 rejects `background="transparent"` outright, so the chroma
        path is not a nicety for it, it is the only path. The prompt has to
        change with the parameter, hence the builder. Rejections happen before
        generation and are not billed, and the flag latches so the wasted
        attempt happens at most once per World.
        """
        if self.supports_transparent:
            try:
                return await self._generate(build_prompt(True), size, True)
            except BadRequestError as exc:
                if not _is_background_unsupported(exc):
                    raise
                logger.info(
                    "Model %s does not support transparent output; keying instead",
                    self.model_name,
                )
                self.supports_transparent = False

        return await self._generate(build_prompt(False), size, False)

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
        sheet = await self._generate_with_background_fallback(
            lambda transparent: build_sheet_prompt(
                identity, style, frame_names, transparent=transparent
            ),
            SHEET_SIZE,
        )

        if self.debug_dir:
            os.makedirs(self.debug_dir, exist_ok=True)
            slug = "".join(c if c.isalnum() else "-" for c in identity)[:40]
            sheet.save(os.path.join(self.debug_dir, f"raw-{slug}.png"))

        # Transparent output is requested but not guaranteed; if the model
        # returned an opaque image, key it out from the corners instead.
        was_opaque = sheet.getchannel("A").getextrema()[0] == 255
        if was_opaque:
            logger.info("Model returned an opaque sheet; keying background from corners")
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

        return {
            "frames": frames,
            "token": make_token(neutral),
            "was_opaque": was_opaque,
        }

    async def generate_backdrop(self, identity: str, style: str) -> Image.Image:
        """Generate one empty location, kept opaque since it is a background."""
        return await self._generate(
            build_backdrop_prompt(identity, style), BACKDROP_SIZE, transparent=False
        )


async def generate_world_art(
        manifest: dict,
        world_id: str,
        generator: Optional["WorldArtGenerator"] = None,
        assets_dir: Optional[str] = None,
        on_progress=None,
) -> dict:
    """Generate and persist a World's character art, returning URLs by id.

    Characters draw concurrently, bounded by ART_CONCURRENCY. What holds a
    World together is every prompt repeating the same manifest text, not the
    order they run in, so there is nothing to gain by serialising them.

    A character that fails is skipped, not fatal. The renderer already falls
    back to Font Awesome icons per entity, so a partial bundle degrades to a
    mixed World rather than a broken one.

    Returns {"characters": {id: {frame: url}}, "cover": url or None}.
    """
    if not manifest:
        return {"characters": {}, "cover": None}

    generator = generator or WorldArtGenerator()
    style = build_style_block(manifest)

    async def report(**fields):
        if on_progress:
            try:
                await on_progress(fields)
            except Exception as exc:
                logger.debug("Art progress callback failed: %s", exc)

    characters = manifest.get("characters") or []
    total = len(characters)
    art = {}
    neutral_frames = {}
    completed = 0
    limit = asyncio.Semaphore(ART_CONCURRENCY)

    async def draw(character):
        nonlocal completed
        character_id = character["id"]

        async with limit:
            try:
                result = await generator.generate_character(character["identity"], style)
            except Exception as exc:
                logger.error("Art generation failed for '%s': %s", character_id, exc)
                completed += 1
                await report(stage="art_failed", character_id=character_id,
                             index=completed, total=total)
                return

        frames = result["frames"]
        urls = {
            name: save_asset(frame, world_id, f"{character_id}-{name}", assets_dir)
            for name, frame in frames.items()
        }
        urls["token"] = save_asset(result["token"], world_id, f"{character_id}-token", assets_dir)
        art[character_id] = urls
        neutral_frames[character_id] = frames.get("neutral")

        # Emitted per character rather than at the end, so the reveal fills in
        # as the World is drawn instead of arriving all at once. The client
        # matches on character_id, so completion order does not matter.
        completed += 1
        await report(
            stage="art",
            character_id=character_id,
            kind=character.get("kind"),
            sprite_url=urls.get("neutral"),
            token_url=urls.get("token"),
            index=completed,
            total=total,
        )

    await asyncio.gather(*(draw(character) for character in characters))

    locations, location_backdrops = await _generate_backdrops(
        manifest, world_id, generator, style, assets_dir, report
    )

    cover_url = await _generate_cover(
        manifest, neutral_frames, world_id, location_backdrops, assets_dir
    )
    if cover_url:
        await report(stage="cover", cover_url=cover_url)

    return {"characters": art, "locations": locations, "cover": cover_url}


async def _generate_backdrops(
        manifest: dict,
        world_id: str,
        generator: "WorldArtGenerator",
        style: str,
        assets_dir: Optional[str],
        report,
) -> Tuple[dict, dict]:
    """Draw every location, so exploration can show where you are.

    Concurrent for the same reason characters are: cohesion comes from the
    shared manifest text, not from ordering. A location that fails is skipped,
    and the game falls back to that terrain's colour and icon.
    """
    locations = manifest.get("locations") or []
    if not locations:
        return {}, {}

    results = {}
    backdrops = {}
    limit = asyncio.Semaphore(ART_CONCURRENCY)
    done = 0

    async def draw(location):
        nonlocal done
        location_id = location["id"]
        async with limit:
            try:
                backdrop = await generator.generate_backdrop(location["identity"], style)
            except Exception as exc:
                logger.error("Backdrop failed for '%s': %s", location_id, exc)
                done += 1
                return

        results[location_id] = save_asset(
            backdrop, world_id, f"location-{location_id}", assets_dir
        )
        backdrops[location_id] = backdrop
        done += 1
        await report(
            stage="location",
            location_id=location_id,
            backdrop_url=results[location_id],
            index=done,
            total=len(locations),
        )

    await asyncio.gather(*(draw(location) for location in locations))
    return results, backdrops


async def _generate_cover(
        manifest: dict,
        neutral_frames: dict,
        world_id: str,
        location_backdrops: dict,
        assets_dir: Optional[str],
) -> Optional[str]:
    """Compose the gallery card from the sprites, over a location backdrop.

    The card is composited rather than generated whole so it can never show a
    hero the game does not contain. It reuses a backdrop the game already needs
    rather than generating one only the card would ever see, and falls back to a
    palette gradient if none were produced.
    """
    hero = neutral_frames.get("player") or next(
        (frame for frame in neutral_frames.values() if frame is not None), None
    )
    if hero is None:
        return None

    first_location = next(
        (location["id"] for location in (manifest.get("locations") or [])
         if location["id"] in location_backdrops),
        None,
    )
    backdrop = location_backdrops.get(first_location)

    supporting = [
        frame for character_id, frame in neutral_frames.items()
        if character_id != "player" and frame is not None
    ][:2]

    try:
        cover = compose_world_cover(hero, manifest, supporting, backdrop=backdrop)
        return save_asset(cover, world_id, "cover", assets_dir)
    except Exception as exc:
        logger.error("Cover composition failed for %s: %s", world_id, exc)
        return None


def attach_art_to_definitions(
        art: dict,
        player_defs: Optional[List[dict]] = None,
        enemy_defs: Optional[List[dict]] = None,
        celltype_defs: Optional[Any] = None,
) -> None:
    """Write art URLs onto the existing definitions, in place.

    Uses the `sprite_url` / `sprite_token_url` contract the renderer already
    consumes, so no frontend change is needed for art to appear. Extra frames
    ride along as `sprite_frames` for renderers that want them, and cell types
    gain `backdrop_url` for the location a player is standing in.

    Accepts either the character map or the full art dict, since callers
    holding one or the other is otherwise an easy thing to get wrong.
    """
    if "characters" in art or "locations" in art:
        locations = art.get("locations") or {}
        art = art.get("characters") or {}
    else:
        locations = {}
    def apply(entity: dict, urls: dict) -> None:
        neutral = urls.get("neutral")
        if neutral:
            entity["sprite_url"] = neutral
        if urls.get("token"):
            entity["sprite_token_url"] = urls["token"]
        frames = {
            name: url
            for name, url in urls.items()
            if name in FRAME_NAMES
        }
        if frames:
            entity["sprite_frames"] = frames

    for player in (player_defs or [])[:1]:
        if isinstance(player, dict) and "player" in art:
            apply(player, art["player"])

    for enemy in enemy_defs or []:
        if not isinstance(enemy, dict):
            continue
        urls = art.get(str(enemy.get("enemy_id")))
        if urls:
            apply(enemy, urls)

    # celltype_defs is a list in some worlds and a dict in others, so normalise
    # before walking it.
    cells = celltype_defs.values() if isinstance(celltype_defs, dict) else (celltype_defs or [])
    for cell in cells:
        if not isinstance(cell, dict):
            continue
        backdrop = locations.get(str(cell.get("id")))
        if backdrop:
            cell["backdrop_url"] = backdrop


def parse_hex_colour(value: str) -> Optional[Tuple[int, int, int]]:
    """Read one manifest palette entry, tolerating the shapes models emit."""
    if not isinstance(value, str):
        return None

    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    if len(text) != 6:
        return None

    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _relative_luminance(colour: Tuple[int, int, int]) -> float:
    r, g, b = colour
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cover_palette(manifest: Optional[dict], fallback: Optional[Image.Image] = None) -> List[tuple]:
    """Pick the two backdrop colours for a cover, darkest first.

    Prefers the manifest palette, which is what every sprite in the World was
    drawn against. Falls back to the hero's own colours so a World forged before
    manifests were persisted still gets a card that matches its art.
    """
    colours = [
        parsed for parsed in
        (parse_hex_colour(entry) for entry in ((manifest or {}).get("palette") or []))
        if parsed
    ]

    if len(colours) < 2 and fallback is not None:
        rgb = fallback.convert("RGBA")
        sampled = [
            pixel[:3] for pixel in _flat_pixels(rgb)[::7]
            if pixel[3] > 200
        ]
        if sampled:
            sampled.sort(key=_relative_luminance)
            colours = [sampled[len(sampled) // 6], sampled[len(sampled) // 2]]

    if len(colours) < 2:
        return [(16, 18, 26), (38, 42, 58)]

    colours.sort(key=_relative_luminance)
    # The two darkest only. A manifest palette carries accent colours as well as
    # backdrop ones, and picking by median grabs the accent: a noir harbour
    # palette has a signal red in it, which turns the card into a sunset.
    return [colours[0], colours[1]]


def _fit_backdrop(backdrop: Image.Image, size: Tuple[int, int]) -> Image.Image:
    """Cover the card without distorting the generated art."""
    width, height = size
    scale = max(width / backdrop.width, height / backdrop.height)
    resized = backdrop.convert("RGBA").resize(
        (max(1, int(backdrop.width * scale)), max(1, int(backdrop.height * scale))),
        Image.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def compose_world_cover(
        hero: Image.Image,
        manifest: Optional[dict] = None,
        supporting: Optional[Sequence[Image.Image]] = None,
        size: Tuple[int, int] = COVER_SIZE,
        backdrop: Optional[Image.Image] = None,
) -> Image.Image:
    """Build a World's gallery card from art that already exists.

    Compositing the real sprites means the card cannot drift from the game it
    advertises, which a separately generated piece of key art would. Supporting
    characters sit behind and dimmed so it reads as a cast rather than a
    character-select line-up.

    With a backdrop it is a scene; without one it falls back to a palette
    gradient, so a World whose backdrop generation failed still gets a card.
    """
    width, height = size
    dark, mid = cover_palette(manifest, fallback=hero)

    if backdrop is not None:
        canvas = _fit_backdrop(backdrop, size)
        # Sink the backdrop so the sprites, which are lit flat, still read
        # against it. Generated scenes come back far busier than a gradient.
        canvas = Image.blend(
            canvas.convert("RGB"),
            Image.new("RGB", size, dark),
            0.35,
        ).convert("RGBA")
    else:
        # Vertical gradient, dark at the top so the subject reads against it.
        canvas = Image.new("RGB", (1, height))
        for y in range(height):
            t = y / max(height - 1, 1)
            canvas.putpixel((0, y), tuple(
                int(dark[i] + (mid[i] - dark[i]) * t) for i in range(3)
            ))
        canvas = canvas.resize(size, Image.BILINEAR).convert("RGBA")

    # Ground glow, so the figures are standing on something.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (int(width * 0.10), int(height * 0.72), int(width * 0.90), int(height * 1.08)),
        fill=(*mid, 90),
    )
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(width // 24)))

    def place(sprite, target_height, centre_x, baseline, shade=0.0, opacity=255):
        art = trim_to_content(sprite, padding=0)
        if art.height < 1:
            return

        scale = target_height / art.height
        art = art.resize((max(1, int(art.width * scale)), target_height), Image.LANCZOS)

        if shade or opacity < 255:
            # Blend RGB toward the backdrop while carrying alpha across
            # untouched. Blending RGBA directly would drag the transparent
            # regions toward opaque and box the sprite in.
            alpha = art.getchannel("A")
            solid = Image.new("RGB", art.size, dark)
            art = Image.blend(art.convert("RGB"), solid, shade).convert("RGBA")
            art.putalpha(alpha.point(lambda v: v * opacity // 255))

        canvas.alpha_composite(art, (int(centre_x - art.width / 2), baseline - art.height))

    # Supporting cast first and pushed inward, so the hero overlaps them and the
    # card reads as a group rather than as a character-select line-up.
    for index, sprite in enumerate((supporting or [])[:2]):
        side = -1 if index % 2 == 0 else 1
        place(
            sprite,
            target_height=int(height * 0.56),
            centre_x=width / 2 + side * width * 0.17,
            baseline=int(height * 0.93),
            shade=0.55,
            opacity=190,
        )

    place(hero, target_height=int(height * 0.78), centre_x=width / 2,
          baseline=int(height * 0.97))
    return canvas.convert("RGBA")


ASSET_NAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_asset_name(name: str, fallback: str = "asset") -> str:
    """Reduce a name to something safe to use as a single path segment.

    Asset names are model-generated entity ids, and the theme they come from is
    user-supplied, so they are not trustworthy path components. Anything outside
    a conservative charset is collapsed, and a name that is all separators - or
    any form of `..` - falls back rather than escaping the world directory.
    """
    cleaned = ASSET_NAME_SAFE.sub("-", str(name or "")).strip("-._")
    if not cleaned or set(cleaned) <= {"."}:
        return fallback
    return cleaned[:120]


def save_asset(image: Image.Image, world_id: str, name: str, assets_dir: Optional[str] = None) -> str:
    """Write one WebP asset and return the URL the World should carry.

    Existing Worlds keep their persisted PNG URLs and files. Only newly forged
    assets take this path, so the format change needs no data migration.
    """
    base_dir = assets_dir or get_world_assets_dir()
    safe_world = safe_asset_name(world_id, "world")
    world_dir = os.path.join(base_dir, safe_world)
    os.makedirs(world_dir, exist_ok=True)

    filename = f"{safe_asset_name(name)}{WORLD_ASSET_EXTENSION}"
    target = os.path.join(world_dir, filename)
    # Belt and braces: the name is sanitized above, so this should never trip.
    if os.path.commonpath([os.path.abspath(world_dir), os.path.abspath(target)]) != os.path.abspath(world_dir):
        raise ValueError(f"Refusing to write asset outside its world directory: {name!r}")

    has_alpha = "A" in image.getbands() or "transparency" in image.info
    prepared = image.convert("RGBA" if has_alpha else "RGB")
    if has_alpha and prepared.getchannel("A").getextrema() == (255, 255):
        # Backdrops and covers are opaque. Omitting their redundant alpha plane
        # makes them a little smaller while sprites and tokens retain theirs.
        prepared = prepared.convert("RGB")

    prepared.save(
        target,
        format=WORLD_ASSET_FORMAT,
        quality=WORLD_ASSET_WEBP_QUALITY,
        method=WORLD_ASSET_WEBP_METHOD,
    )
    return f"/assets/worlds/{safe_world}/{filename}"

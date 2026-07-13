# Generated visual assets

RogueLLM treats art as optional world data, not as a theme baked into the renderer.
A generated world can provide art URLs on its existing player and enemy definitions;
worlds without art continue to render their Font Awesome icons.

## Current entity contract

Player and enemy definitions may include:

```json
{
  "sprite_url": "/static/assets/worlds/example/character.png",
  "sprite_token_url": "/static/assets/worlds/example/character-token.png"
}
```

- `sprite_url` is a transparent, front-facing full-body sprite for combat and status UI.
- `sprite_token_url` is a square derivative of the same identity for the map.
- Both fields are optional. The frontend prefers the requested variant, falls back to
  the other sprite, and finally falls back to `font_awesome_icon`.
- Art URLs are gameplay metadata and must survive world translation unchanged.

The default RogueLLM render profile requests one neutral frontal pose. The characters
are static board pieces; action direction comes from paths, targeting, and effects.
A different game renderer can request a different profile through its asset manifest
without changing this world schema.

## Intended generation flow

1. A model reads the completed world definition and emits a structured visual-asset
   manifest. This is model-based classification with a schema, not keyword routing.
2. The manifest describes the shared style, palette, camera, character identities,
   required asset types, and explicit exclusions.
3. An image model generates each distinct source asset on a removable flat background.
4. A deterministic post-process removes the background and derives map tokens from the
   same source identity.
5. Automated checks validate dimensions, alpha coverage, safe padding, file existence,
   and manifest completeness before URLs are attached to the world definition.
6. A visual model can reject identity or style drift and request a targeted retry.

Generation may run asynchronously after the playable text world exists. Until its art
bundle is ready, the icon fallback keeps the world immediately usable.

## Piedone vertical slice

The Piedone development world demonstrates the contract with three generated frontal
sprites. Piedone, Street Punk, and Yakuza Lieutenant have both combat sprites and map
tokens; Dock Thug intentionally exercises the icon fallback.

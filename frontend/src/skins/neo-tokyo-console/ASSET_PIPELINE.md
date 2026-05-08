# Neo Tokyo Console Asset Pipeline

This skin can use generated bitmap art, but generated images should not be applied directly with `background-size: cover`, full-panel stretching, or arbitrary `border-image` values. Runtime assets need to be intentionally cut into layout-safe parts first.

## Current Raw References

The files in `raw/` are generated reference surfaces only:

- `panel-frame.png`
- `lcd-panel.png`
- `button-surface.png`
- `map-frame.png`

They are useful for style direction and source material, but they are not currently runtime assets.

## Current Runtime Assets

The files in `assets/` are safe for live CSS:

- `lcd-fill-tile.png`: a 64x64 seamless LCD fill. It is intended to be used with `background-repeat: repeat` and `background-size: 64px 64px`.
- `panel-fill-tile.png`: a 64x64 seamless graphite panel fill. It is intended to be used with `background-repeat: repeat` and `background-size: 64px 64px`.

## Runtime Asset Rules

Use one of these patterns before wiring an image into CSS:

- **Fixed-size asset:** for controls that have fixed dimensions, such as square icon buttons, LEDs, screws, and small badges.
- **Nine-slice frame:** for resizable panels. Corners must stay fixed, edges can stretch or repeat, and the center must be a separate fill.
- **Tileable fill:** for panel interiors, LCD scanlines, brushed metal, noise, or glass. It must repeat cleanly on both axes needed by the target.
- **Layered chrome:** combine a tokenized CSS base color, tileable fill, fixed corner/edge artwork, and CSS shadow/glow as separate layers.

Do not use generated full panels as a generic `cover` background on live controls. That warps bevels, LEDs, screws, and shadows at different aspect ratios.

## Suggested Next Cuts

For the next asset pass, generate or crop these explicit pieces:

- `lcd-fill-tile.png`: 32x32 or 64x64 seamless green scanline fill. Done for this skin.
- `panel-fill-tile.png`: 64x64 seamless dark brushed graphite fill. Done for this skin.
- `panel-corner-tl.png`, `panel-corner-tr.png`, `panel-corner-bl.png`, `panel-corner-br.png`: fixed corners.
- `panel-edge-top.png`, `panel-edge-right.png`, `panel-edge-bottom.png`, `panel-edge-left.png`: repeatable or stretch-safe edges.
- `button-160x48-normal.png`, `button-160x48-active.png`, `button-160x48-disabled.png`: fixed-size button surfaces.
- `led-green.png`, `led-amber.png`, `led-red.png`: fixed accent lights.

Once those exist, CSS can compose them predictably rather than stretching a generated screenshot.

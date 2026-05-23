# Neo Tokyo Console Asset Pipeline

This skin can use generated bitmap art, but generated images should not be
applied directly as CSS backgrounds, full-panel stretching, or arbitrary
`border-image` values. Runtime assets need to be intentionally cut into
layout-safe Phaser parts first.

## Current Raw References

The files in `raw/` are generated reference surfaces only:

- `panel-frame.png`
- `lcd-panel.png`
- `button-surface.png`
- `map-frame.png`

They are useful for style direction and source material, but they are not currently runtime assets.

## Legacy Runtime Assets

The files in `assets/` came from the earlier browser/CSS pass. They are useful
as source material and fallback references, but they are not the target for new
v1 fixed-skin work:

- `lcd-fill-tile.png`: a 96x96 seamless LCD fill. It is intended to be used with `background-repeat: repeat` and `background-size: 96px 96px`.
- `lcd-frame-9slice.png`: a 48x48 transparent LCD frame. It is intended to be used as a border image with slice `8`, fixed corners, and repeated edges.
- `panel-fill-tile.png`: a 96x96 seamless graphite panel fill. It is intended to be used with `background-repeat: repeat` and `background-size: 96px 96px`.
- `panel-frame-9slice.png`: a 48x48 transparent panel frame. It is intended to be used as a border image with slice `12`, fixed corners, and repeated edges.
- `button-fill-tile.png`: a 96x96 seamless brushed button fill. It is intended to be used with `background-repeat: repeat` and `background-size: 96px 96px`.
- `button-frame-9slice.png`: a 48x48 transparent button frame. It is intended to be used as a border image with slice `12`, fixed corners, and repeated edges.

## Runtime Asset Rules

Use one of these patterns before wiring generated art into the Phaser fixed-skin
runtime:

- **Fixed-size asset:** for controls that have fixed dimensions, such as square icon buttons, LEDs, screws, and small badges.
- **Nine-slice frame:** for resizable panels. Corners must stay fixed, edges can stretch or repeat, and the center must be a separate fill.
- **Tileable fill:** for panel interiors, LCD scanlines, brushed metal, noise, or glass. It must repeat cleanly on both axes needed by the target.
- **Layered chrome:** combine fixed corner/edge artwork, tileable fill, and
  explicit overlay sprites as separate Phaser layers.

Do not use generated full panels as a generic `cover` background on live controls. That warps bevels, LEDs, screws, and shadows at different aspect ratios.

## Suggested Next Cuts

For the next asset pass, generate or crop these explicit pieces:

- `lcd-fill-tile.png`: 32x32, 64x64, or 96x96 seamless green scanline fill. Done for this skin.
- `panel-fill-tile.png`: seamless dark brushed graphite fill. Done for this skin.
- `panel-corner-tl.png`, `panel-corner-tr.png`, `panel-corner-bl.png`, `panel-corner-br.png`: fixed corners.
- `panel-edge-top.png`, `panel-edge-right.png`, `panel-edge-bottom.png`, `panel-edge-left.png`: repeatable or stretch-safe edges.
- `lcd-frame-9slice.png`: transparent LCD frame with fixed corners and repeat-safe edges. Done for this skin.
- `panel-frame-9slice.png`: transparent panel frame with fixed corners and repeat-safe edges. Done for this skin.
- `button-fill-tile.png` and `button-frame-9slice.png`: repeat-safe button fill and frame. Done for this skin.
- `button-160x48-normal.png`, `button-160x48-active.png`, `button-160x48-disabled.png`: fixed-size button surfaces.
- `led-green.png`, `led-amber.png`, `led-red.png`: fixed accent lights.

Once those exist, the Phaser fixed-skin path can compose them predictably rather
than stretching a generated screenshot.

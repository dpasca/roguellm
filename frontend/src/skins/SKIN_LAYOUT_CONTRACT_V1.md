# RogueLLM Skin Layout Contract v1

This is the fixed geometry contract for the first AI-generated RogueLLM skin
packs. It exists so skin generation can target exact artboards and crop targets
instead of relying on DOM style tweaks after the fact.

The machine-readable source for automated validation is
`SKIN_LAYOUT_CONTRACT_V1.json`. Keep this document and the JSON contract in sync
when creating a future contract version.

The v1 contract is mobile-first and has two artboard variants:

- `mobilePortrait`: `390x844`
- `mobileCompact`: `390x667`

Desktop is intentionally out of scope for v1. A desktop contract should reuse
the same widget names, but it should become a separate geometry contract rather
than a scaled mobile layout.

## Non-Negotiable Rules

- The generated artboard is a skin source, not a gameplay screenshot.
- The chassis may draw frames, wells, screws, glow, panels, glass, and decorative
  labels, but it must leave all live regions clean.
- Do not bake gameplay map tiles, player markers, item icons, enemy icons, HP
  values, stat values, enemy names, log messages, inventory item names, terminal
  copy, or model status text into the source art.
- Do not rely on stretching. Runtime may scale the whole artboard uniformly, but
  individual widgets and crops keep their fixed pixel dimensions.
- Button, toggle, indicator, and terminal states must be separate assets or
  separately croppable state art.
- Phaser-rendered runtime content owns the live regions. Art should frame it,
  not replace it.
- Browser styling is outside the skin and runtime UI contract. Phaser owns all
  live UI placement, composition, and skin rendering on canvas. Do not use DOM
  stylesheets to place, skin, size, or compose game widgets.

## Coordinate System

All coordinates are integer pixels in source-artboard space:

```json
{ "x": 0, "y": 0, "width": 390, "height": 844 }
```

The origin is the top-left of the source artboard. Rectangles are measured as
`x`, `y`, `width`, `height`.

## Live Region Rectangles

These rectangles must remain clean enough for Phaser-rendered runtime content.
The source art should contain frames and surrounding chrome, not baked dynamic
content inside these rectangles.

### Mobile Portrait `390x844`

| Region | x | y | w | h | Runtime contents |
| --- | ---: | ---: | ---: | ---: | --- |
| `map` | 22 | 48 | 346 | 281 | Phaser board, player marker, item/enemy overlays |
| `latest` | 24 | 344 | 284 | 86 | Newest top-first message |
| `log` | 24 | 342 | 342 | 284 | Expanded message history drawer |
| `inventory` | 24 | 342 | 342 | 284 | Expanded inventory drawer |
| `title` | 32 | 454 | 258 | 34 | Player icon and game title |
| `player` | 24 | 488 | 342 | 54 | HP, attack, defense, XP, current tile |
| `combat` | 24 | 562 | 342 | 64 | Mode plate, enemy badge/name/HP |
| `controls` | 18 | 646 | 354 | 187 | D-pad and action controls |
| `endState` | 38 | 360 | 314 | 292 | Defeat/victory panel copy and stats |

### Mobile Compact `390x667`

| Region | x | y | w | h | Runtime contents |
| --- | ---: | ---: | ---: | ---: | --- |
| `map` | 22 | 48 | 346 | 232 | Phaser board, player marker, item/enemy overlays |
| `latest` | 24 | 292 | 284 | 74 | Newest top-first message |
| `log` | 24 | 290 | 342 | 238 | Expanded message history drawer |
| `inventory` | 24 | 290 | 342 | 238 | Expanded inventory drawer |
| `title` | 32 | 374 | 258 | 30 | Player icon and game title |
| `player` | 24 | 406 | 342 | 48 | HP, attack, defense, XP, current tile |
| `combat` | 24 | 464 | 342 | 50 | Mode plate, enemy badge/name/HP |
| `controls` | 18 | 518 | 354 | 149 | D-pad and action controls |
| `endState` | 38 | 292 | 314 | 238 | Defeat/victory panel copy and stats |

## Crop Targets And State Assets

Generated source art must make these areas clear enough to crop transparent PNG
state sprites. A skin kit may reuse button sprites from another profile only
when the source and target rectangles are identical in size.

### Mobile Portrait Button And Toggle Crops

| Asset id | x | y | w | h | Required states |
| --- | ---: | ---: | ---: | ---: | --- |
| `attack` | 205 | 666 | 152 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `run` | 205 | 746 | 152 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `restart` | 82 | 578 | 226 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `log` | 315 | 348 | 46 | 32 | `idle`, `hover`, `pressed`, `disabled` |
| `inventory` | 315 | 392 | 46 | 32 | `idle`, `hover`, `pressed`, `disabled` |
| `moveN` | 73 | 672 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveS` | 73 | 768 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveE` | 121 | 720 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveW` | 25 | 720 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |

### Mobile Compact Button And Toggle Crops

| Asset id | x | y | w | h | Required states |
| --- | ---: | ---: | ---: | ---: | --- |
| `attack` | 205 | 522 | 152 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `run` | 205 | 592 | 152 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `restart` | 82 | 462 | 226 | 66 | `idle`, `hover`, `pressed`, `disabled` |
| `log` | 315 | 296 | 46 | 32 | `idle`, `hover`, `pressed`, `disabled` |
| `inventory` | 315 | 336 | 46 | 32 | `idle`, `hover`, `pressed`, `disabled` |
| `moveN` | 73 | 520 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveS` | 73 | 608 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveE` | 121 | 564 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |
| `moveW` | 25 | 564 | 58 | 58 | `idle`, `hover`, `pressed`, `disabled` |

## Indicator And Meter Rectangles

Indicators are state sprites. Meters are live runtime fills and must be framed
by the chassis without baking in the fill value.

### Mobile Portrait

| Item | x | y | w | h | Runtime/state |
| --- | ---: | ---: | ---: | ---: | --- |
| `status` | 301 | 454 | 60 | 26 | `ready`, `thinking`, `error`, `offline` |
| `combatLed` | 349 | 563 | 18 | 18 | `on`, `off` |
| `playerHp` | 84 | 505 | 196 | 8 | Runtime fill |
| `enemyHp` | 168 | 604 | 150 | 8 | Runtime fill |
| `playerStats` | 34 | 523 | 316 | 18 | Runtime stat plates |

### Mobile Compact

| Item | x | y | w | h | Runtime/state |
| --- | ---: | ---: | ---: | ---: | --- |
| `status` | 301 | 374 | 60 | 26 | `ready`, `thinking`, `error`, `offline` |
| `combatLed` | 349 | 465 | 18 | 18 | `on`, `off` |
| `playerHp` | 84 | 422 | 196 | 8 | Runtime fill |
| `enemyHp` | 168 | 496 | 150 | 8 | Runtime fill |
| `playerStats` | 34 | 438 | 316 | 16 | Runtime stat plates |

## Skin Kit Files

Each generated skin profile directory must provide or explicitly reference:

```text
chassis.png
attack-idle.png
attack-hover.png
attack-pressed.png
attack-disabled.png
run-idle.png
run-hover.png
run-pressed.png
run-disabled.png
restart-idle.png
restart-hover.png
restart-pressed.png
restart-disabled.png
log-idle.png
log-hover.png
log-pressed.png
log-disabled.png
inventory-idle.png
inventory-hover.png
inventory-pressed.png
inventory-disabled.png
dpad-n-idle.png
dpad-n-hover.png
dpad-n-pressed.png
dpad-n-disabled.png
dpad-s-idle.png
dpad-s-hover.png
dpad-s-pressed.png
dpad-s-disabled.png
dpad-e-idle.png
dpad-e-hover.png
dpad-e-pressed.png
dpad-e-disabled.png
dpad-w-idle.png
dpad-w-hover.png
dpad-w-pressed.png
dpad-w-disabled.png
status-ready.png
status-thinking.png
status-error.png
status-offline.png
led-on.png
led-off.png
panel-fill-tile.png
panel-frame-9slice.png
lcd-fill-tile.png
lcd-frame-9slice.png
button-fill-tile.png
button-frame-9slice.png
skin-kit.json
```

## Manifest Requirements

`skin-kit.json` must declare:

- `id`, `kind`, and `size`
- `meta.label`, `meta.family`, `meta.role`, `meta.tags`, `meta.mood`,
  `meta.palette`, `meta.defaultPriority`, and `meta.generation`
- `regions` using the exact v1 widget names
- `renderTheme` with explicit `#rrggbb` runtime colors for Phaser-rendered
  text, meters, frames, combat accents, and LCD/panel fills
- `layout.buttons` using the exact v1 button names
- `layout.indicators.status` and `layout.indicators.combatLed`
- `layout.fills.playerHp`, `layout.fills.enemyHp`, and
  `layout.fills.playerStats`
- `assets.chassis.path`
- `assets.materials.panel`, `assets.materials.lcd`, and
  `assets.materials.button`, each with `fill.path`, `frame.path`, and `slice`
- `assets.buttons.<id>.prefix` for every button/toggle

Runtime widget names are stable API. New skins may change art style, palette,
and metadata, but should not rename widgets or change the v1 rectangles unless
we intentionally create `Skin Layout Contract v2`.

Material assets are part of the skin kit rather than DOM stylesheets. The
`*-fill-tile.png` files are repeat-safe 96x96 textures. The
`*-frame-9slice.png` files are 48x48 transparent frames with the declared slice
inset. Production skins can keep material PNGs beside the manifest or reference
family-shared material files, but the manifest must make that choice explicit.
Production mobile skins also declare `renderTheme` in `skin-kit.json`; this is
the canvas runtime palette used inside live regions, not a stylesheet hook.

## Prompt Generator

Use the prompt generator to produce an AI image-generation prompt directly from
`SKIN_LAYOUT_CONTRACT_V1.json`:

```bash
pnpm -C frontend skin:prompt mobilePortrait --theme "premium rain-city cyberdeck, dark glass, brass switches"
pnpm -C frontend skin:prompt mobileCompact --theme "industrial subway relay, worn graphite, amber LEDs"
```

The generator prints the exact live-region rectangles, crop targets, indicator
targets, and hard rules for the selected profile. Prefer it over manually
copying tables into image-generation prompts.

## Layout Guide Generator

Use the guide generator when preparing or reviewing source artboards:

```bash
pnpm -C frontend skin:guide mobilePortrait --view live --out ../_artifacts/skin-guides/mobile-portrait-live.svg
pnpm -C frontend skin:guide mobileCompact --view crops --out ../_artifacts/skin-guides/mobile-compact-crops.png
```

The guide renders the same contract rectangles as an annotated image. Use
`--view live` for clean runtime apertures, `--view crops` for fixed asset crop
targets, and `--view all` when checking the full contract at once. These guides
are meant for visual review and for pairing with generated source art; they are
not runtime assets.

## Manifest Scaffold Generator

After generating a source artboard, use the scaffold generator to create the
matching `skin-kit.json` from the same contract profile:

```bash
pnpm -C frontend skin:scaffold rain-city-deck mobilePortrait \
  --label "Rain City Deck" \
  --tags cyberpunk,rain-city \
  --mood premium,nocturnal \
  --palette green,brass,graphite \
  --source source-widgets.png \
  --chassis-source source-chassis.png \
  --materials-source source-materials.png \
  --out ../_artifacts/skin-kits/rain-city-deck
```

The scaffold is contract-driven. It copies the exact v1 regions and layout
rectangles, declares all required fixed-size assets, and adds a `build.crops`
plan for `build:skin-kit`. The default `meta.role` is `prototype`; do not move a
generated scaffold into `src/skins/neo-tokyo-console/fixed` as a production
`default` or `variant` until the PNG assets exist and validation passes.

The scaffold crop plan assumes a single full source artboard:

- `chassis.png` is cropped from the full canvas.
- Button idle crops generate `hover`, `pressed`, and `disabled` variants.
- `status-ready.png` generates `thinking`, `error`, and `offline` variants.
- `led-off.png` generates `led-on.png`.
- If `--materials-source` is provided, material fill tiles and nine-slice frames
  are cropped from a separate material sheet. Without that option, keep the
  material PNGs repeat-safe and place them beside the generated skin-kit
  manifest before promotion.

Material source sheet layout:

```text
row 0: panel-fill-tile.png  at x=0 y=0   w=96 h=96
       panel-frame-9slice.png at x=104 y=0   w=48 h=48
row 1: lcd-fill-tile.png    at x=0 y=104 w=96 h=96
       lcd-frame-9slice.png   at x=104 y=104 w=48 h=48
row 2: button-fill-tile.png at x=0 y=208 w=96 h=96
       button-frame-9slice.png at x=104 y=208 w=48 h=48
```

The 8px gutter is intentional. It keeps tile and frame sampling from bleeding
into neighboring assets during generation cleanup.

For cleaned/generated skins, individual crops may declare `source` to use a
different artboard from `build.source`. This lets a skin keep a clean chassis
source while using a widget source that temporarily composites fixed buttons
into the exact crop slots.

`validate:skins` checks the build plan for readable source PNGs, in-bounds crop
rectangles, duplicate output paths, known variant kinds, and variant filename
conventions before a skin kit is considered valid.

## Generation Prompt Template

Use this template after selecting either the portrait or compact rectangle set:

```text
Create a polished mobile roguelike cyberdeck skin source artboard.

Canvas: <390x844 or 390x667>.
Style: <theme tokens>, premium skeuomorphic handheld console, tactile fixed
hardware, crisp bevels, clean live apertures, strong readability.

Use these exact live rectangles and crop targets:
<paste the relevant v1 tables>.

Hard rules:
- This is a source artboard for a skin kit, not a gameplay screenshot.
- Leave live regions clean and empty enough for runtime content.
- Do not include map tiles, player markers, enemies, items, HP values, stat
  values, enemy names, inventory names, chat/log text, terminal copy, or model
  status text.
- Do not bake labels that change at runtime.
- Make button and toggle wells suitable for separate transparent crops in idle,
  hover, pressed, and disabled states.
- Make status and combat LED wells suitable for separate state sprites.
- Provide separate repeat-safe material tiles and transparent nine-slice frames
  for panel, LCD, and button surfaces.
- Keep edges crisp. No blur over live content apertures.
- No watermark, no brand logos.
```

## Validation Before Promotion

A generated skin may be promoted to a production `default` or `variant` profile
only after:

1. `pnpm -C frontend build:skin-kit src/skins/neo-tokyo-console/fixed/<skin-id>`
2. `pnpm -C frontend validate:skins`
3. `VISUAL_SCENARIOS=production pnpm -C frontend inspect:visual`
4. Manual review of at least movement, log, inventory, defeat, victory, restart,
   and diagnostics screenshots.

The visual review should compare against the current gold profile, but it should
not accept a skin merely because it passes gates. The art must look like a
coherent device built for these exact rectangles.

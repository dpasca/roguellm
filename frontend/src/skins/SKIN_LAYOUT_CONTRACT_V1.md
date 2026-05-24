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
- The only runtime style escape hatch is the `createPhaserHost` browser-shell
  shim that sizes the canvas host; it must not grow into widget or skin styling.

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
| `log` | 315 | 348 | 46 | 32 | `idle`, `hover`, `pressed`, `active`, `disabled` |
| `inventory` | 315 | 392 | 46 | 32 | `idle`, `hover`, `pressed`, `active`, `disabled` |
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
| `log` | 315 | 296 | 46 | 32 | `idle`, `hover`, `pressed`, `active`, `disabled` |
| `inventory` | 315 | 336 | 46 | 32 | `idle`, `hover`, `pressed`, `active`, `disabled` |
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

## Runtime Text And Icon Slots

These slots are also part of the fixed mobile contract. They define exactly
where Phaser places runtime text and semantic canvas icons inside the live
regions. Skin art may draw plates, bezels, wells, shadows, and labels around
these slots, but must not bake dynamic gameplay values into them.

The machine-readable `runtime` object in `SKIN_LAYOUT_CONTRACT_V1.json` is the
authoritative source. Production skin kits copy the exact object into
`skin-kit.json`, and `validate:skins` fails if the manifest drifts.

### Mobile Portrait Runtime Slots

| Slot | x | y | w | h | Runtime contents |
| --- | ---: | ---: | ---: | ---: | --- |
| `title.brand` | 32 | 438 | 258 | 12 | Static game brand label |
| `title.playerIcon` | 34 | 461 | 20 | 20 | Player semantic icon |
| `title.gameTitle` | 64 | 454 | 226 | 34 | Generated game title |
| `latest.label` | 32 | 352 | 268 | 12 | Latest message label |
| `latest.message` | 32 | 368 | 268 | 58 | Top-first newest message |
| `player.hpLabel` | 32 | 496 | 36 | 18 | HP label |
| `player.hpValue` | 270 | 496 | 88 | 18 | Current/max HP |
| `combat.mode` | 32 | 568 | 72 | 14 | Explore/combat mode label |
| `combat.exploreText` | 32 | 588 | 326 | 22 | Non-combat status text |
| `combat.enemyIcon` | 32 | 589 | 16 | 16 | Enemy semantic icon |
| `combat.enemyName` | 54 | 586 | 206 | 20 | Enemy name |
| `combat.enemyHpValue` | 280 | 586 | 78 | 20 | Enemy HP value |
| `drawers.log.header` | 34 | 352 | 322 | 16 | Log drawer heading |
| `drawers.log.rowLabel` | 34 | 386 | 34 | 14 | First log row marker |
| `drawers.log.rowText` | 74 | 384 | 276 | 42 | First log row text |

Portrait player stats use fixed one-line stat slots:

| Stat | Label x/y/w/h | Value x/y/w/h |
| --- | --- | --- |
| `attack` | 34 / 524 / 28 / 18 | 64 / 524 / 36 / 18 |
| `defense` | 108 / 524 / 30 / 18 | 142 / 524 / 36 / 18 |
| `xp` | 186 / 524 / 24 / 18 | 214 / 524 / 38 / 18 |
| `tile` | 258 / 524 / 32 / 18 | 294 / 524 / 56 / 18 |

### Mobile Compact Runtime Slots

| Slot | x | y | w | h | Runtime contents |
| --- | ---: | ---: | ---: | ---: | --- |
| `title.playerIcon` | 34 | 381 | 17 | 17 | Player semantic icon |
| `title.gameTitle` | 61 | 374 | 229 | 30 | Generated game title |
| `latest.label` | 32 | 300 | 268 | 12 | Latest message label |
| `latest.message` | 32 | 316 | 268 | 46 | Top-first newest message |
| `player.hpLabel` | 32 | 412 | 36 | 16 | HP label |
| `player.hpValue` | 268 | 412 | 90 | 16 | Current/max HP |
| `combat.mode` | 32 | 470 | 70 | 14 | Explore/combat mode label |
| `combat.exploreText` | 32 | 488 | 326 | 18 | Non-combat status text |
| `combat.enemyIcon` | 32 | 486 | 16 | 16 | Enemy semantic icon |
| `combat.enemyName` | 54 | 486 | 202 | 18 | Enemy name |
| `combat.enemyHpValue` | 280 | 486 | 78 | 18 | Enemy HP value |
| `drawers.log.header` | 34 | 300 | 322 | 16 | Log drawer heading |
| `drawers.log.rowLabel` | 34 | 324 | 34 | 14 | First log row marker |
| `drawers.log.rowText` | 74 | 322 | 276 | 36 | First log row text |

Compact player stats use fixed one-line stat slots:

| Stat | Label x/y/w/h | Value x/y/w/h |
| --- | --- | --- |
| `attack` | 34 / 438 / 24 / 16 | 62 / 438 / 30 / 16 |
| `defense` | 98 / 438 / 24 / 16 | 126 / 438 / 30 / 16 |
| `xp` | 162 / 438 / 20 / 16 | 186 / 438 / 42 / 16 |
| `tile` | 232 / 438 / 28 / 16 | 264 / 438 / 86 / 16 |

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
log-active.png
log-disabled.png
inventory-idle.png
inventory-hover.png
inventory-pressed.png
inventory-active.png
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
- `runtime` copied from the selected contract profile; this is the exact Phaser
  text/icon slot blueprint
- `assets.chassis.path`
- `assets.materials.panel`, `assets.materials.lcd`, and
  `assets.materials.button`, each with `fill.path`, `frame.path`, and `slice`
- `assets.buttons.<id>.prefix` for every button/toggle
- `assets.buttons.attack.icon`, `assets.buttons.run.icon`, and
  `assets.buttons.restart.icon` should name the manifest-driven action marks
  rendered by Phaser on canvas

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
Material entries may set `renderMode: "source"` when the fill/frame art is
already color-authored for that skin. Otherwise Phaser treats material art as a
neutral texture and tints it from `renderTheme`. Production mobile skins that
keep material PNGs beside their own manifest must declare `renderMode` for each
local material entry.

## Prompt Generator

Use the prompt generator to produce an AI image-generation prompt directly from
`SKIN_LAYOUT_CONTRACT_V1.json`:

```bash
pnpm --silent -C frontend skin:prompt mobilePortrait --theme "premium rain-city cyberdeck, dark glass, brass switches" --output source-pack
pnpm --silent -C frontend skin:prompt mobileCompact --theme "industrial subway relay, worn graphite, amber LEDs" --output source-pack
```

The generator prints the exact live-region rectangles, crop targets, indicator
targets, optional source-owned state sheet layout, material sheet layout, and
hard rules for the selected profile. Prefer the default source-pack output over
one flexible UI image: it asks for a clean chassis artboard, fixed widget crop
artboard, optional fixed widget state sheet, and tile/nine-slice material sheet.

## Layout Guide Generator

Use the guide generator when preparing or reviewing source artboards:

```bash
pnpm -C frontend skin:guide mobilePortrait --view live --out ../_artifacts/skin-guides/mobile-portrait-live.svg
pnpm -C frontend skin:guide mobileCompact --view crops --out ../_artifacts/skin-guides/mobile-compact-crops.png
pnpm -C frontend skin:guide mobileCompact --view runtime --out ../_artifacts/skin-guides/mobile-compact-runtime.svg
pnpm -C frontend skin:guide mobileCompact --view all --source ../_artifacts/skin-kits/rain-city-deck/source-chassis.png --out ../_artifacts/skin-guides/rain-city-overlay.svg
pnpm -C frontend skin:state-guide mobileCompact --out ../_artifacts/skin-guides/mobile-compact-state-sheet.svg
```

The guide renders the same contract rectangles as an annotated image. Use
`--view live` for clean runtime apertures, `--view crops` for fixed asset crop
targets, `--view runtime` for the exact Phaser text/icon slots, and `--view all`
when checking the full contract at once. These guides are meant for visual
review and for pairing with generated source art; they are not runtime assets.
Pass `--source <path>` to place an exact-size generated source artboard
underneath the guide overlay for alignment review before building a skin kit.
PNG sources must match the selected profile dimensions.

The state-sheet guide is separate because state sprites are fixed-size widgets,
not runtime layout regions. It renders the exact `source-state-sheet.png`
dimensions and every expected state slot. Use it for premium skins where hover,
pressed, disabled, active, ready, thinking, error, on, and off states should be
drawn intentionally instead of derived from one idle crop.

## Manifest Scaffold Generator

If you need an exact-size source artboard before using external image
generation, create a deterministic prototype source first:

```bash
pnpm -C frontend skin:source-prototype rain-city-deck mobileCompact \
  --theme obsidian-rain \
  --out ../_artifacts/skin-kits/rain-city-deck
```

This writes `source-chassis.png`, `source-widgets.png`, and
`source-materials.png`. Treat those as a contract-aligned baseline or as paint
overs for image generation; they are not a substitute for final art review.
Premium generated skins may also provide `source-state-sheet.png`, following
the state-sheet guide, so each fixed widget state is source-owned.

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
  --state-source source-state-sheet.png \
  --materials-source source-materials.png \
  --material-render-mode source \
  --out ../_artifacts/skin-kits/rain-city-deck
```

Before cropping, validate the source pack and scaffold handoff together:

```bash
pnpm -C frontend validate:skin-source-packs ../_artifacts/skin-kits/rain-city-deck
pnpm -C frontend skin:review-source ../_artifacts/skin-kits/rain-city-deck --json --fail-on-issue
```

This preflight checks the three required PNG filenames, exact chassis/widget
artboard dimensions, material-sheet bounds, and the scaffold handoff paths. It
is deliberately about fixed source geometry; passing it does not mean the art is
beautiful enough to promote.
The review command writes a self-contained HTML contact sheet with source
artboards, material-sheet crops, live regions, fixed widget crops, and Phaser
runtime text/icon slots overlaid for manual rejection before build. Pass
`--json` to also write a machine-readable `review.json` beside the HTML. Use
`--fail-on-issue` for promotion scripts that should stop on geometry/source
handoff problems, and reserve `--fail-on-warning` for stricter passes where
measured quality signals should block promotion until manually resolved.
The generated `skin:handoff` promotion commands use `--fail-on-warning` for
`default` and `variant` roles, so weak widget crops, busy live regions,
unsafe material seams, and collapsed state-sheet variants stop the handoff
before a skin is promoted.
Generated source packs marked as `default` or `variant` must use
`source-state-sheet.png` for authored button, toggle, status, and LED states;
prototype source packs may still derive states while a visual direction is being
explored.

The scaffold is contract-driven. It copies the exact v1 regions and layout
rectangles, declares all required fixed-size assets, and adds a `build.crops`
plan for `build:skin-kit`. The default `meta.role` is `prototype`; do not move a
generated scaffold into `src/skins/neo-tokyo-console/fixed` as a production
`default` or `variant` until the PNG assets exist and validation passes.

Without `--state-source`, the scaffold crop plan assumes a single full widget
source artboard:

- `chassis.png` is cropped from the full canvas.
- Button idle crops generate `hover`, `pressed`, and `disabled` variants.
- Log and Inventory toggle crops generate those states plus the latched
  `active` variant.
- `status-ready.png` generates `thinking`, `error`, and `offline` variants.
- `led-off.png` generates `led-on.png`.
- If `--materials-source` is provided, material fill tiles and nine-slice frames
  are cropped from a separate material sheet. Without that option, keep the
  material PNGs repeat-safe and place them beside the generated skin-kit
  manifest before promotion.

With `--state-source source-state-sheet.png`, buttons, toggles, the status
indicator, and the combat LED are cropped directly from the state-sheet guide
slots. In that workflow no generated hover/pressed/disabled/active variants are
used for widgets; each state can have its own authored lighting, bevel depth,
and on/off hardware.

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
2. `pnpm -C frontend validate:skin-source-packs src/skins/neo-tokyo-console/fixed/<skin-id>`
3. `pnpm -C frontend skin:review-source src/skins/neo-tokyo-console/fixed/<skin-id> --json --fail-on-issue`
4. `pnpm -C frontend validate:skins`
5. `VISUAL_SCENARIOS=production pnpm -C frontend inspect:visual`
6. Manual review of at least movement, log, inventory, defeat, victory, restart,
   and diagnostics screenshots.

The visual review should compare against the current gold profile, but it should
not accept a skin merely because it passes gates. The art must look like a
coherent device built for these exact rectangles.

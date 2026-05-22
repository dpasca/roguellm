# RogueLLM Mobile Skin Blueprint

This is the mobile-first contract for fixed, Winamp-style RogueLLM skins. Desktop
skins should become separate profiles later, using the same widget names with
different coordinates and assets.

## Goals

- Build one polished `mobilePortrait` profile before expanding to desktop.
- Treat generated art as a skin kit, not a screenshot.
- Keep all dynamic game content out of the source art.
- Use fixed widget coordinates and explicit state sprites.
- Allow only deliberate composition, such as alpha sprites, 9-slice frames, or
  tiled fills.

## Mobile Profile

The first production target is a `390x844` portrait artboard. The renderer may
scale the whole artboard uniformly to fit the viewport, but it must not stretch
individual bitmap widgets.

The current gold layout target uses this hierarchy:

- Header/status chrome: `0-44`.
- Map aperture: about `346x281`, large enough to inspect the board but no
  longer dominant.
- Latest message: about `284x86`, readable as a primary story surface while
  reserving a fixed log-toggle well.
- Expanded log: about `342x204`, allowed to overlay the player panel while open.
- Title/status band plus player panel: title and model status sit above a
  compact `342x54` HP/stat block.
- Combat panel: about `342x64`, compact but readable.
- Controls: bottom `190px`, D-pad left and action buttons right.
- End-state overlay: about `314x292`, large enough for defeat/victory copy,
  HP/XP, and a fixed restart sprite without hiding the whole map.

Every mobile skin profile must define:

- `chassis`: full-size background art with empty apertures.
- `map`: live Phaser map aperture.
- `latest`: compact top-first message LCD.
- `log`: expanded log aperture or drawer.
- `title`: game/player title region.
- `player`: HP, stats, XP, current tile.
- `combat`: enemy name and enemy HP region.
- `endState`: terminal defeat/victory panel region.
- `attack`: primary combat button.
- `run`: secondary combat button.
- `restart`: terminal-state restart button.
- `logToggle`: log open/close button.
- `moveN`, `moveS`, `moveE`, `moveW`: D-pad buttons.
- `status`: connection/model state indicator.
- `combatLed`: combat on/off indicator.

Desktop may later add or reposition widgets, but it should not rename these
core widgets.

## Runtime Layers

The fixed skin renderer should stack layers in this order:

1. `chassis`: static full-artboard image.
2. Live content apertures: Phaser map, text, HP fills, log rows.
3. Control sprites: buttons and indicator images.
4. Optional overlays: glass, scanlines, bezel glare, alert glow.

The chassis must not contain live map tiles, generated item/enemy icons, HP
values, enemy names, log text, or button state text that changes at runtime.

## Asset Rules

Use PNG for all runtime bitmap skin assets.

Required button states:

- `idle`
- `hover`
- `pressed`
- `disabled`

Required status states:

- `ready`
- `thinking`
- `error`
- `offline`

Required binary indicator states:

- `on`
- `off`

Button assets may include their own label text when the manifest sets
`hideLabel: true`. Otherwise, Font Awesome icons and DOM labels are rendered on
top by the app.

Prefer alpha PNGs for controls. Avoid rectangular screenshot crops unless the
entire rectangle is an intentional physical widget.

## Art Generation Rules

When generating a new skin, request a blank mobile cyberdeck UI kit:

- Empty map viewport.
- Empty message/log LCD.
- Empty player/combat panels.
- Physical D-pad and action-button wells.
- No baked dynamic labels except stable decorative labels.
- No sample HP values, enemy names, chat text, map icons, or active game state.
- Clean enough control areas to slice into separate transparent state sprites.

If a generated artboard includes baked dynamic content, it is only reference
material. It should not become the production chassis without cleanup.

Use `SKIN_GENERATION_PROMPT.md` as the starting prompt for the next generated
artboard. Once an artboard exists, add crop targets to that skin's
`skin-kit.json`, run `pnpm -C frontend build:skin-kit <skin-dir>`, then run
`pnpm -C frontend validate:skins`.

## Diagnostics

Every skin profile needs a diagnostics scenario that shows:

- The mobile artboard at runtime scale.
- All button state sprites.
- All indicator states.
- A combat state.
- A movement-unlocked state.
- Defeat and victory terminal states.
- Latest/log text in top-first order.

Visual inspection should capture diagnostics screenshots and fail if widgets are
missing, clipped, or overflowing the viewport.

## Current Profiles

- `mobile-portrait`: early generated placeholder profile.
- `gold-mobile`: deterministic layout target, current mobile default, and
  terminal-flow quality gate.
- `reference-mobile`: screenshot-derived prototype, useful as a warning.
- `reference-mobile-v2`: cleaned prototype with empty apertures and alpha
  controls; useful comparison profile.
- `desktop-wide`: placeholder desktop profile kept only to preserve the future
  profile shape.

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
- Expanded log: about `342x284`, allowed to overlay the title, player, and
  combat panels while open so story text has real reading space.
- Expanded inventory: about `342x284`, sharing the drawer space with the log
  and showing item rows plus fixed action affordances.
- Title/status band plus player panel: title and model status sit above a
  compact `342x54` HP/stat block.
- Combat panel: about `342x64`, compact but readable.
- Controls: bottom `190px`, D-pad left and action buttons right.
- End-state overlay: about `314x292`, large enough for defeat/victory copy,
  HP/XP, and a fixed restart sprite without hiding the whole map.

Every mobile skin profile must define:

- `meta`: label, family, role, tags, mood, palette, and default priority.
- `chassis`: full-size background art with empty apertures.
- `map`: live Phaser map aperture.
- `latest`: compact top-first message LCD.
- `log`: expanded log aperture or drawer.
- `inventory`: expanded inventory aperture or drawer.
- `title`: game/player title region.
- `player`: HP, stats, XP, current tile.
- `combat`: enemy name and enemy HP region.
- `endState`: terminal defeat/victory panel region.
- `attack`: primary combat button.
- `run`: secondary combat button.
- `restart`: terminal-state restart button.
- `logToggle`: log open/close button.
- `inventoryToggle`: inventory open/close button.
- `moveN`, `moveS`, `moveE`, `moveW`: D-pad buttons.
- `status`: connection/model state indicator.
- `combatLed`: combat on/off indicator.

Desktop may later add or reposition widgets, but it should not rename these
core widgets.

## Metadata And Selection

Each production `mobilePortrait` skin kit must include a `meta` block:

- `label`: human-readable profile name.
- `family`: broader UI family, currently `Neo Tokyo Console`.
- `role`: one of `default`, `variant`, `prototype`, or `legacy`.
- `tags`: setting or genre hints such as `cyberpunk`, `industrial`, or
  `underground`.
- `mood`: aesthetic feel such as `premium`, `tactical`, or `nocturnal`.
- `palette`: dominant color words.
- `defaultPriority`: numeric preference used by runtime profile selection.
- `generation`: optional provenance such as `deterministic-svg-premium`.

Metadata tokens in `tags`, `mood`, and `palette` must be unique lowercase
kebab-case strings. Runtime selection treats them as exact structured tokens,
so generated manifests should use stable tags like `rain-city` instead of
display phrases like `Rain City`.

The fixed mobile runtime first honors an explicit `profile=` query parameter.
Without that override, it chooses the highest-priority `mobilePortrait` profile.
That keeps the default choice data-driven and makes future LLM theme matching a
metadata problem instead of another hardcoded profile id.

For structured theme experiments, pass comma-separated metadata tokens with
`skin_tags`, `skin_mood`, and `skin_palette`. These are exact manifest tokens,
not free-text classification. For example, `skin_tags=industrial,relay` plus
`skin_palette=amber` selects the amber profile unless `profile=` overrides it.

Profiles with `role: default` or `role: variant` are treated as production
mobile profiles by `pnpm -C frontend validate:skins`. They must satisfy compact
layout gates: the closed-state regions cannot overlap, the map cannot reclaim
the whole screen, log and inventory drawers need real reading space, HP fills
must stay inside their panels, movement/action buttons must remain inside the
control bay, and the highest-priority mobile profile must be the single
`default`. Use `prototype` or `legacy` for reference skins that are useful to
compare against but should not carry production geometry promises.

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

Fixed mobile status text must use short runtime labels that fit inside the
status sprite. Current labels are `READY`, `OPEN`, `NET`, `WAIT`, `MAKE`,
`BOOT`, `ERR`, and `OFF`; longer raw transport/status strings should never be
rendered directly into the fixed indicator.

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
`pnpm -C frontend validate:skins`. The current deterministic mobile baselines
can be rebuilt with `pnpm -C frontend build:fixed-skins`; use them as the
fallback quality floor when generated art is not clean enough to slice.

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

## Playable Runtime

The fixed mobile skin is the default Game2 UI on mobile-width viewports. It can
also be forced with `ui=fixed-skin`, for example:

```text
http://127.0.0.1:8127/game2?game_id=<id>&fixture=1&ui=fixed-skin&profile=reference-mobile-v3
```

The backend preserves `skin`, `ui`, `fixed_skin`, `profile`, `skin_tags`,
`skin_mood`, and `skin_palette` query params when it creates or redirects to a
Game2 session, so these links remain on the fixed skin after session creation.
Use `ui=classic` or `ui=responsive` to force the older responsive HUD while
comparing behavior.

## Current Profiles

- `mobile-portrait`: early generated placeholder profile.
- `reference-mobile-v3`: compact mobile default, using the gold layout
  proportions with richer reference-style chrome and full terminal/drawer
  coverage.
- `gold-mobile`: deterministic layout target and terminal-flow quality gate.
- `amber-mobile`: second deterministic mobile profile proving the same fixed
  widget contract can support theme variants without layout changes.
- `signal-noir-mobile`: cyan/coral noir variant for rain-city and signal-heavy
  themes, using the same compact production geometry as the current default.
- `reference-mobile`: screenshot-derived prototype, useful as a warning.
- `reference-mobile-v2`: cleaned prototype with empty apertures and alpha
  controls; completed with inventory and restart widgets, but not promoted to
  default until its proportions meet the compact mobile gates.
- `desktop`: prototype desktop profile kept to preserve the future desktop
  profile shape through the same skin-kit contract, now covered for runtime
  ready/log/inventory/combat plus terminal restart flow.

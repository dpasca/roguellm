# RogueLLM Mobile Skin Blueprint

This is the mobile-first contract for fixed, Winamp-style RogueLLM skins. Desktop
skins should become separate profiles later, using the same widget names with
different coordinates and assets.

For exact v1 artboard coordinates, crop targets, required state assets, and the
AI-generation handoff checklist, see `SKIN_LAYOUT_CONTRACT_V1.md`. Automated
validation loads `SKIN_LAYOUT_CONTRACT_V1.json`. This blueprint explains
intent; the layout contract is the source of truth for skin geometry.

## Goals

- Build one polished `mobilePortrait` profile before expanding to desktop.
- Treat generated art as a skin kit, not a screenshot.
- Keep all dynamic game content out of the source art.
- Use fixed widget coordinates and explicit state sprites.
- Allow only deliberate composition, such as alpha sprites, 9-slice frames, or
  tiled fills.

## Mobile Profiles

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

Short phones use a separate `mobileCompact` profile instead of shrinking the
portrait artboard below comfortable reading size. The current compact target is
`390x667`, keeps the same widget names and state-sprite contract, and may reuse
button/indicator sprites from a larger profile when their fixed dimensions still
fit the compact geometry. It should have its own chassis and coordinates.

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

Each production `mobilePortrait` or `mobileCompact` skin kit must include a
`meta` block:

- `label`: human-readable profile name.
- `family`: broader UI family, currently `Neo Tokyo Console`.
- `role`: one of `default`, `variant`, `prototype`, or `legacy`.
- `tags`: setting or genre hints such as `cyberpunk`, `industrial`, or
  `underground`.
- `mood`: aesthetic feel such as `premium`, `tactical`, or `nocturnal`.
- `palette`: dominant color words.
- `defaultPriority`: numeric preference used by runtime profile selection.
- `generation`: optional provenance such as `deterministic-svg-premium`.

Each production mobile skin kit must also include a `renderTheme` block with
explicit `#rrggbb` values for the Phaser/canvas runtime: text, muted text,
primary and secondary accents, combat accents, control frames, and live-region
fills. This is part of the skin manifest, not a CSS variable set.

Metadata tokens in `tags`, `mood`, and `palette` must be unique lowercase
kebab-case strings. Runtime selection treats them as exact structured tokens,
so generated manifests should use stable tags like `rain-city` instead of
display phrases like `Rain City`.

The fixed mobile runtime first honors an explicit `profile=` query parameter.
Without that override, short mobile viewports choose a themed `mobileCompact`
profile when metadata tokens are present, then themed `mobilePortrait`, then the
highest-priority compact/default mobile profile. Taller mobile viewports choose
themed `mobilePortrait` first, then the highest-priority `mobilePortrait`
profile. That keeps the default choice data-driven and makes future LLM theme
matching a metadata problem instead of another hardcoded profile id.

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

## Runtime Widget Hardware

Repeated widgets are Phaser-rendered hardware that sits inside fixed apertures
instead of relying on DOM layout. These pieces still need stable sizes and
visual inspection gates so they behave like part of the skin:

- Fixed map apertures use a non-interactive glass/scanline layer above the
  Phaser canvas while keeping map icons above the glass for readability.
- Visual inspection must fail when the map glass is unstyled, can intercept
  pointer input, sits below the canvas, or covers the icon overlay.
- Inventory item rows use structured `Item.type`, not item-name parsing, to
  render fixed type badges.
- Known inventory badge labels are `WPN`, `ARM`, and `USE`, with a fallback
  `ITM` badge for future item types.
- Each inventory row keeps a fixed badge column, flexible text column, and fixed
  action column so generated drawer art never needs to stretch around content.
- Visual inspection must fail when fixed inventory drawers contain item rows
  without visible/styled type badges.
- Equipped inventory rows expose a latched `ON` action state rather than a
  dimmed disabled button; visual inspection must fail if those actions are
  invisible, unstyled, clipped, or mislabeled.
- Fixed log rows use a top-first hardware strip: the newest entry gets a `NEW`
  tag, history rows get numeric tags, and every row must remain scrollable
  rather than shrinking/clipping inside the drawer.
- Visual inspection must fail when fixed log drawers contain entries without
  visible/styled row tags.
- When an open fixed log drawer has more content below the visible area, it
  must expose a skinned down-cue in the drawer rail; visual inspection must
  fail when the cue is missing, unstyled, unlabeled by state, or loses its
  Font Awesome chevron.
- Fixed combat rows use the structured `current_enemy.font_awesome_icon` value
  to render a small enemy badge before the enemy name and HP.
- Visual inspection must fail when an active fixed combat state has a clipped,
  unstyled, or icon-less enemy badge.
- Fixed combat panels expose `combat` or `explore` on a physical mode plate so
  mode changes are visual state, not loose label text.
- Visual inspection must fail when the combat mode plate is clipped, unstyled,
  or reporting a state that disagrees with runtime combat state.
- Fixed player stat rows use four stable stat plates for `ATK`, `DEF`, `XP`,
  and `TILE`, with fixed numeric columns and a flexible tile-value column.
- Visual inspection must fail when fixed stat plates are missing, unstyled, or
  clipping their values.
- Production mobile fixed player panels must fit HP and stat hardware inside
  the fixed player slot; visual inspection must fail when the panel content
  overflows.
- Fixed title/player identity rows render the player Font Awesome icon inside a
  stable hardware badge before the game title, so long generated titles never
  collide with the icon.
- Visual inspection must fail when the title badge is clipped, unstyled, or
  missing its Font Awesome icon class.
- Production fixed skins expose the skin-kit `controls` region as a tested
  control bay underlay. Movement and action sprites must remain inside that
  bay and keep their fixed-state bitmap backgrounds.
- Visual inspection must fail when the control bay is clipped/unstyled, when
  fixed control sprites are missing, or when a D-pad/action button escapes the
  bay.
- Phaser fixed skins also expose a `phaserControlDetails` metric for
  canvas-rendered control hardware: recessed D-pad wells, action racks, screws,
  rails, LEDs, bevels, and directional markers. Visual inspection must fail
  when this count falls below the production floor.
- Fixed HP rows use a stable `HP` label plate and HP value plate, while the HP
  fill remains a separate meter region defined by the skin profile.
- Fixed status indicators expose their state as `ready`, `thinking`, `error`,
  or `offline` and must render the matching status sprite.
- Visual inspection must fail when HP plates are unstyled/clipped or when the
  status sprite state does not match the compact runtime label.
- Fixed latest-message panels render the newest top-first message inside a
  physical LCD strip while preserving the larger log drawer as the long-form
  reading surface.
- Visual inspection must fail when the closed-state latest LCD loses its
  physical styling or clips the latest message.
- Fixed drawer toggles are stateful hardware buttons: closed drawers use
  `idle`; the active Log or Inventory drawer uses `pressed`, with matching
  `aria-pressed` and `aria-expanded`.
- Visual inspection must fail when drawer toggles are clipped, missing fixed
  sprites, or reporting visual/ARIA state that disagrees with drawer state.
- Fixed end-state overlays use a state-specific outcome badge: `defeat` uses a
  skull badge and `victory` uses a trophy badge.
- Visual inspection must fail when terminal overlays have a clipped/unstyled
  outcome badge, the wrong outcome state, or the wrong Font Awesome icon.

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
`hideLabel: true`. Otherwise, Font Awesome icons and Phaser text labels are
rendered on top by the app.

Action buttons may declare `icon` in the manifest. The Phaser renderer maps
known action icons to crisp canvas marks so small mobile buttons do not depend
on DOM icon styling.

Prefer alpha PNGs for controls. Avoid rectangular screenshot crops unless the
entire rectangle is an intentional physical widget.

## Art Generation Rules

When generating a new skin, request a blank mobile cyberdeck UI kit:

- Empty map viewport.
- Empty message/log LCD.
- Empty player/combat panels.
- Physical D-pad and action-button wells.
- No baked dynamic labels except stable decorative labels.
- No baked labels inside live text zones such as player HP/stats, combat/enemy,
  latest message, log, inventory, or end-state copy. Runtime text must own those
  surfaces so labels never collide with generated art.
- No sample HP values, enemy names, chat text, map icons, or active game state.
- Clean enough control areas to slice into separate transparent state sprites.

If a generated artboard includes baked dynamic content, it is only reference
material. It should not become the production chassis without cleanup.

Use `SKIN_GENERATION_PROMPT.md` or `pnpm -C frontend skin:prompt` as the
starting prompt for the next generated artboard. Once an artboard exists, create
its prototype manifest with `pnpm -C frontend skin:scaffold <skin-id> <profile>`.
Then place the source image at the manifest's `build.source` path, run
`build:skin-kit` for that skin directory, then run `validate:skins`. The current
deterministic mobile baselines can be rebuilt with `build:fixed-skins`; use them
as the fallback quality floor when generated art is not clean enough to slice.

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

`pnpm -C frontend inspect:visual` discovers every production `mobilePortrait`
and `mobileCompact` profile (`role: default` or `variant`) and adds movement,
log, inventory, defeat, victory, restart, and diagnostics scenarios
automatically. Use `VISUAL_SCENARIOS=production` when you want only this
scalable production-skin sweep.

## Playable Runtime

The fixed mobile skin is the default Game2 UI on mobile-width viewports, and
the fixed-skin renderer is Phaser-first. DOM skinning is no longer the target;
it is kept only as a legacy comparison path while the Phaser runtime catches up.

Force the Phaser fixed-skin runtime with `ui=fixed-skin`, for example:

```text
http://127.0.0.1:8127/game2?game_id=<id>&fixture=1&ui=fixed-skin&profile=reference-mobile-v3
```

For short-phone manual checks, force the compact profile:

```text
http://127.0.0.1:8127/game2?game_id=<id>&fixture=1&ui=fixed-skin&profile=reference-mobile-compact
```

For local Phaser fixed-skin workbench review, use:

```text
http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin&profile=reference-mobile-compact
```

The old DOM fixed-skin paths are explicit legacy/debug tools:

```text
http://127.0.0.1:8127/game2?game_id=<id>&fixture=1&ui=fixed-skin&renderer=dom&profile=reference-mobile-compact
http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin&renderer=dom&profile=reference-mobile-compact
```

Use the Phaser renderer for new skin-quality work. It consumes the same fixed
profile manifests and PNG state assets, so improvements made there can be
migrated into the live runtime without inventing a second skin format.

Browser styling is outside the fixed-skin UI contract. The Phaser path renders
the game UI on canvas from profile geometry and PNG assets; no stylesheet may
place, skin, size, or compose fixed-skin game widgets. The only tolerated style
mutation in the Phaser path is shell-level viewport/canvas host sizing. The old
DOM renderer remains a legacy comparison/debug path only.

Fixed skin profiles own their visual material assets through `skin-kit.json`.
Reusable panel, LCD, and button materials are declared as profile data (`fill`,
`frame`, and nine-slice metadata) and rendered by Phaser as tiled
sprites/nine-slice images. The Phaser renderer must not hardcode a skin
family's material PNGs or infer a production skin palette from metadata tokens.
Production profiles must declare their runtime colors in `renderTheme`.

The Phaser fixed-skin bootstrap does not import the legacy DOM stylesheet bundle.
Visual inspection treats stylesheet links or injected style elements on Phaser
fixed-skin scenarios as a failure.

In workbench mode, the `[` and `]` keys cycle profiles of the same fixed-skin
kind, which makes compact mobile variants quick to compare without editing the
URL between screenshots.

The backend preserves `skin`, `ui`, `renderer`, `fixed_skin`, `profile`,
`skin_tags`, `skin_mood`, and `skin_palette` query params when it creates or
redirects to a Game2 session, so these links remain on the selected fixed
renderer after session creation. Use `ui=classic` or `ui=responsive` to force
the older responsive HUD while comparing behavior.

## Current Profiles

- `mobile-portrait`: early generated placeholder profile.
- `reference-mobile-v3`: compact mobile default, using the gold layout
  proportions with richer reference-style chrome and full terminal/drawer
  coverage.
- `reference-mobile-compact`: `390x667` short-phone profile selected
  automatically on short mobile viewports; it has compact geometry and reuses
  the reference control sprites.
- `rain-city-derived-compact`: generated-reference prototype that uses the v1
  compact contract with separate clean chassis and widget source artboards.
- `signal-noir-mobile-compact`: `390x667` short-phone variant for noir/signal
  requests; it uses compact geometry, its own cyan/coral chassis, and reuses the
  signal-noir control sprites.
- `gold-mobile-compact`: `390x667` short-phone variant for gold/premium city
  requests; it uses compact geometry, its own gold chassis, and reuses the gold
  control sprites.
- `amber-mobile-compact`: `390x667` short-phone variant for industrial/relay
  requests; it uses compact geometry, its own amber chassis, and reuses the
  amber control sprites.
- `gold-mobile`: deterministic layout target and terminal-flow quality gate.
- `amber-mobile`: second deterministic mobile profile proving the same fixed
  widget contract can support theme variants without layout changes.
- `signal-noir-mobile`: cyan/coral noir variant for rain-city and signal-heavy
  themes, using the same compact production geometry as the current default.
- `reference-mobile`: screenshot-derived prototype, useful as a warning.
- `reference-mobile-v2`: cleaned prototype with empty apertures and alpha
  controls; completed with inventory and restart widgets, but not promoted to
  default until its proportions meet the compact mobile gates.
- `desktop-wide`: prototype desktop profile kept to preserve the future desktop
  profile shape through the same skin-kit contract, now covered for runtime
  ready/log/inventory/combat plus terminal restart flow.

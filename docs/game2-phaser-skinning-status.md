# Game2 Phaser Skinning Status

Last updated: 2026-05-25
Branch: `spike/phaser-game2`

## Current State

Game2 now has a Phaser/canvas fixed-skin renderer path. The old DOM/CSS game UI
has been retired from the Game2 runtime entrypoint, and the fixed-skin UI is
intended to be composed from explicit profile geometry plus PNG skin assets.

The current work is technically useful but not visually finished. The most
coherent profile available today is `ai-cyberdeck-reference-v1`, but it should be
treated as a pipeline/reference skin, not as the final art direction. The newer
`premium-cyberdeck-v2` candidate was demoted to `prototype` after visual review:
it proved the handoff/build path, but it is too flat and hybrid-looking to use as
a demo target.

## What Changed

- Added a Phaser fixed-skin renderer for the Game2 interface.
- Moved the frontend package to `pnpm`, with Vite dev server on port `5273`.
- Kept Font Awesome available for Phaser-rendered icon glyphs.
- Added fixed mobile skin profiles and profile selection/cycling for the
  workbench.
- Added a mobile composition gate for the compact layout.
- Added source-pack, skin-kit, source-review, visual-inspection, and art
  blueprint validators.
- Added a local handoff pipeline for generated skin art:
  `skin:handoff`, `skin:validate-handoff`, and `skin:build-handoff`.
- Added `_artifacts/progress.html` generation for local visual breadcrumbs.
- Tightened the Phaser style boundary so stylesheet-backed fixed-skin UI cannot
  quietly return.
- Added terminal/end-state, drawer, inventory, combat, title, player, latest-log,
  and control rendering coverage in the Phaser path.

## Current Manual Test Entrypoints

Start the local frontend:

```bash
pnpm -C frontend dev
```

Primary compact reference profile:

```text
http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin&profile=ai-cyberdeck-reference-v1&scenario=movement
```

Useful scenarios:

```text
scenario=movement
scenario=combat
scenario=log
scenario=inventory
scenario=defeat
scenario=victory
```

Avoid using `scenario=diagnostics` as a visual demo. That scenario deliberately
draws a diagnostics panel over the map region.

## Validation Commands

Main frontend gate:

```bash
pnpm -C frontend check
```

Generate the local progress report:

```bash
pnpm -C frontend progress:report
```

Production visual inspection:

```bash
pnpm -C frontend check:visual:production
```

## Honest Visual Assessment

The fixed-skin infrastructure is ahead of the visual quality. The current
reference skin is readable and validates the runtime composition, but it is not
appealing enough to be the public demo.

Main visual problems:

- The UI is too noisy, with linework competing against gameplay content.
- The map reads like a dark spreadsheet with tiny icons.
- Text and panels still feel like a debug/game-jam interface in places.
- Some generated chassis art and runtime-drawn widgets do not feel like the same
  physical object.
- The interface lacks a strong, simple object fantasy.

The practical conclusion is that the next milestone should not be another small
skin tweak. It should be a new mobile-first showcase mockup.

## Recommended Next Milestone

Create one beautiful fixed-size mobile skin before making it interactive.

Proposed scope:

1. Pick one fixed target size, likely `390x667` because the compact pipeline
   already supports it.
2. Lock exact rectangles for map, latest/log, title, player state, combat state,
   d-pad, action buttons, inventory button, and log button.
3. Generate a full-device mockup that is already attractive as a static image.
   The generated art should provide a shell, materials, empty displays, and
   physical controls, while Phaser owns all runtime text, icons, values, map
   contents, and gameplay state.
4. Reject weak mockups before implementation. If it does not look good as a
   screenshot, do not crop it into assets.
5. Crop/derive assets from the chosen mockup only after the full composition is
   approved.
6. Build the skin through the fixed skin-kit/handoff pipeline.
7. Inspect the runtime at compact mobile size across movement, combat, log,
   inventory, defeat, and victory states.

## Skinning Direction

The skin system should stay fixed-layout first. We should avoid trying to make
fully flexible generated skeuomorphic UI pieces right now. Fixed widgets,
explicit button states, source-owned panel materials, and profile-specific
rectangles are more realistic and more controllable.

Future skin packs should include:

- Chassis/shell artwork.
- Panel/LCD/button material tiles and frames.
- Button state sprites: idle, hover, pressed, disabled.
- Toggle-style state variants where needed: on/off, active/inactive,
  ready/thinking/error/offline.
- Runtime layout rectangles.
- Render theme colors.
- Source notes and source-review evidence.

## Open Work

- Design and generate a genuinely demo-worthy mobile showcase mockup.
- Convert that mockup into a coherent skin kit without borrowing mismatched
  assets from older profiles.
- Improve map presentation so it feels like game art, not a grid placeholder.
- Decide how much iconography stays Font Awesome versus custom sprites per skin.
- Keep the desktop version in mind, but do not let desktop flexibility block the
  first high-quality mobile skin.
- Eventually connect skin selection to LLM-generated setting/theme metadata.
- Revisit backend/frontend architecture separately; the current phase has mainly
  addressed the Game2 frontend renderer and skin pipeline, not the Python backend.

## Recent Branch Markers

- `3f97078` Demote premium cyberdeck skin to prototype
- `28a6f32` Add premium cyberdeck demo skin
- `0919fb2` Add handoff build pipeline
- `20e00c7` Require strict review for reference imports
- `c335cdc` Tighten reference skin import workflow
- `d74ace6` Include readiness checks in skin handoffs


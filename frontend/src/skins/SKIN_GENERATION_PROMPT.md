# Mobile Skin Generation Prompt

Use this when generating the next production artboard from the gold mobile
layout. The intended output is a source artboard for a skin kit, not a screenshot
of gameplay.

Before using this prompt, choose the `mobileCompact` geometry from
`SKIN_LAYOUT_CONTRACT_V1.md` and paste the exact live-region, runtime-slot, and
crop-target tables into the prompt. Do not invent alternate coordinates during
generation; create a new layout contract version first if the geometry changes.
`validate:skins` enforces the matching machine-readable
`SKIN_LAYOUT_CONTRACT_V1.json` geometry for production mobile profiles, and
`validate:mobile-composition` enforces the current short-phone hierarchy budget.

Preferred handoff commands:

```bash
pnpm -C frontend skin:handoff rain-city-deck mobileCompact --theme "premium rain-city cyberdeck, dark glass, brass switches" --out ../_artifacts/skin-handoffs/rain-city-deck
pnpm -C frontend skin:source-prototype rain-city-deck mobileCompact --theme obsidian-rain --out ../_artifacts/skin-kits/rain-city-deck
pnpm --silent -C frontend skin:prompt mobileCompact --theme "premium rain-city cyberdeck, dark glass, brass switches" --output source-pack > ../_artifacts/skin-prompts/rain-city-deck.txt
pnpm -C frontend skin:guide mobileCompact --view live --out ../_artifacts/skin-guides/mobile-compact-live.png
pnpm -C frontend skin:guide mobileCompact --view crops --out ../_artifacts/skin-guides/mobile-compact-crops.png
pnpm -C frontend skin:guide mobileCompact --view all --source ../_artifacts/skin-kits/rain-city-deck/source-chassis.png --out ../_artifacts/skin-guides/rain-city-overlay.svg
pnpm -C frontend skin:state-guide mobileCompact --out ../_artifacts/skin-guides/mobile-compact-state-sheet.png
```

`skin:handoff` is the preferred starting point for real generation. It creates a
single ignored bundle containing the prompt, exact live/crop/runtime/state-sheet
guide images, a machine-readable handoff plan, and the scaffold/review/build
commands to run after the generated source files arrive.

For AI generation, prefer a source pack over one clever flexible UI
image:

- `source-chassis.png`: exact-size clean chassis art for the chosen contract
  profile. It owns permanent shell, bezels, wells, screws, rails, glass frames,
  and decorative labels only.
- `source-widgets.png`: exact-size widget crop art for fixed buttons, toggles,
  and indicators. It can be used by itself for simple prototypes where the
  scaffold derives state variants from idle crops.
- `source-state-sheet.png`: exact-size fixed widget state sheet for premium
  skins. It owns every button, toggle, status, and LED state in fixed slots, so
  hover, pressed, active, disabled, ready, thinking, error, on, and off states
  can have authored lighting and depth. It is required before a generated source
  pack can be promoted to a `default` or `variant` skin role.
- `source-materials.png`: repeat-safe panel/LCD/button fill tiles and transparent
  nine-slice frames. Material detail must be tile-safe or frame-safe, never a
  stretched decorative panel.

This is intentionally closer to a Winamp-style skin pack than a responsive CSS
theme. Phaser owns runtime text, icons, meters, and game state inside fixed
slots; the generated art owns tactile hardware around those slots.

```text
Create a polished mobile cyberdeck game UI skin source pack.

Canvas: 390x667 mobile compact.
Style: premium skeuomorphic handheld console, dark graphite shell, subtle neon
green/orange status lights, tactile buttons, glass LCD apertures, fine bevels,
small screws, restrained sci-fi hardware details. Beautiful but readable.

Layout:
- Header/status chrome from y=0 to y=44.
- Empty live map aperture at x=22 y=48 w=346 h=232.
- Empty latest-message LCD area at x=24 y=292 w=284 h=74.
- Fixed log-toggle button well at x=315 y=296 w=46 h=32.
- Fixed inventory-toggle button well at x=315 y=336 w=46 h=32, sharing the
  expanded drawer surface with the log.
- Title/model status band around y=374.
- Empty player HP/stat area at x=24 y=406 w=342 h=48.
- Empty combat/enemy area at x=24 y=464 w=342 h=50.
- Terminal/end-state panel area at x=38 y=292 w=314 h=238; it may be a
  reusable empty alert module or an overlay crop, but it must leave room for
  live title, message, HP, XP, and restart button content.
- Bottom control deck from y=518 to y=667, with D-pad well on the left and two
  large action-button wells on the right.
- Restart button sprite target at x=82 y=462 w=226 h=66.

Hard rules:
- Do not include gameplay map tiles, item icons, enemy icons, player marker, HP
  values, stat numbers, enemy names, log text, chat text, or sample UI content.
- Do not include labels that will change at runtime.
- Do not bake decorative labels inside live text zones such as player HP/stats,
  combat/enemy, latest message, log, inventory, or end-state copy. Those zones
  must stay clean for Phaser-rendered runtime text.
- Stable decorative labels are allowed only if small and nonessential.
- Leave all dynamic apertures clean and empty enough for live Phaser content.
- Make button wells clean enough to crop separate transparent sprites for idle,
  hover, pressed, active, and disabled states. The active state is the latched
  on-state for Log and Inventory toggles.
- For premium skins, deliver `source-state-sheet.png` using the state-sheet
  guide instead of relying on generated state variants from one idle crop.
- Pressed, hover, disabled, on, and off states must be fixed-size widget
  variants, not elastic or stretched layout treatments.
- Include a restart button treatment that can be cropped into idle, hover,
  pressed, and disabled sprites.
- Also deliver reusable material assets: repeat-safe 96x96 fill tiles and 48x48
  transparent nine-slice frames for panel, LCD, and button surfaces.
- Keep edges crisp; no blur over content apertures.
- No watermark, no brand logos.
```

## Crop Targets

After generation, create a prototype manifest from the same contract profile:

```bash
pnpm -C frontend skin:scaffold rain-city-deck mobileCompact \
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

Then place the generated source artboards at the scaffold's `build.source` and
optional chassis crop `source` paths and run:

```bash
pnpm -C frontend validate:skin-source-packs ../_artifacts/skin-kits/rain-city-deck
pnpm -C frontend skin:review-source ../_artifacts/skin-kits/rain-city-deck --json --fail-on-issue
pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/rain-city-deck
pnpm -C frontend validate:skins
```

The scaffold crop plan creates the fixed runtime assets from the source
artboard: full chassis, button states, status indicator states, and LED states.
With `--state-source`, those widget states are cropped directly from
`source-state-sheet.png`; without it, the scaffold derives state variants from
idle crops. With `--materials-source`, it also crops the six material PNGs from
a separate 160x304-or-taller sheet: panel row at y=0, LCD row at y=104, button
row at y=208, each with the 96x96 fill tile at x=0 and the 48x48 frame at x=104.
Those materials are rendered by Phaser as tiled sprites and nine-slice frames,
not DOM stylesheet surfaces. Only promote a generated artboard into the default
mobile profile after the diagnostics and visual inspection screenshots look cleaner than
`gold-mobile`.

Before building, run `skin:guide --source` against the exact-size generated
source artboard and inspect the overlay. Reject the source if live apertures
contain baked game content, if button wells miss the fixed crop rectangles, or
if material detail crosses into the Phaser text/icon slots.
`skin:review-source` also computes measured preflight tables for live-region
cleanliness, widget/state-sheet crop occupancy/contrast, and material seam
deltas. The `--json` report records issue and warning counts for automation.
Use `--fail-on-issue` in promotion scripts, and treat yellow warnings as review
prompts before building or promoting a generated skin. A generated source pack
with role `default` or `variant` must use `source-state-sheet.png`; prototype
skins may still derive states while exploring.

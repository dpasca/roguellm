# Mobile Skin Generation Prompt

Use this when generating the next production artboard from the gold mobile
layout. The intended output is a source artboard for a skin kit, not a screenshot
of gameplay.

Before using this prompt, choose the `mobilePortrait` or `mobileCompact`
geometry from `SKIN_LAYOUT_CONTRACT_V1.md` and paste the exact live-region and
crop-target tables into the prompt. Do not invent alternate coordinates during
generation; create a new layout contract version first if the geometry changes.
`validate:skins` enforces the matching machine-readable
`SKIN_LAYOUT_CONTRACT_V1.json` geometry for production mobile profiles.

Preferred handoff commands:

```bash
pnpm -C frontend skin:source-prototype rain-city-deck mobileCompact --theme obsidian-rain --out ../_artifacts/skin-kits/rain-city-deck
pnpm --silent -C frontend skin:prompt mobileCompact --theme "premium rain-city cyberdeck, dark glass, brass switches" --output source-pack > ../_artifacts/skin-prompts/rain-city-deck.txt
pnpm -C frontend skin:guide mobilePortrait --view live --out ../_artifacts/skin-guides/mobile-portrait-live.png
pnpm -C frontend skin:guide mobilePortrait --view crops --out ../_artifacts/skin-guides/mobile-portrait-crops.png
pnpm -C frontend skin:guide mobilePortrait --view all --source ../_artifacts/skin-kits/rain-city-deck/source-chassis.png --out ../_artifacts/skin-guides/rain-city-overlay.svg
```

For AI generation, prefer a three-file source pack over one clever flexible UI
image:

- `source-chassis.png`: exact-size clean chassis art for the chosen contract
  profile. It owns permanent shell, bezels, wells, screws, rails, glass frames,
  and decorative labels only.
- `source-widgets.png`: exact-size widget crop art for fixed buttons, toggles,
  and indicators. The scaffold crops idle assets from exact rectangles and then
  derives hover, pressed, disabled, on, and off variants from fixed-size sprites.
- `source-materials.png`: repeat-safe panel/LCD/button fill tiles and transparent
  nine-slice frames. Material detail must be tile-safe or frame-safe, never a
  stretched decorative panel.

This is intentionally closer to a Winamp-style skin pack than a responsive CSS
theme. Phaser owns runtime text, icons, meters, and game state inside fixed
slots; the generated art owns tactile hardware around those slots.

```text
Create a polished mobile cyberdeck game UI skin source pack.

Canvas: 390x844 portrait.
Style: premium skeuomorphic handheld console, dark graphite shell, subtle neon
green/orange status lights, tactile buttons, glass LCD apertures, fine bevels,
small screws, restrained sci-fi hardware details. Beautiful but readable.

Layout:
- Header/status chrome from y=0 to y=44.
- Empty live map aperture at x=22 y=48 w=346 h=281.
- Empty latest-message LCD area at x=24 y=344 w=284 h=86.
- Fixed log-toggle button well at x=315 y=348 w=46 h=32.
- Fixed inventory-toggle button well at x=315 y=392 w=46 h=32, sharing the
  expanded drawer surface with the log.
- Title/model status band around y=454.
- Empty player HP/stat area at x=24 y=488 w=342 h=54.
- Empty combat/enemy area at x=24 y=562 w=342 h=64.
- Terminal/end-state panel area at x=38 y=360 w=314 h=292; it may be a
  reusable empty alert module or an overlay crop, but it must leave room for
  live title, message, HP, XP, and restart button content.
- Bottom control deck from y=646 to y=833, with D-pad well on the left and two
  large action-button wells on the right.
- Restart button sprite target at x=82 y=578 w=226 h=66.

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
  hover, pressed, and disabled states.
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
pnpm -C frontend skin:scaffold rain-city-deck mobilePortrait \
  --label "Rain City Deck" \
  --tags cyberpunk,rain-city \
  --mood premium,nocturnal \
  --palette green,brass,graphite \
  --source source-widgets.png \
  --chassis-source source-chassis.png \
  --materials-source source-materials.png \
  --material-render-mode source \
  --out ../_artifacts/skin-kits/rain-city-deck
```

Then place the generated source artboards at the scaffold's `build.source` and
optional chassis crop `source` paths and run:

```bash
pnpm -C frontend validate:skin-source-packs ../_artifacts/skin-kits/rain-city-deck
pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/rain-city-deck
pnpm -C frontend validate:skins
```

The scaffold crop plan creates the fixed runtime assets from the source
artboard: full chassis, button state variants, status indicator states, and LED
states. With `--materials-source`, it also crops the six material PNGs from a
separate 160x304-or-taller sheet: panel row at y=0, LCD row at y=104, button row
at y=208, each with the 96x96 fill tile at x=0 and the 48x48 frame at x=104.
Those materials are rendered by Phaser as tiled sprites and nine-slice frames,
not DOM stylesheet surfaces. Only promote a generated artboard into the default
mobile profile after the diagnostics and visual inspection screenshots look cleaner than
`gold-mobile`.

Before building, run `skin:guide --source` against the exact-size generated
source artboard and inspect the overlay. Reject the source if live apertures
contain baked game content, if button wells miss the fixed crop rectangles, or
if material detail crosses into the Phaser text/icon slots.

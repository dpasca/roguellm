# Mobile Skin Generation Prompt

Use this when generating the next production artboard from the gold mobile
layout. The intended output is a source artboard for a skin kit, not a screenshot
of gameplay.

```text
Create a polished mobile cyberdeck game UI skin kit artboard.

Canvas: 390x844 portrait.
Style: premium skeuomorphic handheld console, dark graphite shell, subtle neon
green/orange status lights, tactile buttons, glass LCD apertures, fine bevels,
small screws, restrained sci-fi hardware details. Beautiful but readable.

Layout:
- Header/status chrome from y=0 to y=44.
- Empty live map aperture at x=22 y=48 w=346 h=281.
- Empty latest-message LCD area at x=24 y=344 w=284 h=86.
- Fixed log-toggle button well at x=315 y=348 w=46 h=32.
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
- Stable decorative labels are allowed only if small and nonessential.
- Leave all dynamic apertures clean and empty enough for live DOM/Phaser content.
- Make button wells clean enough to crop separate transparent sprites for idle,
  hover, pressed, and disabled states.
- Include a restart button treatment that can be cropped into idle, hover,
  pressed, and disabled sprites.
- Keep edges crisp; no blur over content apertures.
- No watermark, no brand logos.
```

## Crop Targets

After generation, copy the chosen source artboard into a skin directory and add a
`build` section to that directory's `skin-kit.json`.

The build script supports crops like:

```json
{
  "build": {
    "source": "../../sources/generated-mobile-v3.png",
    "crops": [
      {
        "path": "attack-idle.png",
        "rect": { "x": 205, "y": 666, "width": 152, "height": 66 },
        "alphaRadius": 8,
        "variants": "button"
      }
    ]
  }
}
```

Run:

```bash
pnpm -C frontend build:skin-kit src/skins/neo-tokyo-console/fixed/<skin-id>
pnpm -C frontend validate:skins
```

Only promote a generated artboard into the default mobile profile after the
diagnostics and visual inspection screenshots look cleaner than `gold-mobile`.

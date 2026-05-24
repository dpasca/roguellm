# ai-cyberdeck-reference-v1 Source Prototype

Profile: mobileCompact
Theme: neon-shrine
Art blueprint: Premium Mobile Compact Cyberdeck v1

Generated files:

- `ART_DIRECTION.md`: premium mobile visual target and manual rejection gates.
- `source-chassis.png`: clean full-size chassis artboard.
- `source-widgets.png`: full-size widget source with fixed button and indicator crops.
- `source-state-sheet.png`: fixed widget states with separate authored slots.
- `source-materials.png`: material sheet for panel, LCD, and button fill/frame crops.

Suggested next commands:

```bash
pnpm -C frontend skin:scaffold ai-cyberdeck-reference-v1 mobileCompact \
  --label "Ai Cyberdeck Reference V1" \
  --tags cyberpunk,prototype,source-generated \
  --mood premium,nocturnal,tactile \
  --palette cyan,magenta,graphite \
  --source source-widgets.png \
  --chassis-source source-chassis.png \
  --state-source source-state-sheet.png \
  --materials-source source-materials.png \
  --material-render-mode source \
  --out ../_artifacts/skin-kits/ai-cyberdeck-reference-v1
pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/ai-cyberdeck-reference-v1
pnpm -C frontend skin:guide mobileCompact --view all --source ../_artifacts/skin-kits/ai-cyberdeck-reference-v1/source-chassis.png --out ../_artifacts/skin-guides/ai-cyberdeck-reference-v1-overlay.png
```

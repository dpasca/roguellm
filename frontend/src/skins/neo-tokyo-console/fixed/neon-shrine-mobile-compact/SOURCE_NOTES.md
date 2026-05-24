# neon-shrine-mobile-compact Source Prototype

Profile: mobileCompact
Theme: neon-shrine

Generated files:

- `source-chassis.png`: clean full-size chassis artboard.
- `source-widgets.png`: full-size widget source with fixed button and indicator crops.
- `source-state-sheet.png`: fixed widget states with separate authored slots.
- `source-materials.png`: material sheet for panel, LCD, and button fill/frame crops.

Suggested next commands:

```bash
pnpm -C frontend skin:scaffold neon-shrine-mobile-compact mobileCompact \
  --label "Neon Shrine Mobile Compact" \
  --tags cyberpunk,prototype,source-generated \
  --mood premium,nocturnal,tactile \
  --palette cyan,magenta,graphite \
  --source source-widgets.png \
  --chassis-source source-chassis.png \
  --state-source source-state-sheet.png \
  --materials-source source-materials.png \
  --material-render-mode source \
  --out ../_artifacts/skin-kits/neon-shrine-mobile-compact
pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/neon-shrine-mobile-compact
pnpm -C frontend skin:guide mobileCompact --view all --source ../_artifacts/skin-kits/neon-shrine-mobile-compact/source-chassis.png --out ../_artifacts/skin-guides/neon-shrine-mobile-compact-overlay.png
```

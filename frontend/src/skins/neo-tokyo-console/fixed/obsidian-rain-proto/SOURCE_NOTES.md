# obsidian-rain-proto Source Prototype

Profile: mobileCompact
Theme: obsidian-rain

Generated files:

- `source-chassis.png`: clean full-size chassis artboard.
- `source-widgets.png`: full-size widget source with fixed button and indicator crops.
- `source-materials.png`: material sheet for panel, LCD, and button fill/frame crops.

Suggested next commands:

```bash
pnpm -C frontend skin:scaffold obsidian-rain-proto mobileCompact \
  --label "Obsidian Rain Proto" \
  --tags cyberpunk,prototype,source-generated \
  --mood premium,nocturnal,tactile \
  --palette cyan,magenta,graphite \
  --source source-widgets.png \
  --chassis-source source-chassis.png \
  --materials-source source-materials.png \
  --material-render-mode source \
  --out ../_artifacts/skin-kits/obsidian-rain-proto
pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/obsidian-rain-proto
pnpm -C frontend skin:guide mobileCompact --view all --source ../_artifacts/skin-kits/obsidian-rain-proto/source-chassis.png --out ../_artifacts/skin-guides/obsidian-rain-proto-overlay.png
```

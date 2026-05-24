# ai-cyberdeck-reference-v1 Art Direction

Blueprint: Premium Mobile Compact Cyberdeck v1
Contract profile: mobileCompact
Prototype theme preset: neon-shrine
Primary blueprint target: mobileCompact

Create one coherent fixed-size mobile handheld console skin that can be cropped into Phaser runtime assets without CSS layout, stretching, or screenshot collage cleanup.

Winamp-skin-level skeuomorphic game hardware: a compact cyberdeck with tactile controls, consistent material language, crisp bevels, readable apertures, and authored state sprites.

## Source Responsibilities

### source-chassis.png

Exact-size clean chassis artboard with shell, frames, apertures, and permanent hardware only.

Must:
- Use the target profile dimensions exactly.
- Leave all live regions clean enough for Phaser runtime content.
- Make the full artboard read as a single object at phone scale.

Must not:
- No gameplay screenshots, map contents, character icons, HP values, item names, enemy names, model labels, or log text.

### source-widgets.png

Exact-size widget placement artboard for crop alignment and fallback widget crops.

Must:
- Align every button, toggle, and indicator to the layout contract rectangles.
- Keep label areas clean unless a label is permanent and intentionally hidden from Phaser runtime text.

Must not:
- Do not shift or resize controls to match generated art; art must match the contract.

### source-state-sheet.png

Authored fixed-size state sprites for all buttons, toggles, status indicators, and LEDs.

Must:
- Provide visibly distinct idle, hover, pressed, disabled, active, ready, thinking, error, offline, on, and off states where required.
- Use material, lighting, inset depth, glow, latch position, or occlusion changes rather than simple color-only edits.
- Preserve the exact state-sheet slot sizes.

Must not:
- Do not collapse states into one idle crop or rely on Phaser tinting to create production states.

### source-materials.png

Repeat-safe panel/LCD/button fills and transparent nine-slice frames.

Must:
- Keep fill tiles seamless at 96x96.
- Keep frame crops transparent, edge-focused, and safe for nine-slice scaling.
- Avoid unique center ornaments that would visibly repeat.

## Widget Families

### Action Buttons

Assets: `attack`, `run`, `restart`
Shape: large rectangular hardware slabs
States: `idle`, `hover`, `pressed`, `disabled`

Must:
- Share bevel depth, screw/rivet logic, and light direction.
- Pressed states must visibly sink inward.
- Disabled states must look physically unavailable, not merely transparent.

### Dpad

Assets: `moveN`, `moveS`, `moveE`, `moveW`
Shape: four fixed directional pads around a recessed cross well
States: `idle`, `hover`, `pressed`, `disabled`

Must:
- Directional arrows should be legible at phone scale.
- The four buttons should feel like one control assembly.

### Drawer Toggles

Assets: `log`, `inventory`
Shape: small latched hardware toggles
States: `idle`, `hover`, `pressed`, `active`, `disabled`

Must:
- Active states must read as latched/on.
- Pressed states must read as momentary.

### Status Indicator

Assets: `status`
Shape: compact model/status capsule
States: `ready`, `thinking`, `error`, `offline`

Must:
- Ready, thinking, error, and offline must be distinguishable by more than text.
- Keep the capsule readable in the fixed status rectangle.

### Combat Led

Assets: `combatLed`
Shape: small physical binary LED
States: `on`, `off`

Must:
- On state needs emitted light or bloom within the crop.
- Off state must still show the physical lens.

### Meters

Assets: `playerHp`, `enemyHp`, `playerStats`
Shape: recessed live readout wells


Must:
- Art frames the meter and stat wells; Phaser owns fills, labels, and values.
- Do not paint sample fill levels.

## Quality Gates

- At first glance the source pack must look like one coherent premium handheld device.
- The design must not read as a Frankenstein collage of unrelated panels.
- The compact phone screenshot must reserve enough space for the log drawer and latest-message surface.
- Buttons and toggles must have authored states with clear physical differences.
- Live regions must be visually calm enough for Phaser text and icons to remain dominant.
- Material crops must be tile-safe and nine-slice-safe before promotion.
- The production visual bench must pass movement, combat, log, inventory, pointer-state, defeat, victory, restart, and diagnostics scenarios.
- Human review may reject a skin that passes metrics if it does not feel like a beautiful finished object.

## Forbidden Dynamic Content

- map tiles
- player marker
- enemy icons
- item icons
- HP numbers
- HP fill values
- attack/defense/XP/tile values
- enemy names
- inventory item names
- log or chat messages
- generated game title
- runtime model status text
- defeat or victory body copy

# premium-cyberdeck-v2 Art Direction

Blueprint: Premium Mobile Compact Cyberdeck v1
Contract profile: mobileCompact
Primary blueprint target: mobileCompact

Create one coherent fixed-size mobile handheld console skin that can be cropped into Phaser runtime assets without CSS layout, stretching, or screenshot collage cleanup.

Winamp-skin-level skeuomorphic game hardware: a compact cyberdeck with tactile controls, consistent material language, crisp bevels, readable apertures, and authored state sprites.

## Layout Intent

### Outer Shell

Full device body and permanent hardware identity.
Must:
- Read as one manufactured object, not panels pasted together.
- Use one light direction, one bevel language, and one shared material finish.
- Include permanent shell details such as screws, rails, vents, seams, latches, indicator wells, and subtle branded chassis labels.
Must not:
- Do not bake runtime status text, game content, or sample data into the shell.
- Do not use loose floating cards on a plain background.

### Map Aperture (map)

Primary tactical screen for the Phaser board.
Must:
- Frame the map as a glass or recessed instrument bay.
- Keep the interior clean enough for bright tiles, scanner overlays, player reticle, enemies, and items.
- Use hardware around the aperture, not decoration inside the live map.
Must not:
- Do not draw sample map tiles, icons, grid contents, player markers, or enemies in source art.

### Message Deck (latest)

Closed-state latest-message LCD plus drawer toggle wells.
Must:
- Make the latest message feel like a real LCD strip with a readable text well.
- Reserve distinct physical wells for Log and Inventory toggles.
- Leave the dynamic message area empty.
Must not:
- Do not include sample log text or decorative text inside the runtime message slot.

### Log Drawer (log)

Expanded story/history reading surface.
Must:
- Frame the drawer as an extended instrument display, not a small leftover panel.
- Keep row content space quiet so top-first log rows remain readable.

### Inventory Drawer (inventory)

Expanded inventory list and action surface.
Must:
- Share the same drawer architecture as the log while leaving item rows clean.
- Reserve visual structure for row badges and action chips without baking item names.

### Identity And Player (player)

Game title, player icon, HP meter, and stat hardware.
Must:
- Use compact readout plates that fit inside the fixed player slot.
- Make meter wells look physical while leaving fills and values to Phaser.
Must not:
- Do not draw HP numbers, stat values, player names, tile names, or fake meter fills.

### Combat Row (combat)

Enemy status or exploration mode plate.
Must:
- Provide a strong mode/status bay for combat versus explore state.
- Leave enemy icon, enemy name, and enemy HP values to Phaser.

### Control Deck (controls)

Bottom handheld controls.
Must:
- Make the D-pad and action buttons feel touchable and fixed in place.
- Use larger action-button slabs and a smaller directional cluster with matching bevel physics.
- Reserve clear crop rectangles for every state.

### Terminal Overlay (endState)

Defeat/victory terminal panel.
Must:
- Provide a dedicated overlay frame that can carry victory/defeat copy and restart hardware.
- Keep the restart button crop aligned and visibly related to the action-button family.

## Source Files

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

## State Language

- `idle`: Lit and available, neutral depth.
- `hover`: Slight brighter rim, touch focus, no geometry drift.
- `pressed`: Inset/sunken, reduced top highlight, stronger lower shadow.
- `disabled`: Power removed, desaturated or guarded, still visible as hardware.
- `active`: Latched/on, clear persistent state distinct from pressed.
- `ready`: Stable green/primary signal.
- `thinking`: Animated-looking pulse or amber/secondary signal in the static crop.
- `error`: Alert/red signal with hardware still intact.
- `offline`: Dark lens or unpowered capsule.
- `on`: Emissive LED lens.
- `off`: Unlit physical lens.

## Material Rules

- Panel material should support quiet repeated backgrounds behind player, combat, inventory, and end-state panels.
- LCD material should support high-contrast message/log text without noisy centers.
- Button material should support tactile controls and survive nine-slice framing.
- Frames should carry detail on borders and corners, not in stretch-sensitive centers.
- All material art should share the same light direction and manufacturing logic as the chassis.

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

## Quality Gates

- At first glance the source pack must look like one coherent premium handheld device.
- The design must not read as a Frankenstein collage of unrelated panels.
- The compact phone screenshot must reserve enough space for the log drawer and latest-message surface.
- Buttons and toggles must have authored states with clear physical differences.
- Live regions must be visually calm enough for Phaser text and icons to remain dominant.
- Material crops must be tile-safe and nine-slice-safe before promotion.
- The production visual bench must pass movement, combat, log, inventory, pointer-state, defeat, victory, restart, and diagnostics scenarios.
- Human review may reject a skin that passes metrics if it does not feel like a beautiful finished object.

## Required Review Scenarios

- movement
- combat
- log
- inventory
- hover-run
- press-run
- defeat
- victory
- restart
- diagnostics

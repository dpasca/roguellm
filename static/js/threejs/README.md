# ThreeJS Renderer Modules

This directory contains the modular components of the ThreeJS renderer for the roguelike game.

## Architecture Overview

The renderer has been refactored from a single large class into focused, single-responsibility modules:

```
ThreeJSRenderer (main coordinator)
├── SceneManager (scene setup, camera, lighting, renderer)
├── MapRenderer (tile rendering, fog of war)
├── EntityRenderer (enemies, items, player)
├── ArrowController (3D movement arrows, interactions)
└── EventHandler (mouse events, click handling)
```

## Module Descriptions

### 1. SceneManager.js
**Purpose**: Core Three.js scene setup and management
- Scene creation and configuration
- Camera setup (orthographic, isometric view)
- Renderer initialization with shadow mapping
- Lighting setup (ambient + directional lights)
- Orbit controls
- Grid helper
- Resize handling

**Dependencies**: THREE.js
**Exports**: `window.SceneManager`

### 2. MapRenderer.js
**Purpose**: Map tile rendering and fog of war
- Tile creation with height variation
- Fog of war implementation (explored/unexplored tiles)
- Wireframe borders for tiles
- Cardinal direction markers
- Tile raycasting support

**Dependencies**: THREE.js, scene from SceneManager
**Exports**: `window.MapRenderer`

### 3. EntityRenderer.js
**Purpose**: Game entity rendering (enemies, items, player)
- Enemy rendering (red boxes)
- Item rendering (green cylinders)
- Player rendering (blue box, taller)
- Shadow casting/receiving
- Player position tracking

**Dependencies**: THREE.js, scene from SceneManager
**Exports**: `window.EntityRenderer`

### 4. ArrowController.js
**Purpose**: 3D movement arrows and interactions
- Arrow creation and positioning
- Movement validation
- Mouse hover effects
- Click handling for movement
- Arrow scaling based on camera distance
- Custom event dispatching

**Dependencies**: THREE.js, scene, camera, renderer from SceneManager
**Exports**: `window.ArrowController`

### 5. EventHandler.js
**Purpose**: Event coordination and map click handling
- Map click detection
- Coordinate conversion (screen to world to grid)
- Arrow click integration
- Game state management

**Dependencies**: SceneManager, MapRenderer, ArrowController
**Exports**: `window.EventHandler`

### 6. ThreeJSRenderer.js (refactored)
**Purpose**: Main coordinator class
- Module initialization and coordination
- Game state updates
- Animation loop
- Public API maintenance (compatibility)

**Dependencies**: All above modules
**Exports**: `window.ThreeJSRenderer`

## Loading Order

The modules must be loaded in dependency order:

```html
<script src="/static/js/threejs/SceneManager.js"></script>
<script src="/static/js/threejs/MapRenderer.js"></script>
<script src="/static/js/threejs/EntityRenderer.js"></script>
<script src="/static/js/threejs/ArrowController.js"></script>
<script src="/static/js/threejs/EventHandler.js"></script>
<script src="/static/js/threejs-renderer.js"></script>
```

## Benefits of Refactoring

1. **Single Responsibility**: Each module has a clear, focused purpose
2. **Easier Maintenance**: Smaller, more manageable code files
3. **Better Testing**: Modules can be tested in isolation
4. **Improved Readability**: Logic is organized by functionality
5. **Reusability**: Modules can be reused or replaced independently
6. **Reduced Complexity**: Each file is easier to understand
7. **Better Debugging**: Issues can be isolated to specific modules

## API Compatibility

The refactored `ThreeJSRenderer` maintains the same public API as the original:

```javascript
const renderer = new ThreeJSRenderer(container, gameState);
renderer.updateGameMap(gameState);
renderer.onMapClick(event);
renderer.dispose();
```

## Constants

Key constants are defined in each module where they're used:
- `TILE_SIZE`: 1 (grid tile size)
- `ENTITY_SIZE`: 0.5 (enemy/item size)
- `PLAYER_SIZE`: 0.6 (player character size)
- `ARROW_SIZE`: 0.4 (movement arrow size)
- `ARROW_DISTANCE`: 1.5 (distance from player)
- `FRUSTUM_SIZE`: 15 (camera view size)

## Future Enhancements

The modular structure makes it easy to add new features:
- Animations module for smooth transitions
- Effects module for particles, lighting effects
- Audio module for spatial 3D audio
- Materials module for advanced texturing
- LOD (Level of Detail) module for performance optimization
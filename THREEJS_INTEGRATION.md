# Three.js Integration for RogueLLM

## Overview

This implementation adds 3D rendering capabilities to your roguelike game using Three.js while maintaining the existing Vue.js architecture. The approach provides a hybrid solution where:

- **Vue.js** handles UI, game state, and user interactions
- **Three.js** renders the 3D game world
- **Seamless switching** between 2D and 3D modes

## Architecture

### Hybrid Approach Benefits

1. **Keep existing strengths**: Vue.js excels at UI management, reactive data, and WebSocket handling
2. **Add 3D visualization**: Three.js provides immersive 3D rendering without disrupting game logic
3. **Gradual migration**: You can switch between 2D and 3D modes during development
4. **Maintainable**: Clear separation of concerns between UI and rendering

### File Structure

```
static/
├── js/
│   ├── threejs-renderer.js    # Three.js rendering engine
│   └── createApp.js           # Modified Vue.js app with 3D integration
├── css/
│   └── threejs.css           # 3D-specific styling
├── game.html                 # Main game page with 3D support
└── threejs-demo.html         # Standalone demo for testing
```

## Features Implemented

### 3D Rendering Features

1. **Tile-based 3D world**: Each game tile becomes a 3D mesh with appropriate colors
2. **Height variation**: Mountains and hills have different heights for visual depth
3. **Dynamic lighting**: Ambient, directional, and point lights create atmosphere
4. **Smooth animations**: Player movement and entity animations
5. **Interactive camera**: OrbitControls for development/debugging
6. **Click-to-move**: Click on tiles to move the player
7. **Real-time updates**: Synchronizes with game state changes

### Visual Elements

- **Tiles**: Colored 3D boxes representing different terrain types
- **Player**: Blue cone that rotates and moves smoothly
- **Enemies**: Red spheres with floating animation
- **Items**: Green spheres with rotation and floating effects
- **Fog of war**: Only explored tiles are visible
- **Shadows**: Realistic shadow casting for depth perception

### UI Integration

- **Mode toggle**: Switch between 2D and 3D rendering
- **Preserved UI**: All existing menus, inventory, and combat UI remain functional
- **Responsive design**: 3D viewport adapts to screen size
- **Performance**: Efficient rendering with proper cleanup

## Implementation Details

### ThreeJSRenderer Class

The core `ThreeJSRenderer` class handles:

```javascript
class ThreeJSRenderer {
    constructor(container, gameState)
    init()                          // Setup scene, camera, renderer
    setupLighting()                 // Configure lighting
    updateGameMap(gameState)        // Sync with game state
    createTile(x, y, cellType)      // Create 3D tile
    updateEntities(gameState)       // Update enemies/items
    updatePlayerPosition(pos)       // Move player
    onMapClick(event)              // Handle click interactions
    animate()                      // Render loop
    dispose()                      // Cleanup
}
```

### Vue.js Integration

Modified Vue app includes:

```javascript
data() {
    return {
        // ... existing data
        threeRenderer: null,
        use3D: true
    }
},
methods: {
    toggle3D()              // Switch rendering modes
    init3DRenderer()        // Initialize Three.js
    dispose3DRenderer()     // Cleanup Three.js
    update3DScene()         // Sync with game state
    moveToPosition(x, y)    // Handle 3D click movement
}
```

## Getting Started

### 1. Test the Demo

Visit `/static/threejs-demo.html` to see the 3D rendering in action:

```bash
# Start your server
python main.py

# Visit: http://localhost:8000/static/threejs-demo.html
```

### 2. Enable 3D in Main Game

The main game at `/static/game.html` now includes:
- 3D/2D toggle buttons
- Automatic Three.js initialization
- Click-to-move functionality

### 3. Customize the 3D World

#### Modify Tile Appearance

```javascript
// In threejs-renderer.js, modify createTile()
createTile(x, y, cellType) {
    const geometry = new THREE.BoxGeometry(1, 0.1, 1);

    // Custom materials based on cell type
    if (cellType.name.includes('water')) {
        material = new THREE.MeshPhongMaterial({
            color: cellType.map_color,
            transparent: true,
            opacity: 0.8
        });
    }
    // ... more customizations
}
```

#### Add New Entity Types

```javascript
// Add different shapes for different entities
createEntity(x, y, color, type) {
    let geometry;
    switch(type) {
        case 'enemy':
            geometry = new THREE.SphereGeometry(0.2, 8, 6);
            break;
        case 'item':
            geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
            break;
        case 'npc':
            geometry = new THREE.ConeGeometry(0.2, 0.6, 6);
            break;
    }
    // ... rest of implementation
}
```

## Performance Considerations

### Optimization Strategies

1. **Efficient Updates**: Only update changed tiles/entities
2. **Object Pooling**: Reuse geometries and materials
3. **Level of Detail**: Reduce complexity for distant objects
4. **Frustum Culling**: Three.js automatically culls off-screen objects
5. **Proper Disposal**: Clean up resources when switching modes

### Memory Management

```javascript
// Proper cleanup in dispose()
dispose() {
    // Cancel animation
    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
    }

    // Dispose geometries and materials
    this.scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
    });

    // Remove renderer
    this.renderer.dispose();
}
```

## Future Enhancements

### Immediate Improvements

1. **Better Models**: Replace basic shapes with detailed 3D models
2. **Particle Effects**: Add spell effects, combat animations
3. **Advanced Lighting**: Dynamic day/night cycles
4. **Sound Integration**: 3D positional audio
5. **Camera Modes**: First-person, third-person views

### Advanced Features

1. **Procedural Generation**: 3D terrain generation
2. **Physics**: Collision detection, realistic movement
3. **Multiplayer**: Synchronized 3D worlds
4. **VR Support**: WebXR integration for VR headsets
5. **Advanced Shaders**: Custom materials and effects

## Comparison: Web Game Development Approaches

### Traditional Game Engines vs Web Technologies

| Aspect | Unity WebGL | Three.js + Vue | Pure Canvas/WebGL |
|--------|-------------|----------------|-------------------|
| **Learning Curve** | Steep (C#) | Moderate (JS) | Steep (Low-level) |
| **UI Management** | Complex | Excellent (Vue) | Manual |
| **3D Capabilities** | Excellent | Good | Excellent |
| **Web Integration** | Limited | Native | Native |
| **File Size** | Large | Moderate | Small |
| **Development Speed** | Slow | Fast | Very Slow |

### Why This Hybrid Approach Works

1. **Leverages Web Standards**: No plugins, works everywhere
2. **Familiar Technologies**: JavaScript, HTML, CSS
3. **Rapid Prototyping**: Quick iterations and testing
4. **Scalable**: Can add complexity gradually
5. **Maintainable**: Clear separation of concerns

## Conclusion

This Three.js integration provides a solid foundation for transforming your roguelike into a 3D game while preserving all existing functionality. The hybrid approach allows you to:

- **Experiment** with 3D rendering without breaking existing features
- **Iterate quickly** on visual improvements
- **Scale gradually** from simple 3D to complex game worlds
- **Maintain** the excellent UI and game logic you've already built

The implementation is production-ready and can be extended with more advanced 3D features as needed. Start with the demo, experiment with the toggle, and gradually enhance the 3D world to match your vision!
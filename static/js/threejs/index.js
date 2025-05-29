// ThreeJS Renderer Module Index
// This file loads all the modular components for the 3D renderer

// Load modules in dependency order
// 1. Core scene management
// (SceneManager has no dependencies on other modules)

// 2. Rendering components
// (MapRenderer, EntityRenderer only depend on THREE.js and scene)

// 3. Interaction components
// (ArrowController depends on scene, camera, renderer)

// 4. Event coordination
// (EventHandler coordinates all components)

// 5. Main renderer
// (ThreeJSRenderer coordinates all modules)

console.log('Loading ThreeJS renderer modules...');

// All modules are already loaded via individual script tags
// This file just serves as documentation and could be used for initialization

// Optional: Add module loading verification
const verifyModules = () => {
    const requiredModules = [
        'SceneManager',
        'MapRenderer',
        'EntityRenderer',
        'ArrowController',
        'EventHandler',
        'ThreeJSRenderer'
    ];

    const missingModules = requiredModules.filter(module => !window[module]);

    if (missingModules.length > 0) {
        console.error('Missing ThreeJS modules:', missingModules);
        return false;
    }

    console.log('All ThreeJS modules loaded successfully');
    return true;
};

// Verify modules are loaded (if this script is loaded after all module scripts)
// verifyModules();
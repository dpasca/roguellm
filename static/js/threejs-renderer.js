class ThreeJSRenderer {
    constructor(container, gameState) {
        this.container = container;
        this.gameState = gameState;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.tileGroup = null; // Group for tiles
        this.entityGroup = null; // Group for entities (enemies, items)
        this.playerMesh = null;
        this.animationId = null;

        // Constants for isometric view
        this.TILE_SIZE = 1;
        this.ENTITY_SIZE = 0.5;
        this.PLAYER_SIZE = 0.6;

        console.log("ThreeJSRenderer constructor called with gameState:", gameState);
        this.init();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);

        // Camera setup - Orthographic for isometric view
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const frustumSize = 15; // Smaller for better zoom
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            frustumSize / -2,
            1,
            1000
        );
        // Position for an isometric-like view
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);
        this.camera.zoom = 1; // Initial zoom
        this.camera.updateProjectionMatrix();

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        // No shadow map needed for MeshBasicMaterial, can be enabled later if materials change
        // this.renderer.shadowMap.enabled = true;
        // this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Lighting (simplified for basic materials, can be enhanced)
        this.setupLighting();

        // Controls
        if (window.THREE && THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.enableRotate = true; // Allow rotation for better viewing
            this.controls.screenSpacePanning = true;
            this.controls.target.set(0, 0, 0);
        }

        // Groups for organization
        this.tileGroup = new THREE.Group();
        this.scene.add(this.tileGroup);

        this.entityGroup = new THREE.Group();
        this.scene.add(this.entityGroup);

        // Add a grid helper for better spatial reference
        const gridSize = 20; // Grid size
        const divisions = 20; // Number of divisions
        const gridHelper = new THREE.GridHelper(gridSize, divisions, 0x444444, 0x222222);
        gridHelper.position.y = -0.01; // Slightly below the tiles
        this.scene.add(gridHelper);

        // Handle container resize with ResizeObserver
        this.setupResizeObserver();

        // Fallback window resize handler
        window.addEventListener('resize', () => this.onWindowResize());

        // Start render loop
        this.animate();
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Brighter ambient
        this.scene.add(ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(10, 15, 5);
        // No shadows needed for basic materials
        // directionalLight.castShadow = true;
        // ... (shadow map setup removed for now)
        this.scene.add(directionalLight);
    }

    setupResizeObserver() {
        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target === this.container) {
                        this.onWindowResize();
                    }
                }
            });
            this.resizeObserver.observe(this.container);
        }
    }

    clearScene() {
        // Remove all children from tileGroup
        while (this.tileGroup.children.length > 0) {
            const child = this.tileGroup.children[0];
            this.tileGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        // Remove all children from entityGroup
        while (this.entityGroup.children.length > 0) {
            const child = this.entityGroup.children[0];
            this.entityGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        // Remove player mesh
        if (this.playerMesh) {
            this.scene.remove(this.playerMesh);
            if (this.playerMesh.geometry) this.playerMesh.geometry.dispose();
            if (this.playerMesh.material) this.playerMesh.material.dispose();
            this.playerMesh = null;
        }
    }

    updateGameMap(gameState) {
        if (!gameState || !gameState.cell_types || !gameState.explored) {
            console.warn("ThreeJSRenderer: Game state not ready for map update.", gameState);
            return;
        }

        // Store the latest game state
        this.gameState = gameState;
        console.log("ThreeJSRenderer: Updating game map", gameState);
        this.clearScene(); // Clear everything before redrawing

        const mapHeight = gameState.cell_types.length;
        const mapWidth = gameState.cell_types[0].length;
        const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
        const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

        console.log(`Map dimensions: ${mapWidth}x${mapHeight}, center: (${mapCenterX}, ${mapCenterZ})`);

        // Create tiles with fog of war effect
        let tilesCreated = 0;
        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                const isExplored = gameState.explored[y][x];
                const isAdjacent = this.isAdjacentToExplored(x, y, gameState.explored, mapWidth, mapHeight);

                if (isExplored || isAdjacent) {
                    this.createTile(x, y, gameState.cell_types[y][x], mapCenterX, mapCenterZ, isExplored);
                    tilesCreated++;
                }
            }
        }
        console.log(`Created ${tilesCreated} tiles`);

        // Update entities (enemies, items)
        this.updateEntities(gameState, mapCenterX, mapCenterZ);

        // Update player position
        if (gameState.player_pos) {
            this.createPlayer(gameState.player_pos, mapCenterX, mapCenterZ);
        }

        // Adjust camera to look at the center of the map
        if (this.controls) {
            this.controls.target.set(0, 0, 0); // Assuming map is centered at origin
        }

        console.log("ThreeJSRenderer: Map update complete. Scene children:", this.scene.children.length);
    }

    isAdjacentToExplored(x, y, explored, mapWidth, mapHeight) {
        // Check if this tile is adjacent to any explored tile
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue; // Skip the tile itself

                const nx = x + dx;
                const ny = y + dy;

                // Check bounds
                if (nx >= 0 && nx < mapWidth && ny >= 0 && ny < mapHeight) {
                    if (explored[ny][nx]) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    createTile(x, y, cellType, mapCenterX, mapCenterZ, isExplored = true) {
        console.log(`Creating tile at (${x}, ${y}) with type:`, cellType, `explored: ${isExplored}`);

        // Use PlaneGeometry for flat tiles
        const geometry = new THREE.PlaneGeometry(this.TILE_SIZE * 0.9, this.TILE_SIZE * 0.9); // Make tiles more visible

        // Handle fog of war colors
        let color;
        let opacity;

        if (isExplored) {
            // Explored tiles: full color and brightness
            color = new THREE.Color(cellType.map_color || '#888888');
            color.lerp(new THREE.Color(0xffffff), 0.2); // Mix 20% white for brightness
            opacity = 1.0;
        } else {
            // Unexplored but adjacent tiles: darker and more transparent
            color = new THREE.Color(cellType.map_color || '#888888');
            color.lerp(new THREE.Color(0x000000), 0.6); // Mix 60% black for darkness
            opacity = 0.4;
        }

        console.log(`Tile color for explored=${isExplored}:`, color);

        const material = new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: !isExplored, // Only unexplored tiles are transparent
            opacity: opacity
        });

        const tile = new THREE.Mesh(geometry, material);

        // Position tiles on the XZ plane
        tile.position.set(
            x * this.TILE_SIZE - mapCenterX,
            0, // Tiles are flat on the ground
            y * this.TILE_SIZE - mapCenterZ
        );
        tile.rotation.x = -Math.PI / 2; // Rotate to be flat

        // Add height variation (simple elevation for now)
        let elevation = 0;
        if (cellType.name.toLowerCase().includes('mountain')) {
            elevation = 0.5 * this.TILE_SIZE;
        } else if (cellType.name.toLowerCase().includes('hill')) {
            elevation = 0.2 * this.TILE_SIZE;
        }
        tile.position.y = elevation;

        console.log(`Tile positioned at:`, tile.position);
        this.tileGroup.add(tile);

        // Add wireframe border for better visibility
        const wireframeGeometry = new THREE.PlaneGeometry(this.TILE_SIZE, this.TILE_SIZE);
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: isExplored ? 0x666666 : 0x333333, // Dimmer wireframe for unexplored
            wireframe: true,
            side: THREE.DoubleSide,
            transparent: !isExplored,
            opacity: isExplored ? 1.0 : 0.3
        });
        const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        wireframe.position.copy(tile.position);
        wireframe.position.y += 0.001; // Slightly above the tile
        wireframe.rotation.x = -Math.PI / 2;

        this.tileGroup.add(wireframe);
    }

    updateEntities(gameState, mapCenterX, mapCenterZ) {
        // Add enemies
        if (gameState.enemies) {
            gameState.enemies.forEach(enemy => {
                if (!enemy.is_defeated) {
                    this.createEntity(
                        enemy.x,
                        enemy.y,
                        0xff4444, // Red for enemies
                        'enemy',
                        mapCenterX,
                        mapCenterZ,
                        this.ENTITY_SIZE
                    );
                }
            });
        }

        // Add items
        if (gameState.items) {
            gameState.items.forEach(item => {
                this.createEntity(
                    item.x,
                    item.y,
                    0x44ff44, // Green for items
                    'item',
                    mapCenterX,
                    mapCenterZ,
                    this.ENTITY_SIZE * 0.8 // Items slightly smaller
                );
            });
        }
    }

    createEntity(gridX, gridY, color, type, mapCenterX, mapCenterZ, size) {
        let geometry;
        if (type === 'item') {
            geometry = new THREE.CylinderGeometry(size / 2, size / 2, size * 0.5, 16); // Cylinder for items
        } else {
            geometry = new THREE.BoxGeometry(size, size, size); // Box for enemies
        }
        const material = new THREE.MeshBasicMaterial({ color: color });

        const entity = new THREE.Mesh(geometry, material);
        entity.position.set(
            gridX * this.TILE_SIZE - mapCenterX,
            size / 2 + 0.05, // Position above the tile
            gridY * this.TILE_SIZE - mapCenterZ
        );
        // No shadows for basic material
        // entity.castShadow = true;

        this.entityGroup.add(entity);
    }

    createPlayer(playerPos, mapCenterX, mapCenterZ) {
        if (this.playerMesh) { // Should be cleared by clearScene, but defensive check
            this.scene.remove(this.playerMesh);
            if (this.playerMesh.geometry) this.playerMesh.geometry.dispose();
            if (this.playerMesh.material) this.playerMesh.material.dispose();
        }

        const geometry = new THREE.BoxGeometry(this.PLAYER_SIZE, this.PLAYER_SIZE * 1.5, this.PLAYER_SIZE); // Taller box for player
        const material = new THREE.MeshBasicMaterial({ color: 0x4dabf7 }); // Blue

        this.playerMesh = new THREE.Mesh(geometry, material);

        if (playerPos && playerPos.length >= 2) {
            this.playerMesh.position.set(
                playerPos[0] * this.TILE_SIZE - mapCenterX,
                (this.PLAYER_SIZE * 1.5) / 2 + 0.05, // Position above the tile
                playerPos[1] * this.TILE_SIZE - mapCenterZ
            );
        } else {
            // Default position if playerPos is invalid
            this.playerMesh.position.set(-mapCenterX, (this.PLAYER_SIZE * 1.5) / 2 + 0.05, -mapCenterZ);
        }
        // No shadows for basic material
        // this.playerMesh.castShadow = true;

        this.scene.add(this.playerMesh); // Add directly to scene, not entityGroup
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Update controls if available
        if (this.controls) {
            this.controls.update();
        }

        // No complex animations for now

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const frustumSize = 15; // Must match init

        this.camera.left = frustumSize * aspect / -2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        console.log(`3D renderer resized to: ${this.container.clientWidth}x${this.container.clientHeight}`);
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('resize', this.onWindowResize);

        // Dispose ResizeObserver
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        this.clearScene(); // Clear all objects

        if (this.tileGroup) this.scene.remove(this.tileGroup);
        if (this.entityGroup) this.scene.remove(this.entityGroup);

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        this.scene = null;
        this.camera = null;
    }

    onMapClick(event) {
        // Convert click coordinates to normalized device coordinates (NDC)
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycasting
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        // Intersect with the tileGroup (which contains the ground planes)
        const intersects = raycaster.intersectObjects(this.tileGroup.children);

        if (intersects.length > 0) {
            const intersect = intersects[0];
            const point = intersect.point; // The world coordinates of the click

            // Assuming map is centered and TILE_SIZE is 1 for simplicity in this example
            // Need to know map dimensions if not centered or TILE_SIZE changes
            const mapHeight = this.gameState.cell_types.length;
            const mapWidth = this.gameState.cell_types[0].length;
            const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
            const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

            // Convert world coordinates back to grid coordinates
            const clickedGridX = Math.floor((point.x + mapCenterX + this.TILE_SIZE / 2) / this.TILE_SIZE);
            const clickedGridY = Math.floor((point.z + mapCenterZ + this.TILE_SIZE / 2) / this.TILE_SIZE);

            // Clamp to map bounds
            const finalX = Math.max(0, Math.min(mapWidth - 1, clickedGridX));
            const finalY = Math.max(0, Math.min(mapHeight - 1, clickedGridY));

            console.log(`3D Click: World(${point.x.toFixed(2)}, ${point.z.toFixed(2)}), Grid(${finalX}, ${finalY})`);

            return { x: finalX, y: finalY };
        }
        return null; // Click was not on a tile
    }
}

// Export for use in other modules
window.ThreeJSRenderer = ThreeJSRenderer;
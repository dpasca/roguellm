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
        this.cardinalMarkersCreated = false; // Flag for cardinal markers

        // 3D Movement Arrows
        this.arrowGroup = null; // Group for 3D directional arrows
        this.arrows = {}; // Store individual arrow meshes
        this.hoveredArrow = null; // Track which arrow is being hovered

        // Constants for isometric view
        this.TILE_SIZE = 1;
        this.ENTITY_SIZE = 0.5;
        this.PLAYER_SIZE = 0.6;
        this.ARROW_SIZE = 0.4; // Increased size for better visibility
        this.ARROW_DISTANCE = 1.5; // Increased distance from player

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
        // Enable shadow mapping for better 3D appearance
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

        // Arrow group for 3D movement controls
        this.arrowGroup = new THREE.Group();
        this.scene.add(this.arrowGroup);

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

        // Add mouse event handlers for arrow interactions
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
        this.renderer.domElement.addEventListener('click', (event) => this.onArrowClick(event));

        // Add cardinal direction markers for reference
        // this.createCardinalMarkers(); // Moved to updateGameMap

        // Start render loop
        this.animate();
    }

    setupLighting() {
        // Ambient light - reduced intensity to allow directional light to show shape
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Directional light (sun) - main light source
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 15, 5);
        directionalLight.castShadow = true;

        // Configure shadow camera for better quality
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
        directionalLight.shadow.camera.top = 20;
        directionalLight.shadow.camera.bottom = -20;

        this.scene.add(directionalLight);

        // Add a subtle fill light from the opposite direction
        const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.3); // Sky blue fill
        fillLight.position.set(-5, 8, -5);
        this.scene.add(fillLight);
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

        // Clear 3D arrows
        this.clearArrows();

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
                const isCurrentPlayerPosition = gameState.player_pos &&
                    gameState.player_pos[0] === x && gameState.player_pos[1] === y;
                const isAdjacent = this.isAdjacentToExplored(x, y, gameState.explored, mapWidth, mapHeight);

                // Show tile if it's explored, player's current position, or adjacent to explored
                if (isExplored || isCurrentPlayerPosition || isAdjacent) {
                    this.createTile(x, y, gameState.cell_types[y][x], mapCenterX, mapCenterZ,
                        isExplored || isCurrentPlayerPosition);
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

        // Add cardinal direction markers for reference
        // this.createCardinalMarkers(); // Moved to updateGameMap

        // Create cardinal markers once gameState is available and map is set up
        if (!this.cardinalMarkersCreated && this.gameState && this.gameState.map_width) {
            this.createCardinalMarkers();
            this.cardinalMarkersCreated = true;
        }
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

        const material = new THREE.MeshLambertMaterial({
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
        tile.receiveShadow = true; // Enable shadow receiving

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
        const material = new THREE.MeshLambertMaterial({ color: color });

        const entity = new THREE.Mesh(geometry, material);
        entity.position.set(
            gridX * this.TILE_SIZE - mapCenterX,
            size / 2 + 0.05, // Position above the tile
            gridY * this.TILE_SIZE - mapCenterZ
        );
        entity.castShadow = true; // Enable shadow casting
        entity.receiveShadow = true; // Enable shadow receiving

        this.entityGroup.add(entity);
    }

    createPlayer(playerPos, mapCenterX, mapCenterZ) {
        if (this.playerMesh) { // Should be cleared by clearScene, but defensive check
            this.scene.remove(this.playerMesh);
            if (this.playerMesh.geometry) this.playerMesh.geometry.dispose();
            if (this.playerMesh.material) this.playerMesh.material.dispose();
        }

        const geometry = new THREE.BoxGeometry(this.PLAYER_SIZE, this.PLAYER_SIZE * 1.5, this.PLAYER_SIZE); // Taller box for player
        const material = new THREE.MeshLambertMaterial({ color: 0x4dabf7 }); // Blue

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
        this.playerMesh.castShadow = true; // Enable shadow casting
        this.playerMesh.receiveShadow = true; // Enable shadow receiving

        this.scene.add(this.playerMesh); // Add directly to scene, not entityGroup

        // Create 3D directional arrows around the player
        this.createArrows();
    }

    createArrows() {
        if (!this.playerMesh || this.gameState.in_combat) return;

        this.clearArrows();

        const playerPos = this.playerMesh.position;
        // Corrected rotations: Assuming +Z is South, -Z is North, +X is East, -X is West
        // Arrow geometry points along its local +Z by default.
        const directions = [
            { name: 'n', offset: { x: 0, z: -this.ARROW_DISTANCE }, rotation: Math.PI },       // North: rotate to point -Z
            { name: 's', offset: { x: 0, z: this.ARROW_DISTANCE }, rotation: 0 },             // South: no rotation, points +Z
            { name: 'w', offset: { x: -this.ARROW_DISTANCE, z: 0 }, rotation: -Math.PI / 2 },   // West: rotate to point -X (was Math.PI / 2)
            { name: 'e', offset: { x: this.ARROW_DISTANCE, z: 0 }, rotation: Math.PI / 2 }     // East: rotate to point +X (was -Math.PI / 2)
        ];

        directions.forEach(dir => {
            if (this.canMoveDirection(dir.name)) {
                const arrow = this.createArrow(dir.name, dir.rotation);
                arrow.position.set(
                    playerPos.x + dir.offset.x,
                    playerPos.y + 0.2, // Slightly above player
                    playerPos.z + dir.offset.z
                );
                this.arrowGroup.add(arrow);
                this.arrows[dir.name] = arrow;
            }
        });
    }

    createArrow(direction, rotation) {
        const ARROW_SHAFT_LENGTH = this.ARROW_SIZE * 0.7; // Adjusted for proportion
        const ARROW_TIP_HEIGHT = this.ARROW_SIZE * 0.5;
        const ARROW_TIP_RADIUS = this.ARROW_SIZE * 0.3;
        const ARROW_SHAFT_RADIUS = this.ARROW_SIZE * 0.15;

        // Geometries are created with Y-axis as their principal axis by default
        const tipGeometry = new THREE.ConeGeometry(ARROW_TIP_RADIUS, ARROW_TIP_HEIGHT, 8);
        const shaftGeometry = new THREE.CylinderGeometry(ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 8);

        const tipMaterial = new THREE.MeshLambertMaterial({ color: 0x4dabf7, emissive: 0x111122 });
        const shaftMaterial = new THREE.MeshLambertMaterial({ color: 0x339af0, emissive: 0x111122 });

        const tip = new THREE.Mesh(tipGeometry, tipMaterial);
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);

        // Group for the visual parts of the arrow, to be oriented along +Z axis
        const visualArrowGroup = new THREE.Group();

        // Rotate shaft so its length (default Y) aligns with the Z-axis, pointing towards +Z
        shaft.rotation.x = Math.PI / 2;
        // Position shaft so its base is near origin, extending in +Z
        shaft.position.z = ARROW_SHAFT_LENGTH / 2;
        visualArrowGroup.add(shaft);

        // Rotate tip so its height (default Y) aligns with the Z-axis, pointing towards +Z
        tip.rotation.x = Math.PI / 2;
        // Position tip at the end of the shaft
        tip.position.z = ARROW_SHAFT_LENGTH + (ARROW_TIP_HEIGHT / 2);
        visualArrowGroup.add(tip);

        // visualArrowGroup now points along its local +Z axis.
        // The origin of visualArrowGroup is at the conceptual base of the shaft.

        // Create the main group for this arrow instance
        const arrowInstanceGroup = new THREE.Group();
        arrowInstanceGroup.add(visualArrowGroup);

        // Apply the N/S/E/W rotation to this main group
        // This rotation is around the Y-axis, turning the Z-pointing arrow to the correct world direction.
        arrowInstanceGroup.rotation.y = rotation;

        arrowInstanceGroup.userData = { direction: direction };
        return arrowInstanceGroup;
    }

    clearArrows() {
        while (this.arrowGroup.children.length > 0) {
            const child = this.arrowGroup.children[0];
            this.arrowGroup.remove(child);
            // Dispose of geometries and materials
            child.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        }
        this.arrows = {};
        this.hoveredArrow = null;
    }

    canMoveDirection(direction) {
        if (!this.gameState || this.gameState.in_combat) return false;
        const [x, y] = this.gameState.player_pos;
        switch (direction) {
            case 'n': return y > 0;
            case 's': return y < this.gameState.map_height - 1;
            case 'w': return x > 0;
            case 'e': return x < this.gameState.map_width - 1;
            default: return false;
        }
    }

    updateArrows() {
        if (!this.playerMesh || !this.camera) return;

        // Update arrow positions to follow player
        if (this.playerMesh) {
            const playerPos = this.playerMesh.position;
            const directions = [
                { name: 'n', offset: { x: 0, z: -this.ARROW_DISTANCE } },
                { name: 's', offset: { x: 0, z: this.ARROW_DISTANCE } },
                { name: 'w', offset: { x: -this.ARROW_DISTANCE, z: 0 } },
                { name: 'e', offset: { x: this.ARROW_DISTANCE, z: 0 } }
            ];

            directions.forEach(dir => {
                const arrow = this.arrows[dir.name];
                if (arrow) {
                    arrow.position.set(
                        playerPos.x + dir.offset.x,
                        playerPos.y + 0.2,
                        playerPos.z + dir.offset.z
                    );

                    // Scale based on camera distance for visibility
                    const distance = this.camera.position.distanceTo(arrow.position);
                    const scale = Math.max(0.8, Math.min(2.5, distance * 0.15));
                    arrow.scale.setScalar(scale);

                    // Arrows maintain their world direction - no billboard effect
                }
            });
        }
    }

    onMouseMove(event) {
        if (!this.arrowGroup.children.length) return;

        // Convert mouse coordinates to normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast against arrows
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        const intersects = raycaster.intersectObjects(this.arrowGroup.children, true);

        // Reset previous hover state
        if (this.hoveredArrow) {
            this.hoveredArrow.traverse((obj) => {
                if (obj.material) {
                    obj.material.emissive.setHex(0x000000);
                }
            });
            this.hoveredArrow = null;
            this.renderer.domElement.style.cursor = 'default';
        }

        // Set new hover state
        if (intersects.length > 0) {
            let arrowParent = intersects[0].object;
            while (arrowParent.parent && arrowParent.parent !== this.arrowGroup) {
                arrowParent = arrowParent.parent;
            }

            this.hoveredArrow = arrowParent;
            this.hoveredArrow.traverse((obj) => {
                if (obj.material) {
                    obj.material.emissive.setHex(0x222222);
                }
            });
            this.renderer.domElement.style.cursor = 'pointer';
        }
    }

    onArrowClick(event) {
        if (!this.arrowGroup.children.length) return;

        // Convert mouse coordinates to normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast against arrows
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        const intersects = raycaster.intersectObjects(this.arrowGroup.children, true);

        if (intersects.length > 0) {
            let arrowParent = intersects[0].object;
            while (arrowParent.parent && arrowParent.parent !== this.arrowGroup) {
                arrowParent = arrowParent.parent;
            }

            const direction = arrowParent.userData.direction;
            if (direction) {
                // Prevent event from bubbling to map click
                event.stopPropagation();

                // Trigger move via global app instance or custom event
                this.triggerMove(direction);
                return true; // Indicate that arrow was clicked
            }
        }
        return false; // No arrow was clicked
    }

    triggerMove(direction) {
        // Create a custom event to trigger movement
        const moveEvent = new CustomEvent('arrow-move', {
            detail: { direction: direction }
        });
        window.dispatchEvent(moveEvent);
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Update controls if available
        if (this.controls) {
            this.controls.update();
        }

        // Update 3D arrows
        this.updateArrows();

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

        // Remove mouse event handlers
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
            this.renderer.domElement.removeEventListener('click', this.onArrowClick);
        }

        // Dispose ResizeObserver
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        this.clearScene(); // Clear all objects

        if (this.tileGroup) this.scene.remove(this.tileGroup);
        if (this.entityGroup) this.scene.remove(this.entityGroup);
        if (this.arrowGroup) this.scene.remove(this.arrowGroup);

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
        // First check if an arrow was clicked
        if (this.onArrowClick(event)) {
            return null; // Arrow was clicked, don't process map click
        }

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

    createCardinalMarkers() {
        const markerSize = 0.5;
        const markerOffset = (this.gameState && this.gameState.map_width ? this.gameState.map_width / 2 + 2 : 12); // Place outside grid

        const colors = {
            N: 0xff0000, // Red
            S: 0x0000ff, // Blue
            E: 0x00ff00, // Green
            W: 0xffff00  // Yellow
        };

        const positions = {
            N: { x: 0, y: markerSize / 2, z: -markerOffset },
            S: { x: 0, y: markerSize / 2, z: markerOffset },
            E: { x: markerOffset, y: markerSize / 2, z: 0 },
            W: { x: -markerOffset, y: markerSize / 2, z: 0 }
        };

        for (const dir in positions) {
            const geometry = new THREE.BoxGeometry(markerSize, markerSize, markerSize);
            const material = new THREE.MeshBasicMaterial({ color: colors[dir] });
            const marker = new THREE.Mesh(geometry, material);
            marker.position.set(positions[dir].x, positions[dir].y, positions[dir].z);
            this.scene.add(marker); // Add directly to scene, not a group that might be cleared
        }
    }
}

// Export for use in other modules
window.ThreeJSRenderer = ThreeJSRenderer;
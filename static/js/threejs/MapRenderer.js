class MapRenderer {
    constructor(scene) {
        this.scene = scene;
        this.tileGroup = new THREE.Group();
        this.scene.add(this.tileGroup);

        // Constants
        this.TILE_SIZE = 1;

        // Cardinal markers state
        this.cardinalMarkersCreated = false;

        // Initialize texture manager
        this.textureManager = new TextureManager();
    }

    clearTiles() {
        // Remove all children from tileGroup
        while (this.tileGroup.children.length > 0) {
            const child = this.tileGroup.children[0];
            this.tileGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }

    updateMap(gameState) {
        if (!gameState || !gameState.cell_types || !gameState.explored) {
            console.warn("MapRenderer: Game state not ready for map update.", gameState);
            return;
        }

        this.clearTiles();

        const mapHeight = gameState.cell_types.length;
        const mapWidth = gameState.cell_types[0].length;
        const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
        const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

        // Create all tiles (fog of war removed)
        let tilesCreated = 0;
        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                this.createTile(x, y, gameState.cell_types[y][x], mapCenterX, mapCenterZ, true);
                tilesCreated++;
            }
        }

        // Create cardinal markers once gameState is available and map is set up
        if (!this.cardinalMarkersCreated && gameState && gameState.map_width) {
            this.createCardinalMarkers(gameState);
            this.cardinalMarkersCreated = true;
        }

        return { mapCenterX, mapCenterZ };
    }


    createTile(x, y, cellType, mapCenterX, mapCenterZ, isExplored = true) {
        // Use PlaneGeometry for flat tiles
        const geometry = new THREE.PlaneGeometry(this.TILE_SIZE * 0.9, this.TILE_SIZE * 0.9);

        // Create texture
        const texture = this.textureManager.createFloorTexture(cellType, {
            size: 64,
            iconColor: '#ffffff',
            padding: 8,
            showIcon: true
        });

        // Create material with normal appearance (fog of war removed)
        const material = new THREE.MeshLambertMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: false,
            opacity: 1.0
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

        this.tileGroup.add(tile);

        // Add subtle wireframe border for better tile definition
        const wireframeGeometry = new THREE.PlaneGeometry(this.TILE_SIZE, this.TILE_SIZE);
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0x555555,
            wireframe: true,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.2  // Subtle wireframe
        });
        const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        wireframe.position.copy(tile.position);
        wireframe.position.y += 0.001; // Slightly above the tile
        wireframe.rotation.x = -Math.PI / 2;

        this.tileGroup.add(wireframe);
    }

    createCardinalMarkers(gameState) {
        const markerSize = 0.5;
        const markerOffset = (gameState && gameState.map_width ? gameState.map_width / 2 + 2 : 12);

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
            this.scene.add(marker); // Add directly to scene
        }
    }

    // Helper method for raycasting against tiles
    getTileIntersects(raycaster) {
        return raycaster.intersectObjects(this.tileGroup.children);
    }

    dispose() {
        this.clearTiles();
        if (this.tileGroup) {
            this.scene.remove(this.tileGroup);
        }
        // Clean up texture manager
        if (this.textureManager) {
            this.textureManager.dispose();
        }
    }
}

// Export for use in other modules
window.MapRenderer = MapRenderer;
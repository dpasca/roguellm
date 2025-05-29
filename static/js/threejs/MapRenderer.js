class MapRenderer {
    constructor(scene) {
        this.scene = scene;
        this.tileGroup = new THREE.Group();
        this.scene.add(this.tileGroup);

        // Constants
        this.TILE_SIZE = 1;

        // Cardinal markers state
        this.cardinalMarkersCreated = false;
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

        console.log("MapRenderer: Updating game map", gameState);
        this.clearTiles();

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

        // Create cardinal markers once gameState is available and map is set up
        if (!this.cardinalMarkersCreated && gameState && gameState.map_width) {
            this.createCardinalMarkers(gameState);
            this.cardinalMarkersCreated = true;
        }

        return { mapCenterX, mapCenterZ };
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
        const geometry = new THREE.PlaneGeometry(this.TILE_SIZE * 0.9, this.TILE_SIZE * 0.9);

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
            transparent: !isExplored,
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
            color: isExplored ? 0x666666 : 0x333333,
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
    }
}

// Export for use in other modules
window.MapRenderer = MapRenderer;
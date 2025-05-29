class EventHandler {
    constructor(sceneManager, mapRenderer, arrowController) {
        this.sceneManager = sceneManager;
        this.mapRenderer = mapRenderer;
        this.arrowController = arrowController;
        this.gameState = null;

        // Constants
        this.TILE_SIZE = 1;

        // Movement highlighting
        this.highlightedTiles = [];
        this.hoveredTile = null;

        // Dedicated mousemove for highlighting
        this.onMouseMoveForHighlightingBound = (event) => this.updateTileHighlighting(event);
        this.sceneManager.renderer.domElement.addEventListener('mousemove', this.onMouseMoveForHighlightingBound);
    }

    updateTileHighlighting(event) {
        if (!this.gameState || this.gameState.in_combat) {
            this.clearTileHighlighting();
            return;
        }

        // Convert mouse coordinates to normalized device coordinates
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycasting
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.sceneManager.camera);

        // First check if we're hovering an arrow - if so, don't highlight tiles
        if (this.arrowController.arrowGroup && this.arrowController.arrowGroup.children.length > 0) {
            const arrowIntersects = raycaster.intersectObjects(this.arrowController.arrowGroup.children, true);
            if (arrowIntersects.length > 0) {
                this.clearTileHighlighting();
                // ArrowController will handle cursor if arrow is hovered
                return;
            }
        }

        // Intersect with the tiles
        const intersects = this.mapRenderer.getTileIntersects(raycaster);

        if (intersects.length > 0) {
            const intersect = intersects[0];
            const point = intersect.point;

            // Convert world coordinates to grid coordinates
            const mapHeight = this.gameState.cell_types.length;
            const mapWidth = this.gameState.cell_types[0].length;
            const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
            const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

            const hoveredGridX = Math.floor((point.x + mapCenterX + this.TILE_SIZE / 2) / this.TILE_SIZE);
            const hoveredGridY = Math.floor((point.z + mapCenterZ + this.TILE_SIZE / 2) / this.TILE_SIZE);

            // Clamp to map bounds
            const finalX = Math.max(0, Math.min(mapWidth - 1, hoveredGridX));
            const finalY = Math.max(0, Math.min(mapHeight - 1, hoveredGridY));

            // Check if this is a valid movement cell
            if (this.isValidMovementCell(finalX, finalY)) {
                this.highlightMovementCell(finalX, finalY);
                this.sceneManager.renderer.domElement.style.cursor = 'pointer';
            } else {
                this.clearTileHighlighting();
                this.sceneManager.renderer.domElement.style.cursor = 'default';
            }
        } else {
            this.clearTileHighlighting();
            this.sceneManager.renderer.domElement.style.cursor = 'default';
        }
    }

    isValidMovementCell(x, y) {
        if (!this.gameState || !this.gameState.player_pos) return false;

        const [playerX, playerY] = this.gameState.player_pos;
        const deltaX = x - playerX;
        const deltaY = y - playerY;

        // Only allow movement to adjacent cells (not diagonal)
        const isAdjacent = (Math.abs(deltaX) === 1 && deltaY === 0) ||
            (Math.abs(deltaY) === 1 && deltaX === 0);

        if (!isAdjacent) return false;

        // Check if movement is within bounds
        const isInBounds = x >= 0 && x < this.gameState.map_width &&
            y >= 0 && y < this.gameState.map_height;

        return isInBounds;
    }

    highlightMovementCell(x, y) {
        // Clear previous highlighting
        this.clearTileHighlighting();

        // Get the tile at this position
        const mapHeight = this.gameState.cell_types.length;
        const mapWidth = this.gameState.cell_types[0].length;
        const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
        const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

        // Create highlight overlay
        const geometry = new THREE.PlaneGeometry(this.TILE_SIZE * 0.95, this.TILE_SIZE * 0.95);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00, // Yellow highlight to complement blue arrows
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });

        const highlight = new THREE.Mesh(geometry, material);
        highlight.position.set(
            x * this.TILE_SIZE - mapCenterX,
            0.002, // Slightly above the tile
            y * this.TILE_SIZE - mapCenterZ
        );
        highlight.rotation.x = -Math.PI / 2;

        this.sceneManager.scene.add(highlight);
        this.highlightedTiles.push(highlight);
        this.hoveredTile = { x, y };
    }

    clearTileHighlighting() {
        this.highlightedTiles.forEach(tile => {
            this.sceneManager.scene.remove(tile);
            if (tile.geometry) tile.geometry.dispose();
            if (tile.material) tile.material.dispose();
        });
        this.highlightedTiles = [];
        this.hoveredTile = null;
    }

    setGameState(gameState) {
        this.gameState = gameState;
        this.arrowController.setGameState(gameState);
        this.clearTileHighlighting(); // Clear highlights when game state changes
    }

    onMapClick(event) {
        // Only handle left mouse button clicks
        if (event.button !== 0) return null;

        // Don't process click if OrbitControls was used to drag/rotate
        if (this.sceneManager.isDraggingWithOrbitControls) {
            console.log("Ignoring click because OrbitControls was dragging.");
            return null;
        }

        // First check if an arrow was clicked
        if (this.arrowController.onArrowClick(event)) {
            return null; // Arrow was clicked, don't process map click
        }

        // Convert click coordinates to normalized device coordinates (NDC)
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycasting
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.sceneManager.camera);

        // Intersect with the tiles
        const intersects = this.mapRenderer.getTileIntersects(raycaster);

        if (intersects.length > 0 && this.gameState) {
            const intersect = intersects[0];
            const point = intersect.point; // The world coordinates of the click

            // Convert world coordinates back to grid coordinates
            const mapHeight = this.gameState.cell_types.length;
            const mapWidth = this.gameState.cell_types[0].length;
            const mapCenterX = (mapWidth * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;
            const mapCenterZ = (mapHeight * this.TILE_SIZE) / 2 - this.TILE_SIZE / 2;

            const clickedGridX = Math.floor((point.x + mapCenterX + this.TILE_SIZE / 2) / this.TILE_SIZE);
            const clickedGridY = Math.floor((point.z + mapCenterZ + this.TILE_SIZE / 2) / this.TILE_SIZE);

            // Clamp to map bounds
            const finalX = Math.max(0, Math.min(mapWidth - 1, clickedGridX));
            const finalY = Math.max(0, Math.min(mapHeight - 1, clickedGridY));

            // Only allow movement to valid adjacent cells
            if (this.isValidMovementCell(finalX, finalY)) {
                console.log(`3D Click: Valid movement to Grid(${finalX}, ${finalY})`);
                return { x: finalX, y: finalY };
            } else {
                console.log(`3D Click: Invalid movement to Grid(${finalX}, ${finalY}) - not adjacent or out of bounds`);
                return null;
            }
        }
        return null; // Click was not on a tile
    }

    dispose() {
        // Remove event listeners
        if (this.sceneManager && this.sceneManager.renderer && this.sceneManager.renderer.domElement) {
            this.sceneManager.renderer.domElement.removeEventListener('mousemove', this.onMouseMoveForHighlightingBound);
        }

        // Clear highlighting
        this.clearTileHighlighting();
    }
}

// Export for use in other modules
window.EventHandler = EventHandler;
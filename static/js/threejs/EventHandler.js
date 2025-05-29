class EventHandler {
    constructor(sceneManager, mapRenderer, arrowController) {
        this.sceneManager = sceneManager;
        this.mapRenderer = mapRenderer;
        this.arrowController = arrowController;
        this.gameState = null;

        // Constants
        this.TILE_SIZE = 1;
    }

    setGameState(gameState) {
        this.gameState = gameState;
        this.arrowController.setGameState(gameState);
    }

    onMapClick(event) {
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

            console.log(`3D Click: World(${point.x.toFixed(2)}, ${point.z.toFixed(2)}), Grid(${finalX}, ${finalY})`);

            return { x: finalX, y: finalY };
        }
        return null; // Click was not on a tile
    }
}

// Export for use in other modules
window.EventHandler = EventHandler;
class ThreeJSRenderer {
    constructor(container, gameState) {
        this.container = container;
        this.gameState = gameState;
        this.animationId = null;

        console.log("ThreeJSRenderer constructor called with gameState:", gameState);
        this.init();
    }

    init() {
        // Initialize all modules
        this.sceneManager = new SceneManager(this.container);
        this.mapRenderer = new MapRenderer(this.sceneManager.scene);
        this.entityRenderer = new EntityRenderer(this.sceneManager.scene);
        this.arrowController = new ArrowController(
            this.sceneManager.scene,
            this.sceneManager.camera,
            this.sceneManager.renderer
        );
        this.eventHandler = new EventHandler(
            this.sceneManager,
            this.mapRenderer,
            this.arrowController
        );

        // Set initial game state
        if (this.gameState) {
            this.eventHandler.setGameState(this.gameState);
        }

        // Start render loop
        this.animate();
    }

    clearScene() {
        this.mapRenderer.clearTiles();
        this.entityRenderer.clearEntities();
        this.entityRenderer.clearPlayer();
        this.arrowController.clearArrows();
    }

    async updateGameMap(gameState) {
        if (!gameState || !gameState.cell_types || !gameState.explored) {
            console.warn("ThreeJSRenderer: Game state not ready for map update.", gameState);
            return;
        }

        // Store the latest game state
        this.gameState = gameState;
        this.eventHandler.setGameState(gameState);

        console.log("ThreeJSRenderer: Updating game map", gameState);

        // Update map
        const mapInfo = await this.mapRenderer.updateMap(gameState);
        if (!mapInfo) return;

        const { mapCenterX, mapCenterZ } = mapInfo;

        // Update entities
        this.entityRenderer.updateEntities(gameState, mapCenterX, mapCenterZ);

        // Update player position
        if (gameState.player_pos) {
            const playerMesh = this.entityRenderer.updatePlayer(gameState.player_pos, mapCenterX, mapCenterZ, this.sceneManager);

            // Create arrows around the player
            if (playerMesh) {
                this.arrowController.createArrows(playerMesh.position);
            }
        }

        console.log("ThreeJSRenderer: Map update complete. Scene children:", this.sceneManager.scene.children.length);
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Update scene manager (controls, etc.)
        this.sceneManager.update();

        // Update entity animations (player movement)
        this.entityRenderer.update();

        // Update arrows to follow player
        const playerPosition = this.entityRenderer.getPlayerPosition();
        if (playerPosition) {
            this.arrowController.updateArrows(playerPosition);
        }

        // Render the scene
        this.sceneManager.render();
    }

    onMapClick(event) {
        return this.eventHandler.onMapClick(event);
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        // Dispose all modules
        this.eventHandler.dispose();
        this.arrowController.dispose();
        this.entityRenderer.dispose();
        this.mapRenderer.dispose();
        this.sceneManager.dispose();
    }
}

// Export for use in other modules
window.ThreeJSRenderer = ThreeJSRenderer;

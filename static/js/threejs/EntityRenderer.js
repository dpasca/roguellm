class EntityRenderer {
    constructor(scene) {
        this.scene = scene;
        this.entityGroup = new THREE.Group();
        this.scene.add(this.entityGroup);
        this.playerMesh = null;

        // Constants
        this.TILE_SIZE = 1;
        this.ENTITY_SIZE = 0.5;
        this.PLAYER_SIZE = 0.6;
    }

    clearEntities() {
        // Remove all children from entityGroup
        while (this.entityGroup.children.length > 0) {
            const child = this.entityGroup.children[0];
            this.entityGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }

    clearPlayer() {
        if (this.playerMesh) {
            this.scene.remove(this.playerMesh);
            if (this.playerMesh.geometry) this.playerMesh.geometry.dispose();
            if (this.playerMesh.material) this.playerMesh.material.dispose();
            this.playerMesh = null;
        }
    }

    updateEntities(gameState, mapCenterX, mapCenterZ) {
        this.clearEntities();

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

    updatePlayer(playerPos, mapCenterX, mapCenterZ) {
        this.clearPlayer();

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

        return this.playerMesh;
    }

    getPlayerPosition() {
        return this.playerMesh ? this.playerMesh.position : null;
    }

    dispose() {
        this.clearEntities();
        this.clearPlayer();
        if (this.entityGroup) {
            this.scene.remove(this.entityGroup);
        }
    }
}

// Export for use in other modules
window.EntityRenderer = EntityRenderer;
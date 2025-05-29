class EntityRenderer {
    constructor(scene) {
        this.scene = scene;
        this.entityGroup = new THREE.Group();
        this.scene.add(this.entityGroup);
        this.playerMesh = null;

        // Player movement animation
        this.isAnimatingPlayer = false;
        this.playerAnimationSpeed = 0.2; // Speed of interpolation (higher = faster)
        this.currentPlayerPosition = new THREE.Vector3();
        this.targetPlayerPosition = new THREE.Vector3();

        // Constants
        this.TILE_SIZE = 1;
        this.ENTITY_SIZE = 0.5;
        this.PLAYER_SIZE = 0.6;

        // Initialize texture manager
        this.textureManager = new TextureManager();
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
                        enemy.font_awesome_icon || 'fa-solid fa-skull', // Use FontAwesome icon
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
                    item.font_awesome_icon || 'fa-solid fa-box', // Use FontAwesome icon
                    'item',
                    mapCenterX,
                    mapCenterZ,
                    this.ENTITY_SIZE * 0.8 // Items slightly smaller
                );
            });
        }
    }

    createEntity(gridX, gridY, iconClass, type, mapCenterX, mapCenterZ, size) {
        let geometry;
        if (type === 'item') {
            geometry = new THREE.CylinderGeometry(size / 2, size / 2, size * 0.5, 16); // Cylinder for items
        } else {
            geometry = new THREE.BoxGeometry(size, size, size); // Box for enemies
        }

        // Create texture from FontAwesome icon
        const texture = this.textureManager.createIconTexture(iconClass, {
            size: 64,
            backgroundColor: this.getEntityBackgroundColor(type),
            iconColor: '#ffffff',
            padding: 8
        });

        const material = new THREE.MeshLambertMaterial({
            map: texture,
            transparent: true
        });

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

    getEntityBackgroundColor(type) {
        // Return appropriate background colors for different entity types
        switch (type) {
            case 'enemy':
                return '#cc3333'; // Red background for enemies
            case 'item':
                return '#33cc33'; // Green background for items
            case 'player':
                return '#3366cc'; // Blue background for player
            default:
                return '#666666'; // Default gray
        }
    }

    updatePlayer(playerPos, mapCenterX, mapCenterZ, sceneManager = null) {
        // Create player mesh if it doesn't exist
        if (!this.playerMesh) {
            const geometry = new THREE.BoxGeometry(this.PLAYER_SIZE, this.PLAYER_SIZE * 1.5, this.PLAYER_SIZE); // Taller box for player

            // Create texture for player using FontAwesome icon
            const texture = this.textureManager.createIconTexture('fa-solid fa-user', {
                size: 64,
                backgroundColor: '#4dabf7', // Blue background
                iconColor: '#ffffff',
                padding: 8
            });

            const material = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });

            this.playerMesh = new THREE.Mesh(geometry, material);
            this.playerMesh.castShadow = true; // Enable shadow casting
            this.playerMesh.receiveShadow = true; // Enable shadow receiving
            this.scene.add(this.playerMesh); // Add directly to scene, not entityGroup
        }

        // Calculate target position
        let targetX, targetZ;
        if (playerPos && playerPos.length >= 2) {
            targetX = playerPos[0] * this.TILE_SIZE - mapCenterX;
            targetZ = playerPos[1] * this.TILE_SIZE - mapCenterZ;
        } else {
            // Default position if playerPos is invalid
            targetX = -mapCenterX;
            targetZ = -mapCenterZ;
        }

        const targetY = (this.PLAYER_SIZE * 1.5) / 2 + 0.05; // Position above the tile
        this.targetPlayerPosition.set(targetX, targetY, targetZ);

        // If this is the first time setting position, don't animate
        if (this.currentPlayerPosition.length() === 0) {
            this.currentPlayerPosition.copy(this.targetPlayerPosition);
            this.playerMesh.position.copy(this.currentPlayerPosition);
        } else {
            // Check if position actually changed to start animation
            const positionChanged = !this.currentPlayerPosition.equals(this.targetPlayerPosition);
            if (positionChanged) {
                this.isAnimatingPlayer = true;
            }
        }

        // Update camera if sceneManager is provided
        if (sceneManager) {
            sceneManager.setPlayerPosition(this.targetPlayerPosition.x, this.targetPlayerPosition.y, this.targetPlayerPosition.z);
        }

        return this.playerMesh;
    }

    // Call this every frame to update animations
    update() {
        if (this.isAnimatingPlayer && this.playerMesh) {
            // Interpolate towards target position
            this.currentPlayerPosition.lerp(this.targetPlayerPosition, this.playerAnimationSpeed);
            this.playerMesh.position.copy(this.currentPlayerPosition);

            // Check if we're close enough to stop animating
            const distance = this.currentPlayerPosition.distanceTo(this.targetPlayerPosition);
            if (distance < 0.01) {
                this.currentPlayerPosition.copy(this.targetPlayerPosition);
                this.playerMesh.position.copy(this.currentPlayerPosition);
                this.isAnimatingPlayer = false;
            }
        }
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
        // Clean up texture manager
        if (this.textureManager) {
            this.textureManager.dispose();
        }
    }
}

// Export for use in other modules
window.EntityRenderer = EntityRenderer;
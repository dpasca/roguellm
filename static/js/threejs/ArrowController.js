class ArrowController {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.arrowGroup = new THREE.Group();
        this.scene.add(this.arrowGroup);
        this.arrows = {};
        this.hoveredArrow = null;
        this.gameState = null;

        // Constants
        this.TILE_SIZE = 1;
        this.ARROW_SIZE = 0.4;
        this.ARROW_DISTANCE = 1.5;

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.onMouseMoveBound = (event) => this.onMouseMove(event);
        this.onArrowClickBound = (event) => this.onArrowClick(event);

        this.renderer.domElement.addEventListener('mousemove', this.onMouseMoveBound);
        this.renderer.domElement.addEventListener('click', this.onArrowClickBound);
    }

    setGameState(gameState) {
        this.gameState = gameState;
        // DIAGNOSTIC: Log current arrows in scene
        // console.log("[DIAGNOSTIC] Current arrows in arrowGroup:", this.arrowGroup.children.length);
        // this.arrowGroup.children.forEach((child, index) => {
        //     console.log(`[DIAGNOSTIC] Arrow ${index}: UUID: ${child.uuid}, userData: ${JSON.stringify(child.userData)}`);
        // });
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

    createArrows(playerPosition) {
        if (!playerPosition || (this.gameState && this.gameState.in_combat)) return;

        this.clearArrows();

        // Corrected rotations: Assuming +Z is South, -Z is North, +X is East, -X is West
        const directions = [
            { name: 'n', offset: { x: 0, z: -this.ARROW_DISTANCE }, rotation: Math.PI },
            { name: 's', offset: { x: 0, z: this.ARROW_DISTANCE }, rotation: 0 },
            { name: 'w', offset: { x: -this.ARROW_DISTANCE, z: 0 }, rotation: -Math.PI / 2 },
            { name: 'e', offset: { x: this.ARROW_DISTANCE, z: 0 }, rotation: Math.PI / 2 }
        ];

        directions.forEach(dir => {
            if (this.canMoveDirection(dir.name)) {
                const arrow = this.createArrow(dir.name, dir.rotation);
                arrow.position.set(
                    playerPosition.x + dir.offset.x,
                    playerPosition.y + 0.2, // Slightly above player
                    playerPosition.z + dir.offset.z
                );
                this.arrowGroup.add(arrow);
                this.arrows[dir.name] = arrow;
                // console.log(`[CREATEARROWS DEBUG] Created arrow ${dir.name}, UUID: ${arrow.uuid}, userData: ${JSON.stringify(arrow.userData)}`);
            }
        });

        // console.log("[CREATEARROWS DEBUG] Final check of this.arrowGroup children's userData:");
        // this.arrowGroup.children.forEach(child => {
        //     console.log(`[CREATEARROWS DEBUG] Child UUID: ${child.uuid}, Name: ${child.name}, userData: ${JSON.stringify(child.userData)}`);
        // });
    }

    createArrow(direction, rotation) {
        const ARROW_SHAFT_LENGTH = this.ARROW_SIZE * 0.7;
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
        // console.log(`[CREATE_ARROW_FN DEBUG] visualArrowGroup for ${direction}, UUID: ${visualArrowGroup.uuid}`);

        // Rotate shaft so its length (default Y) aligns with the Z-axis, pointing towards +Z
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = ARROW_SHAFT_LENGTH / 2;
        visualArrowGroup.add(shaft);

        // Rotate tip so its height (default Y) aligns with the Z-axis, pointing towards +Z
        tip.rotation.x = Math.PI / 2;
        tip.position.z = ARROW_SHAFT_LENGTH + (ARROW_TIP_HEIGHT / 2);
        visualArrowGroup.add(tip);

        // Create the main group for this arrow instance
        const arrowInstanceGroup = new THREE.Group();
        arrowInstanceGroup.add(visualArrowGroup);

        // Apply the N/S/E/W rotation to this main group
        arrowInstanceGroup.rotation.y = rotation;
        arrowInstanceGroup.userData = { direction: direction };
        // console.log(`[CREATE_ARROW_FN DEBUG] arrowInstanceGroup for ${direction}, UUID: ${arrowInstanceGroup.uuid}, Name: ${arrowInstanceGroup.name || 'N/A'}, userData set to: ${JSON.stringify(arrowInstanceGroup.userData)}`);
        return arrowInstanceGroup;
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

    updateArrows(playerPosition) {
        if (!playerPosition || !this.camera) return;

        // console.log("[DIAGNOSTIC updateArrows] Called with playerPosition:", playerPosition);
        // console.log("[DIAGNOSTIC updateArrows] Current arrows count:", this.arrowGroup.children.length);

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
                    playerPosition.x + dir.offset.x,
                    playerPosition.y + 0.2,
                    playerPosition.z + dir.offset.z
                );

                // Scale based on camera distance for visibility
                const distance = this.camera.position.distanceTo(arrow.position);
                const scale = Math.max(0.8, Math.min(2.5, distance * 0.15));
                arrow.scale.setScalar(scale);
            } else {
                // console.log(`[DIAGNOSTIC updateArrows] Arrow for direction ${dir.name} is missing from this.arrows`);
            }
        });
    }

    onMouseMove(event) {
        if (!this.arrowGroup.children.length) return;

        // Convert mouse coordinates to normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const mouse = new THREE.Vector2(x, y);

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);

        const intersects = raycaster.intersectObjects(this.arrowGroup.children, true);
        // console.log(`ArrowController: intersects.length = ${intersects.length}`);

        let hoveredArrow = null;
        if (intersects.length > 0) {
            const intersectedObject = intersects[0].object;
            // console.log(`[DEBUG] Intersected obj: ${intersectedObject.uuid}`); // Optional: keep for debugging
            const visualGroup = intersectedObject.parent;

            if (visualGroup) {
                // console.log(`[DEBUG] visualGroup (parent of intersected): ${visualGroup.uuid}`); // Optional
                const instanceGroup = visualGroup.parent; // This should be our arrowInstanceGroup
                if (instanceGroup) {
                    // console.log(`[DEBUG] instanceGroup (parent of visual): ${instanceGroup.uuid}, its userData: ${JSON.stringify(instanceGroup.userData)}`); // Optional
                    // We've verified instanceGroup has the correct userData. Trust this direct traversal.
                    hoveredArrow = instanceGroup;
                } else {
                    // console.log("[DEBUG] instanceGroup (parent of visualGroup) is null/undefined. Cannot set hoveredArrow.");
                }
            } else {
                // console.log("[DEBUG] visualGroup (parent of intersectedObject) is null/undefined. Cannot set hoveredArrow.");
            }

            // Now check the determined hoveredArrow
            if (hoveredArrow && hoveredArrow.userData && hoveredArrow.userData.direction) {
                // console.log(`ArrowController: Hovered arrow identified: ${hoveredArrow.userData.direction} (UUID: ${hoveredArrow.uuid})`);
            } else if (hoveredArrow) {
                // console.log(`ArrowController: userData.direction is MISSING on hoveredArrow. UUID: ${hoveredArrow.uuid}, userData value: ${JSON.stringify(hoveredArrow.userData)}`);
            } else {
                // This will be hit if visualGroup or instanceGroup was null, or if intersects.length was 0 initially
                // console.log("ArrowController: hoveredArrow is null after attempting to find it.");
            }
        } else {
            // No intersections - hoveredArrow remains null
        }

        // Update the class member this.hoveredArrow for the rendering loop
        this.hoveredArrow = hoveredArrow;
        // Update cursor style based on the locally determined hoveredArrow from this event
        this.renderer.domElement.style.cursor = hoveredArrow ? 'pointer' : 'default';

        // The color update loop uses this.hoveredArrow, which is now correctly set
        this.arrowGroup.children.forEach((arrow) => {
            arrow.traverse((obj) => {
                if (obj.material) {
                    // Store default colors if not already stored
                    if (!obj.material.userData) obj.material.userData = {}; // Initialize userData if it doesn't exist
                    if (obj.material.userData.defaultColor === undefined) { // Check with undefined for robustness
                        obj.material.userData.defaultColor = obj.material.color.getHex();
                    }
                    if (obj.material.userData.defaultEmissive === undefined) {
                        obj.material.userData.defaultEmissive = obj.material.emissive.getHex();
                    }

                    // Check if the current arrow being iterated is the one that was identified as hovered
                    if (arrow === this.hoveredArrow) { // Compare with this.hoveredArrow, not the local hoveredArrow from onMouseMove
                        // Red hover effect
                        obj.material.color.setHex(0xff4444); // Bright red
                        obj.material.emissive.setHex(0x330000); // Dark red glow
                    } else {
                        // Restore original colors
                        obj.material.color.setHex(obj.material.userData.defaultColor);
                        obj.material.emissive.setHex(obj.material.userData.defaultEmissive);
                    }
                }
            });
        });
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

    dispose() {
        // Remove event handlers
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('mousemove', this.onMouseMoveBound);
            this.renderer.domElement.removeEventListener('click', this.onArrowClickBound);
        }

        this.clearArrows();
        if (this.arrowGroup) {
            this.scene.remove(this.arrowGroup);
        }
    }
}

// Export for use in other modules
window.ArrowController = ArrowController;

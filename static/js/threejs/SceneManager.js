class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.resizeObserver = null;

        // Constants
        this.FRUSTUM_SIZE = 15;

        this.init();
    }

    init() {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLighting();
        this.setupControls();
        this.setupGrid();
        this.setupResizeObserver();

        // Fallback window resize handler
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
    }

    setupCamera() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.OrthographicCamera(
            this.FRUSTUM_SIZE * aspect / -2,
            this.FRUSTUM_SIZE * aspect / 2,
            this.FRUSTUM_SIZE / 2,
            this.FRUSTUM_SIZE / -2,
            1,
            1000
        );
        // Position for an isometric-like view
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);
        this.camera.zoom = 1;
        this.camera.updateProjectionMatrix();
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        // Enable shadow mapping for better 3D appearance
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);
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

    setupControls() {
        if (window.THREE && THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.enableRotate = true;
            this.controls.screenSpacePanning = true;
            this.controls.target.set(0, 0, 0);
        }
    }

    setupGrid() {
        // Add a grid helper for better spatial reference
        const gridSize = 20;
        const divisions = 20;
        const gridHelper = new THREE.GridHelper(gridSize, divisions, 0x444444, 0x222222);
        gridHelper.position.y = -0.01; // Slightly below the tiles
        this.scene.add(gridHelper);
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

    onWindowResize() {
        const aspect = this.container.clientWidth / this.container.clientHeight;

        this.camera.left = this.FRUSTUM_SIZE * aspect / -2;
        this.camera.right = this.FRUSTUM_SIZE * aspect / 2;
        this.camera.top = this.FRUSTUM_SIZE / 2;
        this.camera.bottom = this.FRUSTUM_SIZE / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        console.log(`3D renderer resized to: ${this.container.clientWidth}x${this.container.clientHeight}`);
    }

    update() {
        if (this.controls) {
            this.controls.update();
        }
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        window.removeEventListener('resize', this.onWindowResize);

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

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
}

// Export for use in other modules
window.SceneManager = SceneManager;
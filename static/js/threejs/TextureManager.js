class TextureManager {
    constructor() {
        this.textureCache = new Map();
        this.atlasCache = new Map();
        this.uvMappings = new Map();
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 64;  // Power of 2 for better performance
        this.canvas.height = 64;

        // Ensure FontAwesome is loaded
        this.fontAwesomeLoaded = this.checkFontAwesome();

        // Atlas configuration
        this.useAtlas = true; // Enable atlas by default
        this.currentAtlasId = null;
    }

    checkFontAwesome() {
        // Check if FontAwesome is available
        try {
            const testElement = document.createElement('i');
            testElement.className = 'fas fa-user';
            testElement.style.fontFamily = 'Font Awesome 6 Free';
            document.body.appendChild(testElement);
            const computedStyle = window.getComputedStyle(testElement);
            const isLoaded = computedStyle.fontFamily.includes('Font Awesome');
            document.body.removeChild(testElement);
            return isLoaded;
        } catch (e) {
            console.warn('FontAwesome check failed:', e);
            return false;
        }
    }

    createIconTexture(iconClass, options = {}) {
        const {
            size = 64,
            backgroundColor = 'transparent',
            iconColor = '#ffffff',
            padding = 8
        } = options;

        // Create cache key
        const cacheKey = `${iconClass}-${size}-${backgroundColor}-${iconColor}-${padding}`;

        // Return cached texture if available
        if (this.textureCache.has(cacheKey)) {
            return this.textureCache.get(cacheKey);
        }

        // Set canvas size
        this.canvas.width = size;
        this.canvas.height = size;

        // Clear canvas
        this.ctx.clearRect(0, 0, size, size);

        // Set background
        if (backgroundColor !== 'transparent') {
            this.ctx.fillStyle = backgroundColor;
            this.ctx.fillRect(0, 0, size, size);
        }

        // Configure text rendering
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = iconColor;

        // Calculate font size based on canvas size and padding
        const fontSize = size - (padding * 2);

        // Set font - try different FontAwesome font families
        const fontFamilies = [
            'Font Awesome 6 Free',
            'Font Awesome 5 Free',
            'FontAwesome',
            'Arial' // fallback
        ];

        let fontSet = false;
        for (const fontFamily of fontFamilies) {
            this.ctx.font = `900 ${fontSize}px "${fontFamily}"`;
            // Test if font is available by checking width of a known character
            if (this.ctx.measureText('\uf007').width > 0) { // fa-user unicode
                fontSet = true;
                break;
            }
        }

        if (!fontSet) {
            console.warn('FontAwesome font not found, using fallback');
            this.ctx.font = `${fontSize}px Arial`;
        }

        // Get the unicode character for the icon
        const unicode = this.getIconUnicode(iconClass);

        if (unicode) {
            // Draw the icon
            this.ctx.fillText(unicode, size / 2, size / 2);
        } else {
            // Fallback: draw a simple shape
            this.drawFallbackShape(iconClass, size, padding);
        }

        // Create Three.js texture
        const texture = new THREE.CanvasTexture(this.canvas);
        texture.generateMipmaps = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // Cache the texture
        this.textureCache.set(cacheKey, texture);

        return texture;
    }

    getIconUnicode(iconClass) {
        // Comprehensive map of FontAwesome icons to their unicode values
        const iconMap = {
            // Basic icons
            'fa-user': '\uf007',
            'fa-users': '\uf0c0',
            'fa-skull': '\uf54c',
            'fa-skull-crossbones': '\uf714',
            'fa-box': '\uf466',
            'fa-cube': '\uf1b2',
            'fa-gem': '\uf3a5',
            'fa-star': '\uf005',
            'fa-heart': '\uf004',
            'fa-circle': '\uf111',
            'fa-square': '\uf0c8',
            'fa-question': '\uf128',
            'fa-question-circle': '\uf059',

            // Nature and environment
            'fa-tree': '\uf1bb',
            'fa-mountain': '\uf6fc',
            'fa-sun': '\uf185',
            'fa-moon': '\uf186',
            'fa-cloud': '\uf0c2',
            'fa-snowflake': '\uf2dc',
            'fa-leaf': '\uf06c',
            'fa-fire': '\uf06d',
            'fa-bolt': '\uf0e7',
            'fa-water': '\uf773',
            'fa-eye': '\uf06e',
            'fa-cave': '\uf6a0',
            'fa-desert': '\uf3ff',
            'fa-forest': '\uf6fa',

            // Weapons and equipment
            'fa-sword': '\uf71c',
            'fa-shield': '\uf132',
            'fa-shield-alt': '\uf3ed',
            'fa-flask': '\uf0c3',
            'fa-hammer': '\uf6e3',
            'fa-bow-arrow': '\uf6b9',
            'fa-magic': '\uf0d0',
            'fa-wand-magic': '\uf72a',

            // Items and treasures
            'fa-coins': '\uf51e',
            'fa-key': '\uf084',
            'fa-lock': '\uf023',
            'fa-unlock': '\uf09c',
            'fa-ring': '\uf70b',
            'fa-crown': '\uf521',
            'fa-chess-rook': '\uf447',
            'fa-chess-king': '\uf43f',
            'fa-chess-queen': '\uf445',

            // Creatures and monsters
            'fa-dragon': '\uf6d5',
            'fa-spider': '\uf717',
            'fa-bug': '\uf188',
            'fa-ghost': '\uf6e2',
            'fa-wolf-pack-battalion': '\uf514',

            // Actions and movement
            'fa-walking': '\uf554',
            'fa-running': '\uf70c',
            'fa-fist-raised': '\uf6de',
            'fa-hand-paper': '\uf256',
            'fa-arrows-alt': '\uf0b2',
            'fa-arrow-up': '\uf062',
            'fa-arrow-down': '\uf063',
            'fa-arrow-left': '\uf060',
            'fa-arrow-right': '\uf061',

            // Buildings and structures
            'fa-home': '\uf015',
            'fa-castle': '\uf6da',
            'fa-church': '\uf51d',
            'fa-store': '\uf54e',
            'fa-warehouse': '\uf494',
            'fa-building': '\uf1ad',
            'fa-door-open': '\uf52b',
            'fa-door-closed': '\uf52a',

            // Tools and objects
            'fa-tools': '\uf7d9',
            'fa-cog': '\uf013',
            'fa-wrench': '\uf0ad',
            'fa-screwdriver': '\uf54a',
            'fa-book': '\uf02d',
            'fa-scroll': '\uf70e',
            'fa-map': '\uf279',
            'fa-compass': '\uf14e',

            // Food and potions
            'fa-apple-alt': '\uf5d1',
            'fa-bread-slice': '\uf7ec',
            'fa-cheese': '\uf7ef',
            'fa-fish': '\uf578',
            'fa-beer': '\uf0fc',
            'fa-wine-bottle': '\uf72f',

            // Elements and magic
            'fa-icicles': '\uf7ad',
            'fa-temperature-high': '\uf769',
            'fa-temperature-low': '\uf76b',
            'fa-wind': '\uf72e',
            'fa-meteor': '\uf753',
            'fa-radiation': '\uf7b9',

            // Status and effects
            'fa-plus': '\uf067',
            'fa-minus': '\uf068',
            'fa-times': '\uf00d',
            'fa-check': '\uf00c',
            'fa-exclamation': '\uf12a',
            'fa-exclamation-triangle': '\uf071',
            'fa-ban': '\uf05e'
        };

        // Extract the actual icon name from the class string
        const matches = iconClass.match(/fa-([a-z-]+)/g);
        if (matches && matches.length > 0) {
            const iconName = matches[matches.length - 1]; // Get the last match (actual icon name)
            return iconMap[iconName] || iconMap['fa-question']; // fallback to question mark
        }

        return iconMap['fa-question'];
    }

    drawFallbackShape(iconClass, size, padding) {
        // Draw simple geometric shapes as fallbacks
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = (size - padding * 2) / 2;

        this.ctx.strokeStyle = this.ctx.fillStyle;
        this.ctx.lineWidth = 2;

        if (iconClass.includes('user') || iconClass.includes('player')) {
            // Draw a simple person shape
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.fillRect(centerX - radius * 0.4, centerY, radius * 0.8, radius * 0.8);
        } else if (iconClass.includes('skull') || iconClass.includes('enemy')) {
            // Draw an X for enemies
            this.ctx.beginPath();
            this.ctx.moveTo(centerX - radius, centerY - radius);
            this.ctx.lineTo(centerX + radius, centerY + radius);
            this.ctx.moveTo(centerX + radius, centerY - radius);
            this.ctx.lineTo(centerX - radius, centerY + radius);
            this.ctx.stroke();
        } else if (iconClass.includes('box') || iconClass.includes('item')) {
            // Draw a square for items
            this.ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        } else if (iconClass.includes('tree')) {
            // Draw a simple tree
            this.ctx.fillRect(centerX - radius * 0.1, centerY, radius * 0.2, radius * 0.5);
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY - radius * 0.2, radius * 0.4, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            // Default: draw a circle
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    // Create texture for floor tiles with icon overlay
    createFloorTexture(cellType, options = {}) {
        const {
            size = 64,
            iconColor = '#ffffff',
            padding = 12,
            showIcon = true
        } = options;

        const backgroundColor = cellType.map_color || '#888888';

        if (!showIcon) {
            // Just return a solid color texture
            return this.createSolidColorTexture(backgroundColor, size);
        }

        return this.createIconTexture(cellType.font_awesome_icon, {
            size,
            backgroundColor,
            iconColor,
            padding
        });
    }

    createSolidColorTexture(color, size = 64) {
        const cacheKey = `solid-${color}-${size}`;

        if (this.textureCache.has(cacheKey)) {
            return this.textureCache.get(cacheKey);
        }

        this.canvas.width = size;
        this.canvas.height = size;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(this.canvas);
        texture.generateMipmaps = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        this.textureCache.set(cacheKey, texture);
        return texture;
    }

    // Clear cache to free memory
    clearCache() {
        for (const texture of this.textureCache.values()) {
            texture.dispose();
        }
        this.textureCache.clear();
    }

    dispose() {
        this.clearCache();
        this.clearAtlasCache();
    }

    // Texture Atlas Methods
    /**
     * Load texture atlas and UV mappings from server
     * @param {string} atlasId - The ID of the atlas to load.
     * @returns {Promise<object>} - A promise that resolves with the atlas data.
     */
    async loadTextureAtlas(atlasId) {
        if (this.atlasCache.has(atlasId)) {
            return this.atlasCache.get(atlasId);
        }

        try {
            // Get atlas metadata
            const response = await fetch(`/api/textures/${atlasId}`);
            if (!response.ok) {
                throw new Error(`Failed to load atlas metadata: ${response.status}`);
            }

            const atlasInfo = await response.json();

            // Load atlas image
            const imageResponse = await fetch(`/api/textures/${atlasId}/image`);
            if (!imageResponse.ok) {
                throw new Error(`Failed to load atlas image: ${imageResponse.status}`);
            }

            const imageBlob = await imageResponse.blob();
            const imageUrl = URL.createObjectURL(imageBlob);

            // Create Three.js texture from image
            const texture = await new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(
                    imageUrl,
                    (texture) => {
                        texture.generateMipmaps = false;
                        texture.wrapS = THREE.ClampToEdgeWrapping;
                        texture.wrapT = THREE.ClampToEdgeWrapping;
                        texture.minFilter = THREE.LinearFilter;
                        texture.magFilter = THREE.LinearFilter;
                        resolve(texture);
                    },
                    undefined,
                    reject
                );
            });

            // Store atlas data
            const atlasData = {
                texture: texture,
                info: atlasInfo,
                imageUrl: imageUrl
            };

            this.atlasCache.set(atlasId, atlasData);
            this.uvMappings.set(atlasId, atlasInfo.cells);
            this.currentAtlasId = atlasId;

            console.log(`Loaded texture atlas ${atlasId} with ${Object.keys(atlasInfo.cells).length} cells`);
            return atlasData;

        } catch (error) {
            console.error(`Failed to load texture atlas ${atlasId}:`, error);
            throw error;
        }
    }

    /**
     * Create texture using UV coordinates from atlas
     * @param {object} cellType - The cell type to create a texture for.
     * @param {string|null} atlasId - The ID of the atlas to use.
     * @returns {THREE.Texture} - The configured texture.
     */
    createAtlasTexture(cellType, atlasId = null) {
        const targetAtlasId = atlasId || this.currentAtlasId;

        if (!targetAtlasId || !this.atlasCache.has(targetAtlasId)) {
            console.warn(`Atlas ${targetAtlasId} not loaded, falling back to Font Awesome`);
            return this.createFallbackTexture(cellType);
        }

        const atlasData = this.atlasCache.get(targetAtlasId);
        const uvMappings = this.uvMappings.get(targetAtlasId);

        // Find UV mapping for cell type
        const cellMapping = uvMappings[cellType.id] || uvMappings[cellType.name];

        if (!cellMapping) {
            console.warn(`No UV mapping found for cell type ${cellType.id || cellType.name}, using fallback`);
            return this.createFallbackTexture(cellType);
        }

        // Create cache key
        const cacheKey = `atlas-${targetAtlasId}-${cellType.id || cellType.name}`;

        // Return cached texture if available
        if (this.textureCache.has(cacheKey)) {
            return this.textureCache.get(cacheKey);
        }

        // Clone the atlas texture
        const texture = atlasData.texture.clone();
        texture.needsUpdate = true;

        // Set UV offset and repeat for this cell
        texture.offset.set(cellMapping.uv_x, cellMapping.uv_y);
        texture.repeat.set(cellMapping.uv_width, cellMapping.uv_height);

        // Cache the texture
        this.textureCache.set(cacheKey, texture);

        return texture;
    }

    /**
     * Enhanced fallback using procedural generation or Font Awesome
     * @param {object} cellType - The cell type to create a fallback texture for.
     * @returns {THREE.Texture} - The fallback texture.
     */
    createFallbackTexture(cellType) {
        // Try Font Awesome first
        if (cellType.font_awesome_icon) {
            return this.createFloorTexture(cellType, {
                size: 64,
                iconColor: '#ffffff',
                padding: 8,
                showIcon: true
            });
        }

        // Generate simple color texture
        return this.createSolidColorTexture(cellType.map_color || '#888888', 64);
    }

    /**
     * Generate a new texture atlas for the given cell types
     * @param {string} generatorId - The ID of the game generator.
     * @param {string} themeDescription - The description of the game theme.
     * @param {Array<object>} cellTypes - The cell types to include in the atlas.
     * @returns {Promise<string>} - A promise that resolves with the new atlas ID.
     */
    async generateAtlasForCellTypes(generatorId, themeDescription, cellTypes) {
        try {
            const response = await fetch('/api/textures/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    generator_id: generatorId,
                    theme_description: themeDescription,
                    cell_types: cellTypes,
                    atlas_size: 1024,
                    grid_size: 4,
                    use_ai: false  // Use placeholder for now
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to generate atlas: ${response.status}`);
            }

            const atlasInfo = await response.json();
            console.log(`Generated texture atlas ${atlasInfo.atlas_id} for generator ${generatorId}`);

            // Load the generated atlas
            await this.loadTextureAtlas(atlasInfo.atlas_id);

            return atlasInfo.atlas_id;

        } catch (error) {
            console.error('Failed to generate texture atlas:', error);
            throw error;
        }
    }

    // Clear atlas cache
    clearAtlasCache() {
        for (const atlasData of this.atlasCache.values()) {
            if (atlasData.texture) {
                atlasData.texture.dispose();
            }
            if (atlasData.imageUrl) {
                URL.revokeObjectURL(atlasData.imageUrl);
            }
        }
        this.atlasCache.clear();
        this.uvMappings.clear();
        this.currentAtlasId = null;
    }

    // Get current atlas info
    getCurrentAtlasInfo() {
        if (!this.currentAtlasId || !this.atlasCache.has(this.currentAtlasId)) {
            return null;
        }
        return this.atlasCache.get(this.currentAtlasId).info;
    }
}

// Export for use in other modules
window.TextureManager = TextureManager;
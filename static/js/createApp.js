function getRGBFromHashHex(hhex) {
    const hex = hhex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return [r, g, b];
}
function scaleColor(hhex, scale) {
    const [r, g, b] = getRGBFromHashHex(hhex);
    return `rgb(${Math.floor(r * scale)}, ${Math.floor(g * scale)}, ${Math.floor(b * scale)})`;
}

function updatePlayerPosition(x, y, force = false) {
    const playerIcon = document.getElementById('player-icon');
    const cell = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (!cell || !playerIcon) return;

    const gameMap = document.querySelector('.game-map');
    if (!gameMap) return;

    // If not forcing update and position hasn't changed, skip update
    if (!force &&
        playerIcon.dataset.x === x.toString() &&
        playerIcon.dataset.y === y.toString()) {
        return;
    }

    const cellRect = cell.getBoundingClientRect();
    const mapRect = gameMap.getBoundingClientRect();

    const offsetX = cellRect.left - mapRect.left;
    const offsetY = cellRect.top - mapRect.top;

    // Store the position as data attributes
    playerIcon.dataset.x = x;
    playerIcon.dataset.y = y;

    // Update position without resetting transforms
    // Remove the following line to allow CSS transitions to handle movement
    // playerIcon.style.transform = 'none';
    playerIcon.style.width = `${cellRect.width}px`;
    playerIcon.style.height = `${cellRect.height}px`;
    playerIcon.style.left = `${offsetX}px`;
    playerIcon.style.top = `${offsetY}px`;
}

// Correct showLoading function
let loadingInterval;

function showLoading() {
    const loadingElement = document.getElementById('loading');
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingElement && loadingOverlay) {
        // Reset the progress bar animation
        const progressBar = loadingOverlay.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.animation = 'none';
            progressBar.offsetHeight; // Trigger reflow
            progressBar.style.animation = 'progress-animation 40s linear forwards';
        }
        loadingOverlay.style.display = 'flex';
        loadingInterval = setInterval(() => {
            const dots = loadingElement.querySelector('.loading-dots');
            if (dots) {
                dots.textContent = '.'.repeat((dots.textContent.length % 3) + 1);
            }
        }, 500);
    }
}

// Correct hideLoading function
function hideLoading() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
        const progressBar = loadingOverlay.querySelector('.progress-bar');
        if (progressBar) {
            // Reset the animation
            progressBar.style.animation = 'none';
            progressBar.style.width = '100%';
        }
        // Delay hiding to show completion
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        }, 500);
    }
    if (loadingInterval) {
        clearInterval(loadingInterval);
    }
}

const app = Vue.createApp({
    data() {
        return {
            isGameInitialized: false,
            isLoading: true,
            isMoveInProgress: false,
            gameState: {
                player: {
                    name: 'Player',
                    font_awesome_icon: 'fas fa-user'
                },
                player_pos: [0, 0], // Start at top-left
                player_pos_prev: [0, 0],
                player_hp: 100,
                player_max_hp: 100,
                player_attack: 15,
                player_defense: 0,
                player_xp: 0,
                inventory: [],
                equipment: {
                    weapon: null,
                    armor: null
                },
                explored: [],
                in_combat: false,
                current_enemy: null,
                game_over: false,
                temporary_effects: {},
                game_title: 'RogueLLM'
            },
            gameLogs: [],
            ws: null,
            gameTitle: 'RogueLLM: Unknown Title',
            isMenuOpen: false,
            isDebugPanelOpen: false,
            errorMessage: null,
            generatorId: null,
            showShareNotification: false,
            // Three.js related
            threeRenderer: null,
            use3D: true // Toggle between 2D and 3D rendering
        }
    },
    computed: {
        getPlayerHealthPercentage() {
            return (this.gameState.player_hp / this.gameState.player_max_hp) * 100;
        },
        getEnemyHealthPercentage() {
            if (!this.gameState.current_enemy) return 0;
            return (this.gameState.current_enemy.hp / this.gameState.current_enemy.max_hp) * 100;
        },
        countExploredTiles() {
            if (this.gameState && this.gameState.explored_tiles !== undefined) {
                return this.gameState.explored_tiles;
            }
            // Fallback to counting from explored array if needed
            if (this.gameState && this.gameState.explored) {
                return this.gameState.explored.reduce((total, row) =>
                    total + row.reduce((rowTotal, cell) => rowTotal + (cell ? 1 : 0), 0), 0
                );
            }
            return 0;
        }
    },
    methods: {
        getCellStyle(x, y) {
            if (!this.gameState.cell_types || this.gameState.cell_types.length === 0) return {};

            const cellType = this.gameState.cell_types[y][x];
            const isExplored = this.gameState.explored[y][x];

            const scaleBg = isExplored ? 0.6 : 0.5; // Unexplored cells are darker
            const scaleFg = isExplored ? 0.9 : 0.8; // Unexplored cells are darker

            return {
                backgroundColor: scaleColor(cellType.map_color, scaleBg),
                color: scaleColor(cellType.map_color, scaleFg)
            };
        },
        getCellIcon(x, y) {
            // Check if there's an enemy at this position (either active or defeated)
            const enemy = this.gameState.enemies.find(e => e.x === x && e.y === y) ||
                this.gameState.defeated_enemies.find(e => e.x === x && e.y === y);
            if (enemy) {
                const baseClass = enemy.font_awesome_icon;
                const enemyClass = enemy.is_defeated ? 'enemy-icon defeated' : 'enemy-icon';
                return `${baseClass} ${enemyClass}`;
            }
            return this.gameState.cell_types[y][x].font_awesome_icon;
        },
        toggleMenu() {
            this.isMenuOpen = !this.isMenuOpen;
        },
        toggleDebugPanel() {
            this.isDebugPanelOpen = !this.isDebugPanelOpen;
            if (this.isDebugPanelOpen) {
                this.isMenuOpen = false;  // Close the menu when debug panel opens
            }
        },
        closeMenuIfClickedOutside(event) {
            const menu = document.querySelector('.popup-menu');
            const menuIcon = document.querySelector('.menu-icon');
            const title = document.querySelector('h1');

            if (!menu.contains(event.target) &&
                !menuIcon.contains(event.target) &&
                !title.contains(event.target)) {
                this.isMenuOpen = false;
            }
        },
        async shareGame() {
            if (!this.generatorId) return;

            // Create the share URL with generator_id (this will create a new session for the recipient)
            const shareUrl = `${window.location.origin}/game?game_id=${this.generatorId}`;

            try {
                await navigator.clipboard.writeText(shareUrl);
                this.showShareNotification = true;
                setTimeout(() => {
                    this.showShareNotification = false;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy URL:', err);
            }

            this.isMenuOpen = false;
        },
        async initWebSocket() {
            // Extract session ID from URL path
            const pathParts = window.location.pathname.split('/');
            const sessionId = pathParts[2]; // /game/{session_id}

            if (!sessionId) {
                console.error('No session ID found in URL');
                this.errorMessage = 'Invalid game session';
                return;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/game/${sessionId}`);

            this.ws.onmessage = async (event) => {
                if (!event.data) {
                    console.warn("Received empty message, ignoring");
                    return;
                }

                try {
                    const response = JSON.parse(event.data);
                    console.log("Received message:", response);

                    // Handle different message types
                    if (response.type === 'status') {
                        // Update loading message during game creation
                        const loadingMessage = document.querySelector('#loading-message');
                        if (loadingMessage) {
                            loadingMessage.textContent = response.message;
                        }

                        if (response.status === 'ready') {
                            // Game is ready, request initial state
                            this.ws.send(JSON.stringify({ action: 'get_initial_state' }));
                        }
                        return;
                    }

                    if (response.type === 'error') {
                        console.error("WebSocket error:", response.message);
                        this.errorMessage = response.message;
                        hideLoading();
                        return;
                    }

                    if (response.type === 'connection_established') {
                        console.log("Connection established");
                        if (response.generator_id) {
                            this.generatorId = response.generator_id;
                        }
                        // Request initial state
                        this.ws.send(JSON.stringify({ action: 'get_initial_state' }));
                        return;
                    }

                    // Handle game state updates
                    this.handleGameState(response);

                } catch (error) {
                    console.error("Error parsing WebSocket message:", error);
                }
            };

            this.ws.onclose = (event) => {
                if (event.code === 1006) {
                    // Redirect to landing page if connection fails
                    window.location.href = '/';
                } else {
                    setTimeout(() => this.initWebSocket(), 5000);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        },
        async restartGame() {
            // Show loading overlay
            const loadingOverlay = document.querySelector('.loading-overlay');
            const loadingMessage = document.querySelector('#loading-message');
            const progressBar = loadingOverlay.querySelector('.progress-bar');

            // Reset and restart the progress bar animation
            if (progressBar) {
                progressBar.style.animation = 'none';
                progressBar.offsetHeight; // Trigger reflow
                progressBar.style.animation = 'progress-animation 10s linear forwards';
            }

            loadingMessage.textContent = 'Restarting game...';
            loadingOverlay.style.display = 'flex';

            try {
                // Send restart message through WebSocket
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        action: 'restart'
                    }));
                }
                // Note: We'll let the WebSocket update handler hide the overlay when new state arrives
            } catch (error) {
                this.errorMessage = 'Failed to restart game: ' + error.message;
                // Only hide overlay on error
                loadingOverlay.style.display = 'none';
            }
        },
        getNextPosition(direction) {
            const [x, y] = this.gameState.player_pos;
            switch (direction) {
                case 'n': return [x, y - 1];
                case 's': return [x, y + 1];
                case 'w': return [x - 1, y];
                case 'e': return [x + 1, y];
                default: return [x, y];
            }
        },
        move(direction) {
            // Don't allow moves during combat or while another move is in progress
            if (this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                !this.gameState.game_over &&
                !this.gameState.in_combat &&
                !this.isMoveInProgress) {

                this.isMoveInProgress = true;

                // Start animation immediately if move is valid
                if (this.canMove(direction)) {
                    const [nextX, nextY] = this.getNextPosition(direction);
                    updatePlayerPosition(nextX, nextY);
                }

                this.ws.send(JSON.stringify({
                    action: 'move',
                    direction: direction
                }));
            }
        },
        attack() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.gameState.game_over) {
                this.ws.send(JSON.stringify({
                    action: 'attack'
                }));
            }
        },
        run() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.gameState.game_over) {
                this.ws.send(JSON.stringify({
                    action: 'run'
                }));
            }
        },
        isPlayerPosition(x, y) {
            return this.gameState &&
                this.gameState.player_pos[0] === x &&
                this.gameState.player_pos[1] === y;
        },
        canMove(direction) {
            if (!this.gameState || this.gameState.in_combat) return false;
            const [x, y] = this.gameState.player_pos;
            switch (direction) {
                case 'n': return y > 0;
                case 's': return y < this.gameState.map_height - 1;
                case 'w': return x > 0;
                case 'e': return x < this.gameState.map_width - 1;
                default: return false;
            }
        },
        // Items
        useItem(itemId) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    action: 'use_item',
                    item_id: itemId
                }));
            }
        },
        equipItem(itemId) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    action: 'equip_item',
                    item_id: itemId
                }));
            }
        },
        newGame(openInNewTab = false) {
            // Send a POST request to the server to clear the session
            fetch('/logout', {
                method: 'POST',
                credentials: 'include'
            })
                .then(response => {
                    if (response.redirected) {
                        // Redirect to the landing page
                        if (openInNewTab) {
                            window.open(response.url, '_blank');
                        } else {
                            window.location.href = response.url;
                        }
                    } else {
                        // Handle error if logout was not successful
                        console.error('Failed to start a new game.');
                    }
                })
                .catch(error => {
                    console.error('Error starting new game:', error);
                });
        },
        handleWindowResize() {
            // Force position update on resize
            const playerIcon = document.getElementById('player-icon');
            if (playerIcon && playerIcon.dataset.x && playerIcon.dataset.y) {
                updatePlayerPosition(parseInt(playerIcon.dataset.x), parseInt(playerIcon.dataset.y), true);
            } else if (this.gameState && this.gameState.player_pos) {
                const [x, y] = this.gameState.player_pos;
                updatePlayerPosition(x, y, true);
            }
        },
        handleGameState(response) {
            if (response.type === 'game_state' || response.type === 'update') {
                // Store previous position for animation
                if (this.gameState.player_pos) {
                    this.gameState.player_pos_prev = [...this.gameState.player_pos];
                }

                // Handle both 'game_state' (with data property) and 'update' (with state property)
                const newState = response.data || response.state;
                if (newState) {
                    this.gameState = { ...this.gameState, ...newState };

                    // Set game as initialized
                    this.isGameInitialized = true;

                    // Update game title if present
                    if (newState.game_title) {
                        this.gameTitle = newState.game_title;
                    }
                }

                // Add description to game log if present
                if (response.description) {
                    this.gameLogs.push(response.description);
                }

                // Update 3D scene if renderer is active
                if (this.use3D) {
                    this.update3DScene();
                }

                // Update player position for 2D rendering (if not using 3D)
                if (!this.use3D && this.gameState.player_pos) {
                    this.$nextTick(() => {
                        updatePlayerPosition(this.gameState.player_pos[0], this.gameState.player_pos[1], true);
                    });
                }

                this.isMoveInProgress = false;
                hideLoading();
            } else if (response.type === 'game_log') {
                this.gameLogs.push(response.data);
            } else if (response.type === 'error') {
                this.errorMessage = response.data.message;
                this.isMoveInProgress = false;
                hideLoading();
            }
        },
        toggle3D() {
            this.use3D = !this.use3D;
            if (this.use3D) {
                this.init3DRenderer();
            } else {
                this.dispose3DRenderer();
            }
        },
        init3DRenderer() {
            if (this.threeRenderer) {
                this.dispose3DRenderer();
            }

            const container = document.getElementById('threejs-container');
            if (container && window.ThreeJSRenderer) {
                this.threeRenderer = new ThreeJSRenderer(container, this.gameState);

                // Add click handler for movement
                container.addEventListener('click', (event) => {
                    if (this.gameState.in_combat) return;

                    const clickPos = this.threeRenderer.onMapClick(event);
                    if (clickPos) {
                        this.moveToPosition(clickPos.x, clickPos.y);
                    }
                });

                // Add listener for 3D arrow movement
                this.arrowMoveHandler = (event) => {
                    const direction = event.detail.direction;
                    if (direction && this.canMove(direction)) {
                        this.move(direction);
                    }
                };
                window.addEventListener('arrow-move', this.arrowMoveHandler);

                // Update the 3D scene with current game state
                this.update3DScene();
            }
        },
        dispose3DRenderer() {
            if (this.threeRenderer) {
                this.threeRenderer.dispose();
                this.threeRenderer = null;
            }

            // Remove the arrow movement event listener
            window.removeEventListener('arrow-move', this.arrowMoveHandler);
        },
        update3DScene() {
            if (this.threeRenderer && this.gameState) {
                this.threeRenderer.updateGameMap(this.gameState);
            }
        },
        moveToPosition(targetX, targetY) {
            // Calculate path and move step by step
            const currentX = this.gameState.player_pos[0];
            const currentY = this.gameState.player_pos[1];

            const deltaX = targetX - currentX;
            const deltaY = targetY - currentY;

            // Move one step at a time
            let direction = null;
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                direction = deltaX > 0 ? 'e' : 'w';
            } else {
                direction = deltaY > 0 ? 's' : 'n';
            }

            if (direction && this.canMove(direction)) {
                this.move(direction);
            }
        }
    },
    mounted() {
        // Show loading screen
        showLoading();

        // Track game page view
        if (window.analytics) {
            analytics.logEvent('game_page_view', {
                page_title: this.gameTitle,
                page_location: window.location.href,
                page_path: window.location.pathname
            });
        }

        // Initialize WebSocket connection
        this.initWebSocket();

        // Add event listeners
        document.addEventListener('click', this.closeMenuIfClickedOutside);
        window.addEventListener('resize', this.handleWindowResize);

        // Get initial title from SSR if available
        const h1 = document.querySelector('h1');
        if (h1 && h1.dataset.initialTitle) {
            this.gameTitle = h1.dataset.initialTitle;
        }

        // Initialize 3D renderer if Three.js is available
        this.$nextTick(() => {
            if (this.use3D && window.THREE) {
                this.init3DRenderer();
            }
        });
    },
    beforeUnmount() {
        document.removeEventListener('click', this.closeMenuIfClickedOutside);
        // Remove the resize event listener
        window.removeEventListener('resize', this.handleWindowResize);

        // Clear loading interval if it exists
        if (loadingInterval) {
            clearInterval(loadingInterval);
        }

        // Dispose 3D renderer
        this.dispose3DRenderer();
    },
    watch: {
        // Watch for changes in player position
        'gameState.player_pos': function (newVal, oldVal) {
            // Only update if position has actually changed
            if (!oldVal || newVal[0] !== oldVal[0] || newVal[1] !== oldVal[1]) {
                this.$nextTick(() => {
                    const [x, y] = newVal;
                    updatePlayerPosition(x, y);
                });
            }
        },
        // Watch for changes in combat state
        'gameState.in_combat': function (newVal, oldVal) {
            if (!newVal) { // Combat has ended
                const [x, y] = this.gameState.player_pos;
                this.$nextTick(() => {
                    updatePlayerPosition(x, y, true); // Force update
                });
            }
        },
        // Watch for changes in game title
        'gameState.game_title': function (newVal) {
            if (newVal) {
                this.gameTitle = newVal;
            }
        },
        // Add watcher for isGameInitialized
        isGameInitialized(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    // Force update player position when game is initialized
                    updatePlayerPosition(
                        this.gameState.player_pos[0],
                        this.gameState.player_pos[1],
                        true
                    );
                });
                // Note: Loading screen is now hidden in handleGameState method
            }
        },
        'gameState.game_over'(newValue) {
            if (newValue === true) {
                this.preventNavigation = false;
            }
        },
        use3D(newVal) {
            if (newVal) {
                this.init3DRenderer();
            } else {
                this.dispose3DRenderer();
            }
        }
    }
});

// Create i18n instance
const i18n = VueI18n.createI18n({
    locale: 'en', // will be updated before mounting
    fallbackLocale: 'en',
    messages: {
        en: {}, // Will be loaded dynamically
        it: {}, // Will be loaded dynamically
        ja: {}, // Will be loaded dynamically
        es: {}, // Spanish
        'zh-Hans': {}, // Simplified Chinese
        'zh-Hant': {} // Traditional Chinese
    }
});

// Load translations
async function loadTranslations() {
    try {
        // First load all translations
        const [enResponse, itResponse, jaResponse, esResponse, zhHantResponse, zhHansResponse] = await Promise.all([
            fetch('/static/translations/en.json'),
            fetch('/static/translations/it.json'),
            fetch('/static/translations/ja.json'),
            fetch('/static/translations/es.json'),
            fetch('/static/translations/zh-Hans.json'),
            fetch('/static/translations/zh-Hant.json')
        ]);

        const [enMessages, itMessages, jaMessages, esMessages, zhHansMessages, zhHantMessages] = await Promise.all([
            enResponse.json(),
            itResponse.json(),
            jaResponse.json(),
            esResponse.json(),
            zhHansResponse.json(),
            zhHantResponse.json()
        ]);

        // Set all messages
        i18n.global.setLocaleMessage('en', enMessages);
        i18n.global.setLocaleMessage('it', itMessages);
        i18n.global.setLocaleMessage('ja', jaMessages);
        i18n.global.setLocaleMessage('es', esMessages);
        i18n.global.setLocaleMessage('zh-Hans', zhHansMessages);
        i18n.global.setLocaleMessage('zh-Hant', zhHantMessages);

        // Set the preferred language before mounting
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');

        // Use URL language or localStorage language
        if (urlLang && ['en', 'it', 'ja', 'es', 'zh-Hans', 'zh-Hant'].includes(urlLang)) {
            i18n.global.locale = urlLang;
            localStorage.setItem('preferredLanguage', urlLang);
        } else {
            const storedLang = localStorage.getItem('preferredLanguage');
            if (storedLang && ['en', 'it', 'ja', 'es', 'zh-Hans', 'zh-Hant'].includes(storedLang)) {
                i18n.global.locale = storedLang;
            }
        }
    } catch (error) {
        console.error('Error loading translations:', error);
    }
}

// Load translations and then mount the app
loadTranslations().then(() => {
    app.use(i18n);
    app.mount('#app');
});

// Touch Handlers
document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}, { passive: false });

document.addEventListener('touchmove', function (event) {
    event.preventDefault();
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Prevent context menu on long press
document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
}, false);

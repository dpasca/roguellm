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
            showShareNotification: false
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
        async initializeGame(generatorId) {
            try {
                const response = await fetch('/api/create_game', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        generator_id: generatorId
                    })
                });
                if (!response.ok) {
                    throw new Error('Failed to initialize game');
                }
                // The WebSocket connection will handle the game state update
                return true;
            } catch (error) {
                console.error('Error initializing game:', error);
                throw error;
            }
        },
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

            // Create the share URL with generator_id
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
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/game`);

            this.ws.onmessage = async (event) => {
                if (!event.data) {
                    console.warn("Received empty message, ignoring");
                    return;
                }
                //console.log('Received message:', event.data);
                try {
                    const response = JSON.parse(event.data);
                    if (!response || !response.type) {
                        console.warn('Received message with no type:', event.data);
                        return;
                    }

                    if (response.type === 'connection_established') {
                        // Request initial state once connection is confirmed
                        this.ws.send(JSON.stringify({
                            action: 'get_initial_state'
                        }));
                        return;
                    }

                    if (response.type === 'update') {
                        console.log('Received state update:', response.state);
                        const wasInCombat = this.gameState.in_combat;
                        this.gameState = response.state;

                        // Update game title
                        if (response.state.game_title) {
                            console.log('Setting game title to:', response.state.game_title);
                            this.gameTitle = response.state.game_title;
                            document.title = response.state.game_title; // Also update page title
                        }

                        // If we just entered combat, make sure player position is correct
                        if (!wasInCombat && this.gameState.in_combat) {
                            updatePlayerPosition(
                                this.gameState.player_pos[0],
                                this.gameState.player_pos[1],
                                true
                            );
                            // Clear any pending movement state
                            this.isMoveInProgress = false;
                        }

                        // Reset move in progress flag after any state update
                        this.isMoveInProgress = false;

                        if (response.description) {
                            this.gameLogs.push(response.description);
                        }
                        // Hide loading overlay when we get a new game state
                        const loadingOverlay = document.querySelector('.loading-overlay');
                        if (loadingOverlay) {
                            loadingOverlay.style.display = 'none';
                        }
                        if (!this.isGameInitialized) {
                            console.log('Initial game state received:', this.gameState);
                            if (this.gameState.game_title) {
                                console.log('Setting initial game title to:', this.gameState.game_title);
                                this.gameTitle = this.gameState.game_title;
                                document.title = this.gameState.game_title;
                            }
                            this.isGameInitialized = true;
                        } else {
                            if (response.description) {
                                this.$nextTick(() => {
                                    const gameLog = document.querySelector('.game-log');
                                    gameLog.scrollTop = gameLog.scrollHeight;
                                });
                            }
                        }
                        if (this.gameState.game_title) {
                            this.gameTitle = this.gameState.game_title;
                        }
                        // Store generator ID if provided
                        if (response.generator_id) {
                            this.generatorId = response.generator_id;
                            // Update URL with generator ID when received
                            const newUrl = `${window.location.pathname}?game_id=${response.generator_id}`;
                            window.history.replaceState({}, '', newUrl);
                        }
                        // Only update position if it doesn't match what we predicted
                        const [expectedX, expectedY] = this.gameState.player_pos;
                        const playerIcon = document.getElementById('player-icon');
                        if (playerIcon &&
                            (playerIcon.dataset.x !== expectedX.toString() ||
                             playerIcon.dataset.y !== expectedY.toString())) {
                            this.$nextTick(() => {
                                updatePlayerPosition(expectedX, expectedY);
                            });
                        }
                    } else if (response.type === 'error') {
                        this.errorMessage = response.message;
                        setTimeout(() => {
                            this.errorMessage = null;
                        }, 5000);
                    }
                } catch (error) {
                    console.log('WebSocket message parsing error:', error);
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
                await this.initializeGame(this.generatorId);
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
            switch(direction) {
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
            switch(direction) {
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
            if (response.type === 'update') {
                this.gameState = response.state;
                // Update the gameTitle when we receive a new state
                if (response.state.game_title) {
                    this.gameTitle = response.state.game_title;
                }
                if (response.description) {
                    this.addToGameLog(response.description);
                }
                // Store explored tiles count if provided
                if (response.explored_tiles !== undefined) {
                    this.gameState.explored_tiles = response.explored_tiles;
                }

                // Track game state changes
                if (window.analytics) {
                    // Track when game is over
                    if (response.state.game_over) {
                        analytics.logEvent('game_over', {
                            title: this.gameTitle,
                            explored_tiles: this.gameState.explored_tiles
                        });
                    }
                    // Track combat events
                    if (response.state.in_combat && !this.gameState.in_combat) {
                        analytics.logEvent('combat_started', {
                            enemy: response.state.current_enemy?.name
                        });
                    }
                }
            }
            // ...rest of the method
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

        // Rest of mounted logic
        const urlParams = new URLSearchParams(window.location.search);
        const generatorIdParam = urlParams.get('generator_id');
        if (generatorIdParam) {
            this.generatorId = generatorIdParam;
        }

        this.initWebSocket();

        // Add event listeners
        document.addEventListener('click', this.closeMenuIfClickedOutside);
        window.addEventListener('resize', this.handleWindowResize);

        // Get initial title from SSR if available
        const h1 = document.querySelector('h1');
        if (h1 && h1.dataset.initialTitle) {
            this.gameTitle = h1.dataset.initialTitle;
        }

        // Clear loading interval if it exists when component is destroyed
        if (loadingInterval) {
            this.$once('hook:beforeDestroy', () => {
                clearInterval(loadingInterval);
            });
        }
    },
    beforeUnmount() {
        document.removeEventListener('click', this.closeMenuIfClickedOutside);
        // Remove the resize event listener
        window.removeEventListener('resize', this.handleWindowResize);
    },
    watch: {
        // Watch for changes in player position
        'gameState.player_pos': function(newVal, oldVal) {
            // Only update if position has actually changed
            if (!oldVal || newVal[0] !== oldVal[0] || newVal[1] !== oldVal[1]) {
                this.$nextTick(() => {
                    const [x, y] = newVal;
                    updatePlayerPosition(x, y);
                });
            }
        },
        // Watch for changes in combat state
        'gameState.in_combat': function(newVal, oldVal) {
            if (!newVal) { // Combat has ended
                const [x, y] = this.gameState.player_pos;
                this.$nextTick(() => {
                    updatePlayerPosition(x, y, true); // Force update
                });
            }
        },
        // Watch for changes in game title
        'gameState.game_title': function(newVal) {
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
                // Hide loading when game is initialized
                hideLoading();
            }
        },
        'gameState.game_over'(newValue) {
            if (newValue === true) {
                this.preventNavigation = false;
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
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}, { passive: false });

document.addEventListener('touchmove', function(event) {
    event.preventDefault();
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Prevent context menu on long press
document.addEventListener('contextmenu', function(event) {
    event.preventDefault();
}, false);

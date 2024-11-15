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
function showLoading() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
    // No need to update the progress bar via JavaScript
}

// Correct hideLoading function
function hideLoading() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
        const progressBar = loadingOverlay.querySelector('.progress-bar');
        if (progressBar) {
            // Pause the animation and set width to 100%
            progressBar.style.animationPlayState = 'paused';
            progressBar.style.width = '100%';
        }
        // Delay hiding to show completion
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);
    }
}

const app = Vue.createApp({
    data() {
        return {
            isGameInitialized: false,
            isLoading: true,
            gameState: {
                player_pos: [0, 0],
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
            return this.gameState.cell_types[y][x].font_awesome_icon;
        },
        toggleMenu() {
            this.isMenuOpen = !this.isMenuOpen;
        },
        closeMenuIfClickedOutside(event) {
            const menu = document.querySelector('.popup-menu');
            const menuIcon = document.querySelector('.menu-icon');

            if (!menu.contains(event.target) && !menuIcon.contains(event.target)) {
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
                console.log('Received message:', event.data);
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
                        this.gameState = response.state;
                        if (response.description) {
                            this.gameLogs.push(response.description);
                        }
                        if (!this.isGameInitialized) {
                            console.log('Initial game state received:', this.gameState);
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
                        const playerPos = this.gameState.player_pos;
                        this.$nextTick(() => {
                            const playerPos = this.gameState.player_pos;
                            updatePlayerPosition(playerPos[0], playerPos[1]);
                        });
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
        restartGame() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    action: 'restart',
                    generator_id: this.generatorId
                }));
                this.gameLogs = [];
                // Request initial state after restart
                setTimeout(() => {
                    this.ws.send(JSON.stringify({
                        action: 'get_initial_state'
                    }));
                }, 100); // Small delay to ensure restart completes first
            }
        },
        move(direction) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.gameState.game_over) {
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
        newGame() {
            // Send a POST request to the server to clear the session
            fetch('/logout', {
                method: 'POST',
                credentials: 'include'
            })
            .then(response => {
                if (response.redirected) {
                    // Redirect to the landing page
                    window.location.href = response.url;
                } else {
                    // Handle error if logout was not successful
                    console.error('Failed to start a new game.');
                }
            })
            .catch(error => {
                console.error('Error:', error);
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
                if (response.description) {
                    this.addToGameLog(response.description);
                }
                // Store explored tiles count if provided
                if (response.explored_tiles !== undefined) {
                    this.gameState.explored_tiles = response.explored_tiles;
                }
            }
            // ...rest of the method
        }
    },
    mounted() {
        // Show loading screen
        showLoading();

        // Rest of mounted logic
        const urlParams = new URLSearchParams(window.location.search);
        const generatorIdParam = urlParams.get('generator_id');
        if (generatorIdParam) {
            this.generatorId = generatorIdParam;
        }

        this.initWebSocket();
        document.addEventListener('click', this.closeMenuIfClickedOutside);
        window.addEventListener('resize', this.handleWindowResize);

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
        // Add watcher for isGameInitialized
        isGameInitialized(newVal) {
            if (newVal) {
                // Hide loading when game is initialized
                hideLoading();
            }
        }
    }
});

app.mount('#app');

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

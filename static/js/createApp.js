// Prevent pinch-to-zoom
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}, { passive: false });

// Prevent double-tap zoom
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

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
function isBrightColor(hhex) {
    const [r, g, b] = getRGBFromHashHex(hhex);
    const brightness = (r + g + b) / 3;
    return brightness > 100;
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
            const shareUrl = `${window.location.origin}/game.html?generator_id=${this.generatorId}`;

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
        initWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/game`);

            this.ws.onmessage = (event) => {
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
    },
    mounted() {
        // Show loading immediately when component mounts
        showLoading();

        // Check if there's a generator_id in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const generatorIdParam = urlParams.get('generator_id');
        if (generatorIdParam) {
            this.generatorId = generatorIdParam;
        }

        this.initWebSocket();

        // Close the menu if clicked outside
        document.addEventListener('click', this.closeMenuIfClickedOutside);
    },
    beforeUnmount() {
        document.removeEventListener('click', this.closeMenuIfClickedOutside);
    }
});

app.mount('#app');

// Find the function that handles loading/waiting state
function showLoading() {
    const loading = document.getElementById('loading');
    if (!loading) return;  // Guard clause in case element isn't found

    loading.style.display = 'block';
    const progressBar = loading.querySelector('.progress-bar');
    if (!progressBar) return;  // Guard clause in case progress bar isn't found

    progressBar.style.width = '0%';

    // Simulate progress
    let progress = 0;
    const interval = setInterval(() => {
        progress += 0.5;
        if (progress >= 100) {
            clearInterval(interval);
        }
        progressBar.style.width = `${progress}%`;
    }, 100);

    return interval;  // Return interval so we can clear it if needed
}

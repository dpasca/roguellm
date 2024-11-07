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
            errorMessage: null
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
        /*
        displayInventory() {
            if (!this.gameState.inventory.length) return 'Empty';
            return this.gameState.inventory.map(item => item.name).join(', ');
        },
        */
    },
    methods: {
        getCellSymbol(x, y, cell) {
            if (this.isPlayerPosition(x, y)) return '👤';
            if (!cell) return '❓';
            return '·';
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

                    if (response.type === 'update') {
                        this.gameState = response.state;
                        if (response.description) {
                            this.gameLogs.push(response.description);
                        }
                        if (!this.isGameInitialized) { // This is the initial state
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
                    action: 'restart'
                }));
                this.gameLogs = [];
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
            if (!this.gameState) return false;
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
        this.initWebSocket();

        // Theme selection handling
        const customRadio = document.getElementById('custom');
        const fantasyRadio = document.getElementById('fantasy');
        const customDescriptionContainer = document.getElementById('customDescriptionContainer');
        const launchButton = document.getElementById('launchGame');

        if (customRadio && fantasyRadio && customDescriptionContainer && launchButton) {
            // Show/hide custom description based on selection
            const updateDescriptionVisibility = () => {
                customDescriptionContainer.style.display =
                    customRadio.checked ? 'block' : 'none';
            };

            customRadio.addEventListener('change', updateDescriptionVisibility);
            fantasyRadio.addEventListener('change', updateDescriptionVisibility);
        }

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
/*
function hideLoading() {
    const loading = document.getElementById('loading');
    if (!loading) return;

    const progressBar = loading.querySelector('.progress-bar');
    if (!progressBar) return;

    progressBar.style.width = '100%';

    setTimeout(() => {
        loading.style.display = 'none';
    }, 300);
}
*/

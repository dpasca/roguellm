const { createApp } = Vue

createApp({
    data() {
        return {
            gameState: {
                map_width: 10,
                map_height: 8,
                player_pos: [0, 0],
                player_hp: 100,
                player_max_hp: 100,
                player_attack: 15,
                player_defense: 0,
                inventory: [],
                equipment: {  // Add this equipment object
                    weapon: null,
                    armor: null
                },
                explored: Array(8).fill().map(() => Array(10).fill(false)),
                in_combat: false,
                current_enemy: null,
                game_over: false
            },
            gameLogs: [],
            ws: null,
            errorMessage: null
        }
    },
    computed: {
        getPlayerHealthPercentage() {
            if (!this.gameState) return 0;
            return (this.gameState.player_hp / this.gameState.player_max_hp) * 100;
        },
        getEnemyHealthPercentage() {
            if (!this.gameState || !this.gameState.current_enemy) return 0;
            return (this.gameState.current_enemy.hp / this.gameState.current_enemy.max_hp) * 100;
        },
        displayInventory() {
            if (!this.gameState || !this.gameState.inventory.length) return 'Empty';
            return this.gameState.inventory.map(item => item.name).join(', ');
        }
    },
    methods: {
        initWebSocket() {
            this.ws = new WebSocket(`ws://${window.location.host}/ws/game`);

            this.ws.onmessage = (event) => {
                const response = JSON.parse(event.data);
                if (response.type === 'update') {
                    this.gameState = response.state;
                    if (response.description) {
                        this.gameLogs.unshift(response.description);
                    }
                } else if (response.type === 'error') {
                    this.errorMessage = response.message;
                    setTimeout(() => {
                        this.errorMessage = null;
                    }, 5000);  // Clear error message after 5 seconds
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket connection closed');
                setTimeout(() => this.initWebSocket(), 5000);
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
        }
    },
    mounted() {
        this.initWebSocket();
    }
}).mount('#app')
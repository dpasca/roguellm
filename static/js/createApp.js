function getRGBFromHashHex(hhex) {
    const hex = hhex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return [r, g, b];
}
function scaleColor(hhex, scale, alpha = 1) {
    const [r, g, b] = getRGBFromHashHex(hhex);
    const [sr, sg, sb] = [r, g, b].map(c => Math.floor(c * scale));
    return alpha >= 1
        ? `rgb(${sr}, ${sg}, ${sb})`
        : `rgba(${sr}, ${sg}, ${sb}, ${alpha})`;
}

function updatePlayerPosition(x, y, force = false) {
    const playerIcon = document.getElementById('player-icon');
    const cell = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (!cell || !playerIcon) return;

    const gameMap = document.querySelector('.map-surface') || document.querySelector('.game-map');
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
            // Shown for a beat when the player walks into a new area. Not a
            // dialog on purpose: crossings happen several times a run, and
            // anything needing a tap would tax the one thing you do constantly.
            areaReveal: null,
            // Forging a World takes minutes once art is on, so the wait shows
            // the World being built rather than a spinner.
            forge: {
                active: false,
                title: '',
                summary: '',
                cast: [],
                coverUrl: null,
                stage: '',
                message: '',
                done: 0,
                total: 0
            },
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
                tile_info: [],
                item_placements: [],
                enemies: [],
                defeated_enemies: [],
                story_placements: [],
                current_story: null,
                resolved_story_ids: [],
                objective: {},
                in_combat: false,
                current_enemy: null,
                game_over: false,
                temporary_effects: {},
                game_title: 'RogueLLM'
            },
            gameLogs: [],
            storyOutcome: null,
            isStoryChoicePending: false,
            mobilePanel: null,
            ws: null,
            gameTitle: 'RogueLLM: Unknown Title',
            isMenuOpen: false,
            isDebugPanelOpen: false,
            errorMessage: null,
            generatorId: null,
            showShareNotification: false,
            selectedTile: null,
            hasRequestedInitialState: false,
            // The location is the primary surface on phones, with the map as a
            // minimap beneath it. ?layout=grid returns to the old arrangement,
            // which is also what desktop still uses.
            sceneLayout: new URLSearchParams(window.location.search).get('layout') !== 'grid'
        }
    },
    computed: {
        forgePercent() {
            if (this.forge.stage === 'populating') return 97;
            if (this.forge.stage === 'building') return 92;
            if (!this.forge.total) return this.forge.title ? 12 : 4;
            // Leave headroom: the cast is most of the wait but not all of it.
            return Math.min(96, 12 + (this.forge.done / this.forge.total) * 84);
        },
        forgeCaption() {
            if (this.forge.stage === 'populating') return this.$t('forge.populating');
            if (this.forge.stage === 'building') return this.$t('forge.building');
            if (this.forge.coverUrl) return this.$t('forge.finishing');
            if (this.forge.total) {
                return this.$t('forge.drawing', { done: this.forge.done, total: this.forge.total });
            }
            if (this.forge.title) return this.$t('forge.castingCall');
            return this.$t('forge.imagining');
        },
        currentTile() {
            const state = this.gameState;
            if (!state || !state.tile_info || !state.player_pos) return null;
            const [x, y] = state.player_pos;
            const row = state.tile_info[y];
            return (row && row[x]) || null;
        },
        stageEyebrow() {
            const tile = this.currentTile;
            if (!tile) return '';
            const terrain = (tile.terrain_name || '').trim();
            const label = (tile.label || '').trim();
            return terrain && terrain.toLowerCase() !== label.toLowerCase() ? terrain : '';
        },
        currentEnemySprite() {
            // Whatever is standing here with you, shown at scene scale rather
            // than as a token, so the stage reads as a place with something in
            // it instead of a grid square.
            if (!this.gameState || !this.gameState.player_pos) return '';
            const [x, y] = this.gameState.player_pos;
            const enemy = this.getEnemyAt(x, y);
            return enemy ? this.getEntitySprite(enemy) : '';
        },
        currentBackdrop() {
            // Worlds forged before backdrops existed, or whose art failed, have
            // none; the map then simply renders as it always did.
            const state = this.gameState;
            if (!state || !state.cell_types || !state.player_pos) return null;
            const [x, y] = state.player_pos;
            const row = state.cell_types[y];
            const cell = row && row[x];
            return (cell && cell.backdrop_url) || null;
        },
        currentRegion() {
            const state = this.gameState;
            if (!state || !state.region_ids || !state.regions || !state.player_pos) return null;
            const [x, y] = state.player_pos;
            const row = state.region_ids[y];
            const regionId = row && row[x];
            if (!regionId) return null;
            return state.regions.find(region => region.id === regionId) || null;
        },
        getPlayerHealthPercentage() {
            return (this.gameState.player_hp / this.gameState.player_max_hp) * 100;
        },
        getEnemyHealthPercentage() {
            if (!this.gameState.current_enemy) return 0;
            return (this.gameState.current_enemy.hp / this.gameState.current_enemy.max_hp) * 100;
        },
        getObjectivePercentage() {
            const objective = this.gameState && this.gameState.objective;
            if (!objective || !objective.target) return 0;
            return Math.min(100, (objective.current / objective.target) * 100);
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
        },
        selectedTileInfo() {
            if (!this.gameState || !this.gameState.player_pos) return null;
            const tile = this.selectedTile || {
                x: this.gameState.player_pos[0],
                y: this.gameState.player_pos[1]
            };
            return this.getTileInfo(tile.x, tile.y);
        },
        hasActiveInteraction() {
            return Boolean(
                this.storyOutcome ||
                (this.gameState && this.gameState.current_story)
            );
        },
        currentLocationName() {
            if (!this.gameState || !this.gameState.player_pos || !this.gameState.cell_types) {
                return '—';
            }
            const [x, y] = this.gameState.player_pos;
            const cell = this.gameState.cell_types[y] && this.gameState.cell_types[y][x];
            return cell && cell.name ? cell.name : '—';
        }
    },
    methods: {
        regionAt(pos) {
            const state = this.gameState;
            if (!state || !state.region_ids || !state.regions || !pos) return null;
            const row = state.region_ids[pos[1]];
            const regionId = row && row[pos[0]];
            if (!regionId) return null;
            return state.regions.find(region => region.id === regionId) || null;
        },
        checkAreaCrossing(newPos, oldPos) {
            // Worlds without regions, and the first position of a run, are not
            // crossings; the reveal is for walking out of one area into another.
            const to = this.regionAt(newPos);
            const from = oldPos ? this.regionAt(oldPos) : null;
            if (!to || !from || to.id === from.id) return;

            // Only the crossing line. The area name is already on screen twice,
            // as the stage eyebrow and the Location stat, and a third copy is
            // the duplication this layer was supposed to stop causing.
            const line = (from.borders && from.borders[to.id]) || '';
            if (!line) return;

            if (this.areaRevealTimer) clearTimeout(this.areaRevealTimer);
            // The id keys the element so a crossing that follows another before
            // the first has faded restarts the animation instead of rendering
            // into a node the previous run already left at opacity 0.
            this.areaRevealSeq = (this.areaRevealSeq || 0) + 1;
            this.areaReveal = { line, id: this.areaRevealSeq };
            // Long enough to read a sentence, short enough that a fast player
            // is never waiting on it. It never blocks input either way.
            this.areaRevealTimer = setTimeout(() => { this.areaReveal = null; }, 4200);
        },
        getTileInfo(x, y) {
            if (!this.gameState) return null;

            const row = this.gameState.tile_info && this.gameState.tile_info[y];
            if (row && row[x]) {
                return row[x];
            }

            const cellRow = this.gameState.cell_types && this.gameState.cell_types[y];
            const cellType = cellRow && cellRow[x];
            if (!cellType) return null;

            return {
                x,
                y,
                label: cellType.name || 'Area',
                quick_desc: cellType.description || '',
                inspect_desc: cellType.description || '',
                terrain_name: cellType.name || 'Area',
                terrain_icon: cellType.font_awesome_icon || '',
                danger_level: 'safe',
                hint: 'Clear',
                entity_type: '',
                entity_name: '',
                entity_icon: '',
                entity_status: '',
                tags: []
            };
        },
        isAdjacentTile(x, y) {
            if (!this.gameState || !this.gameState.player_pos) return false;
            const [px, py] = this.gameState.player_pos;
            return Math.abs(px - x) + Math.abs(py - y) <= 1;
        },
        isInspectableTile(x, y) {
            return Boolean(this.getTileInfo(x, y));
        },
        isSelectedTile(x, y) {
            return this.selectedTile && this.selectedTile.x === x && this.selectedTile.y === y;
        },
        selectTile(x, y) {
            if (!this.isInspectableTile(x, y)) return;
            this.selectedTile = { x, y };
            if (
                window.matchMedia('(max-width: 900px)').matches &&
                !this.hasActiveInteraction &&
                !this.gameState.in_combat
            ) {
                this.mobilePanel = 'tile';
            }
        },
        ensureSelectedTile() {
            if (!this.gameState || !this.gameState.player_pos) return;
            if (this.selectedTile && this.isInspectableTile(this.selectedTile.x, this.selectedTile.y)) {
                return;
            }
            this.selectedTile = {
                x: this.gameState.player_pos[0],
                y: this.gameState.player_pos[1]
            };
        },
        getTileAriaLabel(x, y) {
            const tile = this.getTileInfo(x, y);
            if (!tile) return `Tile ${x}, ${y}`;
            return `${tile.label}. ${tile.hint || tile.quick_desc || ''}`;
        },
        getCellStyle(x, y) {
            if (!this.gameState.cell_types || this.gameState.cell_types.length === 0) return {};

            const cellType = this.gameState.cell_types[y][x];
            const isExplored = this.gameState.explored[y][x];

            const scaleBg = isExplored ? 0.6 : 0.5; // Unexplored cells are darker
            const scaleFg = isExplored ? 0.9 : 0.8; // Unexplored cells are darker

            // With a location behind the grid, opaque tiles would hide it
            // entirely. Explored ground thins out so the place shows through;
            // unexplored stays mostly solid, which is the fog of war.
            const alpha = this.currentBackdrop ? (isExplored ? 0.42 : 0.82) : 1;

            return {
                '--tile-color': cellType.map_color,
                backgroundColor: scaleColor(cellType.map_color, scaleBg, alpha),
                color: scaleColor(cellType.map_color, scaleFg)
            };
        },
        getEnemyAt(x, y) {
            const enemies = this.gameState.enemies || [];
            const defeated = this.gameState.defeated_enemies || [];
            return enemies.find(e => e.x === x && e.y === y) ||
                defeated.find(e => e.x === x && e.y === y);
        },
        getItemAt(x, y) {
            const items = this.gameState.item_placements || [];
            return items.find(item => item.x === x && item.y === y && !item.is_collected);
        },
        getStoryAt(x, y) {
            const stories = this.gameState.story_placements || [];
            return stories.find(story => story.x === x && story.y === y);
        },
        getEntitySprite(entity, variant = 'sprite') {
            if (!entity) return '';
            if (variant === 'token') {
                return entity.sprite_token_url || entity.sprite_url || '';
            }
            return entity.sprite_url || entity.sprite_token_url || '';
        },
        getCellSprite(x, y) {
            if (this.isPlayerPosition(x, y)) return '';
            return this.getEntitySprite(this.getEnemyAt(x, y), 'token');
        },
        getCellEntityAlt(x, y) {
            const enemy = this.getEnemyAt(x, y);
            if (enemy) return enemy.name || 'Enemy';
            const item = this.getItemAt(x, y);
            if (item) return item.name || 'Item';
            const story = this.getStoryAt(x, y);
            if (story) return story.title || 'Story opportunity';
            return '';
        },
        getCellIcon(x, y) {
            // Check if there's an enemy at this position (either active or defeated)
            const enemy = this.getEnemyAt(x, y);
            if (enemy && !this.isPlayerPosition(x, y)) {
                const baseClass = enemy.font_awesome_icon;
                const enemyClass = enemy.is_defeated ? 'enemy-icon defeated' : 'enemy-icon';
                return `${baseClass} ${enemyClass}`;
            }
            const item = this.getItemAt(x, y);
            if (item) {
                return `${item.font_awesome_icon || 'fa-solid fa-box'} item-icon`;
            }
            const story = this.getStoryAt(x, y);
            if (story && story.status === 'available') {
                return `${story.font_awesome_icon || 'fa-solid fa-diamond'} story-icon`;
            }
            return this.gameState.cell_types[y][x].font_awesome_icon;
        },
        getDirectionTileInfo(direction) {
            if (!this.canMove(direction)) return null;
            const [x, y] = this.getNextPosition(direction);
            return this.getTileInfo(x, y);
        },
        getDirectionBadge(direction) {
            const tile = this.getDirectionTileInfo(direction);
            if (!tile) return '';

            if (tile.entity_type === 'item' && tile.entity_status !== 'collected') return '+';
            if (tile.entity_type === 'story' && tile.entity_status === 'available') return '◆';
            if (['deadly', 'risky', 'guarded'].includes(tile.danger_level)) return '!';

            const [x, y] = this.getNextPosition(direction);
            if (this.gameState.explored && this.gameState.explored[y] && this.gameState.explored[y][x]) {
                return '·';
            }
            return '?';
        },
        getDirectionBadgeClass(direction) {
            const tile = this.getDirectionTileInfo(direction);
            if (!tile) return '';
            if (tile.entity_type === 'item' && tile.entity_status !== 'collected') return 'reward';
            if (tile.entity_type === 'story' && tile.entity_status === 'available') return 'story';
            if (tile.danger_level === 'deadly') return 'deadly';
            if (['risky', 'guarded'].includes(tile.danger_level)) return 'danger';
            return 'quiet';
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

            if (!menu.contains(event.target) &&
                !menuIcon.contains(event.target)) {
                this.isMenuOpen = false;
            }
        },
        homeUrl() {
            const url = new URL('/', window.location.origin);
            const urlLang = new URLSearchParams(window.location.search).get('lang');
            const storedLang = localStorage.getItem('preferredLanguage');
            const lang = urlLang || storedLang;
            if (lang) {
                url.searchParams.set('lang', lang);
            }
            return url.toString();
        },
        goHome() {
            this.isMenuOpen = false;
            const url = this.homeUrl();
            if (this.gameState.game_over || this.gameState.game_won) {
                window.location.href = url;
                return;
            }
            window.open(url, '_blank', 'noopener');
        },
        quitGame() {
            this.isMenuOpen = false;
            if (this.gameState.game_over || this.gameState.game_won) {
                this.goHome();
                return;
            }

            if (!window.confirm(this.$t('menu.quitConfirm'))) {
                return;
            }

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    action: 'quit'
                }));
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
            this.hasRequestedInitialState = false;
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
                    if (response.type === 'forge_progress') {
                        this.handleForgeProgress(response);
                        return;
                    }

                    if (response.type === 'status') {
                        // Update loading message during game creation
                        const loadingMessage = document.querySelector('#loading-message');
                        if (loadingMessage) {
                            loadingMessage.textContent = response.message;
                        }

                        if (response.status === 'creating') {
                            this.forge.active = true;
                            this.forge.message = response.message || '';
                            hideLoading();
                        }

                        if (response.status === 'ready') {
                            // The World may still need its map built, which is
                            // reported separately. The reveal is dismissed by
                            // the first state update, not by this message.
                            this.requestInitialState();
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
                        this.requestInitialState();
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
        handleForgeProgress(event) {
            this.forge.active = true;
            // The legacy overlay sits above the reveal and would otherwise
            // cover it with a dimmed "Game ready!" while the map is still
            // being built.
            hideLoading();

            switch (event.stage) {
                case 'theme':
                    this.forge.title = event.title || '';
                    this.forge.summary = event.summary || '';
                    break;

                case 'cast': {
                    // Lay out empty slots up front so the reveal fills in
                    // rather than growing, which reads as progress.
                    const cast = [];
                    if (event.player) {
                        cast.push({ id: 'player', name: event.player.name, sprite_url: null, failed: false });
                    }
                    (event.enemies || []).forEach(enemy => {
                        cast.push({ id: enemy.id, name: enemy.name, sprite_url: null, failed: false });
                    });
                    this.forge.cast = cast;
                    this.forge.total = cast.length;
                    break;
                }

                case 'art': {
                    const slot = this.forge.cast.find(entry => entry.id === event.character_id);
                    if (slot) {
                        slot.sprite_url = event.sprite_url;
                    }
                    this.forge.done = event.index || this.forge.done + 1;
                    if (event.total) this.forge.total = event.total;
                    break;
                }

                case 'art_failed': {
                    const slot = this.forge.cast.find(entry => entry.id === event.character_id);
                    if (slot) slot.failed = true;
                    this.forge.done = (event.index || this.forge.done) + 1;
                    break;
                }

                case 'cover':
                    this.forge.coverUrl = event.cover_url;
                    break;

                // Building the map happens after 'ready', so without these the
                // client sat on "Game ready!" for a minute or more on the first
                // play of any World that has no snapshot yet.
                case 'building':
                    this.forge.stage = 'building';
                    break;

                case 'populating':
                    this.forge.stage = 'populating';
                    break;
            }
        },
        requestInitialState() {
            if (this.hasRequestedInitialState) return;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.hasRequestedInitialState = true;
            this.ws.send(JSON.stringify({ action: 'get_initial_state' }));
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
                !this.gameState.current_story &&
                !this.storyOutcome &&
                !this.mobilePanel &&
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
        chooseStory(choiceId) {
            if (this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                this.gameState.current_story &&
                !this.gameState.in_combat &&
                !this.storyOutcome &&
                !this.isStoryChoicePending) {
                this.isStoryChoicePending = true;
                this.ws.send(JSON.stringify({
                    action: 'choose_story',
                    choice_id: choiceId
                }));
            }
        },
        dismissStoryOutcome() {
            const revealCombat = Boolean(
                this.storyOutcome &&
                this.storyOutcome.combat_started &&
                this.gameState &&
                this.gameState.in_combat
            );
            this.storyOutcome = null;

            this.$nextTick(() => {
                const target = document.querySelector(revealCombat ? '.combat-ui' : '.game-map');
                if (target && !window.matchMedia('(max-width: 900px)').matches) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        },
        toggleMobilePanel(panel) {
            if (this.hasActiveInteraction || this.gameState.in_combat) return;
            this.mobilePanel = this.mobilePanel === panel ? null : panel;
        },
        closeMobilePanel() {
            this.mobilePanel = null;
        },
        getMobilePanelTitle(panel) {
            switch (panel) {
                case 'tile': return this.selectedTileInfo ? this.selectedTileInfo.label : '';
                case 'objective': return this.$t('mobileHud.mission');
                case 'character': return this.gameState.player.name || this.$t('mobileHud.character');
                case 'inventory': return this.$t('player.inventory');
                case 'history': return this.$t('storyPanel.history');
                default: return '';
            }
        },
        getMobilePanelIcon(panel) {
            switch (panel) {
                case 'tile':
                    return this.selectedTileInfo
                        ? (this.selectedTileInfo.entity_icon || this.selectedTileInfo.terrain_icon || 'fa-solid fa-location-dot')
                        : 'fa-solid fa-location-dot';
                case 'objective': return 'fa-solid fa-crosshairs';
                case 'character': return 'fa-solid fa-user';
                case 'inventory': return 'fa-solid fa-briefcase';
                case 'history': return 'fa-solid fa-route';
                default: return 'fa-solid fa-circle-info';
            }
        },
        handleGlobalKeydown(event) {
            if (event.key === 'Escape' && this.mobilePanel) {
                this.closeMobilePanel();
            }
        },
        getStoryEffectIcon(effect) {
            if (!effect) return 'fa-solid fa-sparkles';
            switch (effect.type) {
                case 'health':
                    return effect.amount < 0 ? 'fa-solid fa-heart-crack' : 'fa-solid fa-heart';
                case 'xp':
                    return 'fa-solid fa-star';
                case 'item':
                    return 'fa-solid fa-box-open';
                case 'combat':
                    return 'fa-solid fa-burst';
                case 'defeat':
                    return 'fa-solid fa-skull';
                default:
                    return 'fa-solid fa-sparkles';
            }
        },
        getStoryEffectClass(effect) {
            if (!effect) return 'effect-neutral';
            if (effect.type === 'health' && effect.amount < 0) return 'effect-damage';
            return `effect-${effect.type || 'neutral'}`;
        },
        getLogIcon(log) {
            const kind = log && typeof log === 'object' ? log.kind : 'event';
            switch (kind) {
                case 'story': return 'fa-solid fa-diamond';
                case 'combat': return 'fa-solid fa-burst';
                case 'move': return 'fa-solid fa-location-dot';
                case 'item': return 'fa-solid fa-box-open';
                default: return 'fa-solid fa-compass';
            }
        },
        getLogTitle(log) {
            if (log && typeof log === 'object' && log.title) return log.title;
            return this.$t('storyPanel.historyEvent');
        },
        getLogText(log) {
            return log && typeof log === 'object' ? log.text : log;
        },
        isPlayerPosition(x, y) {
            return this.gameState &&
                this.gameState.player_pos[0] === x &&
                this.gameState.player_pos[1] === y;
        },
        canMove(direction) {
            if (!this.gameState || this.gameState.in_combat || this.gameState.current_story || this.storyOutcome || this.mobilePanel) return false;
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
            if (!window.matchMedia('(max-width: 900px)').matches) {
                this.mobilePanel = null;
            }
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
            this.isStoryChoicePending = false;
            if (response.type === 'update' && response.state) {
                console.log('Received state update:', response.state);
                const wasInCombat = this.gameState.in_combat;
                const previousPos = this.gameState.player_pos;
                this.gameState = response.state;
                if (
                    this.gameState.current_story ||
                    response.story_outcome ||
                    (!wasInCombat && this.gameState.in_combat) ||
                    ['initialize', 'restart'].includes(response.response_action)
                ) {
                    this.mobilePanel = null;
                }
                if (response.story_outcome) {
                    this.storyOutcome = response.story_outcome;
                } else if (
                    this.gameState.current_story ||
                    ['initialize', 'restart'].includes(response.response_action)
                ) {
                    this.storyOutcome = null;
                }
                const currentPos = this.gameState.player_pos;
                const playerMoved = previousPos && currentPos &&
                    (previousPos[0] !== currentPos[0] || previousPos[1] !== currentPos[1]);
                if (playerMoved) {
                    this.selectedTile = { x: currentPos[0], y: currentPos[1] };
                } else {
                    this.ensureSelectedTile();
                }

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
                    const action = response.response_action || 'event';
                    const kind = response.story_outcome
                        ? 'story'
                        : ['attack', 'run'].includes(action)
                            ? 'combat'
                            : ['use_item', 'equip_item'].includes(action)
                                ? 'item'
                                : action === 'move'
                                    ? 'move'
                                    : 'event';
                    this.gameLogs.push({
                        kind,
                        title: response.story_outcome ? response.story_outcome.title : '',
                        text: response.story_outcome ? response.story_outcome.result : response.description,
                        effects: response.story_outcome ? response.story_outcome.effects : []
                    });
                }

                // Hide loading screen when we receive any game state update
                hideLoading();
                // Real state has arrived, so the World is genuinely playable.
                this.forge.active = false;

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
                            if (gameLog) {
                                gameLog.scrollTop = gameLog.scrollHeight;
                            }
                        });
                    }
                }

                // Store generator ID if provided
                if (response.generator_id) {
                    this.generatorId = response.generator_id;
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
                hideLoading(); // Hide loading on error
                setTimeout(() => {
                    this.errorMessage = null;
                }, 5000);
            }
        }
    },
    mounted() {
        // Show loading screen
        showLoading();

        // Initialize WebSocket connection
        this.initWebSocket();

        // Add event listeners
        document.addEventListener('click', this.closeMenuIfClickedOutside);
        document.addEventListener('keydown', this.handleGlobalKeydown);
        window.addEventListener('resize', this.handleWindowResize);

        // Get initial title from SSR if available
        const h1 = document.querySelector('h1');
        if (h1 && h1.dataset.initialTitle) {
            this.gameTitle = h1.dataset.initialTitle;
        }
    },
    beforeUnmount() {
        document.removeEventListener('click', this.closeMenuIfClickedOutside);
        document.removeEventListener('keydown', this.handleGlobalKeydown);
        // Remove the resize event listener
        window.removeEventListener('resize', this.handleWindowResize);

        // Clear loading interval if it exists
        if (loadingInterval) {
            clearInterval(loadingInterval);
        }

        if (this.areaRevealTimer) {
            clearTimeout(this.areaRevealTimer);
        }
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
                this.checkAreaCrossing(newVal, oldVal);
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
        'gameState.current_story': function (newVal, oldVal) {
            if (newVal && !oldVal) {
                this.$nextTick(() => {
                    const storyPanel = document.querySelector('.interaction-panel');
                    const firstChoice = storyPanel && storyPanel.querySelector('.story-choices button:not(:disabled)');
                    if (firstChoice) {
                        firstChoice.focus({ preventScroll: true });
                    }
                    if (storyPanel && !window.matchMedia('(max-width: 900px)').matches) {
                        storyPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }
        },
        storyOutcome(newVal, oldVal) {
            if (newVal && !oldVal) {
                this.$nextTick(() => {
                    const outcomePanel = document.querySelector('.story-outcome');
                    const continueButton = outcomePanel && outcomePanel.querySelector('.story-continue-button');
                    if (continueButton) {
                        continueButton.focus({ preventScroll: true });
                    }
                    if (outcomePanel && !window.matchMedia('(max-width: 900px)').matches) {
                        outcomePanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }
        },
        mobilePanel(newVal, oldVal) {
            if (newVal && newVal !== oldVal) {
                this.$nextTick(() => {
                    const closeButton = document.querySelector('.mobile-panel-close');
                    if (closeButton) {
                        closeButton.focus({ preventScroll: true });
                    }
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
        const [enResponse, itResponse, jaResponse, esResponse, zhHansResponse, zhHantResponse] = await Promise.all([
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
    if (event.touches.length > 1) {
        event.preventDefault();
    }
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

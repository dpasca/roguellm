import Phaser from 'phaser';
import faSolidFontUrl from '@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?url';
import type { Direction, GameAction, GameState, Item } from '../protocol/types';
import type { FixedSkinButton, FixedSkinButtonState, FixedSkinIndicatorState, FixedSkinProfile, FixedSkinRect, GameSkin } from '../skins/types';
import { parseHexColor, scaleRgb } from '../game/color';
import { applyWorkbenchAction, createWorkbenchState, WORKBENCH_LOGS } from './skinWorkbench';
import { selectFixedSkinProfile } from './fixedSkinWorkbench';

type FixedButtonId = keyof FixedSkinProfile['buttons'];
type PhaserFixedScenario = 'combat' | 'movement' | 'diagnostics' | 'status' | 'defeat' | 'victory';

interface SceneConfig {
  profile: FixedSkinProfile;
  skin: GameSkin;
  state: GameState;
  logs: string[];
  scenario: PhaserFixedScenario;
  connectionStatus: string;
  onAction: (action: GameAction) => void;
  onToggleLog: () => void;
  onToggleInventory: () => void;
}

interface SceneState {
  state: GameState;
  logs: string[];
  logOpen: boolean;
  inventoryOpen: boolean;
  actionPending: boolean;
  connectionStatus: string;
}

interface InventoryRowAction {
  action: GameAction | null;
  label: string;
  disabled: boolean;
  state: 'ready' | 'equipped' | 'disabled';
}

type ButtonEntry = [FixedButtonId, FixedSkinButton];

const buttonActions: Partial<Record<FixedButtonId, GameAction>> = {
  attack: { action: 'attack' },
  run: { action: 'run' },
  restart: { action: 'restart' },
  moveN: { action: 'move', direction: 'n' },
  moveS: { action: 'move', direction: 's' },
  moveE: { action: 'move', direction: 'e' },
  moveW: { action: 'move', direction: 'w' }
};

const legacyFixedRenderers = new Set(['css', 'dom', 'html', 'legacy']);
const fontAwesomeFamily = 'Font Awesome 7 Free';
const fontAwesomeStyleClasses = new Set(['fa', 'fas', 'far', 'fab', 'fa-solid', 'fa-regular', 'fa-brands']);
const fontAwesomeGlyphs: Record<string, string> = {
  'ban': '\uf05e',
  'bowl-food': '\ue4c6',
  'box': '\uf466',
  'briefcase': '\uf0b1',
  'briefcase-medical': '\uf469',
  'building': '\uf1ad',
  'building-columns': '\uf19c',
  'caret-down': '\uf0d7',
  'caret-left': '\uf0d9',
  'caret-right': '\uf0da',
  'caret-up': '\uf0d8',
  'circle': '\uf111',
  'cloud': '\uf0c2',
  'cloud-rain': '\uf73d',
  'coins': '\uf51e',
  'flask': '\uf0c3',
  'gavel': '\uf0e3',
  'hand-fist': '\uf6de',
  'helicopter': '\uf533',
  'hotel': '\uf594',
  'list': '\uf03a',
  'mask': '\uf6fa',
  'microchip': '\uf2db',
  'person-running': '\uf70c',
  'satellite-dish': '\uf7c0',
  'seedling': '\uf4d8',
  'shield-halved': '\uf3ed',
  'skull': '\uf54c',
  'store': '\uf54e',
  'torii-gate': '\uf6a1',
  'tower-broadcast': '\uf519',
  'train-subway': '\uf239',
  'trophy': '\uf091',
  'user-secret': '\uf21b'
};
let fontAwesomeLoadPromise: Promise<void> | null = null;

function fixedRendererFromParams(params: URLSearchParams): string {
  return (params.get('fixed_renderer') ?? params.get('renderer') ?? '').toLowerCase();
}

function isLegacyFixedRenderer(params: URLSearchParams): boolean {
  return legacyFixedRenderers.has(fixedRendererFromParams(params));
}

function loadPhaserFontAwesome(): Promise<void> {
  if (fontAwesomeLoadPromise) {
    return fontAwesomeLoadPromise;
  }

  fontAwesomeLoadPromise = (async () => {
    if (document.fonts.check(`900 16px "${fontAwesomeFamily}"`)) {
      document.body.dataset.phaserFontAwesomeReady = '1';
      return;
    }

    const fontFace = new FontFace(fontAwesomeFamily, `url(${faSolidFontUrl})`, {
      style: 'normal',
      weight: '900'
    });
    const loadedFace = await fontFace.load();
    document.fonts.add(loadedFace);
    await document.fonts.load(`900 16px "${fontAwesomeFamily}"`);
    document.body.dataset.phaserFontAwesomeReady = '1';
  })().catch((error: unknown) => {
    document.body.dataset.phaserFontAwesomeReady = '0';
    console.warn('Font Awesome could not be loaded for the Phaser fixed-skin renderer.', error);
  });

  return fontAwesomeLoadPromise;
}

export function isPhaserFixedSkinWorkbench(): boolean {
  const params = new URLSearchParams(window.location.search);
  const workbench = params.get('workbench') ?? params.get('bench');
  return workbench === 'phaser-fixed-skin' ||
    (workbench === 'fixed-skin' && !isLegacyFixedRenderer(params));
}

export interface PhaserFixedSkinRuntimeUi {
  render(state: GameState): void;
  setActionPending(pending: boolean): void;
  setConnectionStatus(status: string): void;
  addLog(message: string): void;
  destroy(): void;
}

export function isPhaserFixedSkinRuntime(location: Location = window.location, viewportWidth = window.innerWidth): boolean {
  const params = new URL(location.href).searchParams;
  const requestedUi = params.get('ui')?.toLowerCase();
  if (requestedUi === 'classic' || requestedUi === 'responsive') {
    return false;
  }

  const renderer = fixedRendererFromParams(params);
  if (legacyFixedRenderers.has(renderer)) {
    return false;
  }

  return requestedUi === 'phaser-fixed-skin' ||
    requestedUi === 'fixed-skin' ||
    params.get('fixed_skin') === '1' ||
    renderer === 'phaser' ||
    viewportWidth <= 860;
}

export function createPhaserFixedSkinRuntime(
  skin: GameSkin,
  onAction: (action: GameAction) => void
): PhaserFixedSkinRuntimeUi {
  const profile = selectFixedSkinProfile(skin);
  if (!profile) {
    throw new Error(`Skin ${skin.id} does not define fixed profiles`);
  }

  let currentState = createWorkbenchState();
  let hasLiveState = false;
  let logs = ['Connecting...'];
  let logOpen = false;
  let inventoryOpen = false;
  let actionPending = false;
  let connectionStatus = 'offline';

  document.body.dataset.ui = 'phaser-fixed-skin';
  document.body.dataset.fixedProfile = profile.id;
  document.body.dataset.fixedRenderer = 'phaser';
  document.body.dataset.phaserDrawer = 'closed';
  document.body.dataset.phaserRuntimeState = 'booting';

  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app');
  }
  app.replaceChildren();

  const host = createPhaserHost(app);
  const scene = new PhaserFixedSkinScene({
    profile,
    skin,
    state: currentState,
    logs,
    scenario: 'combat',
    connectionStatus,
    onAction,
    onToggleLog() {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderScene();
    },
    onToggleInventory() {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderScene();
    }
  });
  const game = createPhaserFixedGame(host, profile, scene);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key === 'Escape' && (logOpen || inventoryOpen)) {
      logOpen = false;
      inventoryOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    if (event.key.toLowerCase() === 'l') {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    if (event.key.toLowerCase() === 'i') {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    const inventoryAction = inventoryActionFromKey(event.key, currentState, actionPending);
    if (inventoryOpen && hasLiveState && inventoryAction) {
      onAction(inventoryAction);
      event.preventDefault();
      return;
    }

    const direction = directionFromKey(event.key);
    if (direction && hasLiveState && canMove(currentState, direction) && !logOpen && !inventoryOpen && !actionPending) {
      onAction({ action: 'move', direction });
      event.preventDefault();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  function renderScene(): void {
    document.body.dataset.phaserDrawer = logOpen ? 'log' : inventoryOpen ? 'inventory' : 'closed';
    document.body.dataset.phaserRuntimeState = hasLiveState ? 'live' : 'booting';
    document.body.dataset.phaserStatus = connectionStatus;
    applyPhaserStateDatasets(currentState, inventoryOpen, actionPending);
    document.body.classList.toggle('in-combat', currentState.in_combat);
    document.body.classList.toggle('game-ended', isTerminalState(currentState));
    scene.renderWorkbenchState({
      state: currentState,
      logs,
      logOpen,
      inventoryOpen,
      actionPending,
      connectionStatus
    });
  }

  renderScene();

  return {
    render(state: GameState): void {
      currentState = state;
      hasLiveState = true;
      renderScene();
    },
    setActionPending(pending: boolean): void {
      actionPending = pending;
      renderScene();
    },
    setConnectionStatus(status: string): void {
      connectionStatus = status;
      renderScene();
    },
    addLog(message: string): void {
      if (!message.trim()) {
        return;
      }
      logs = [message, ...logs.filter((entry) => entry !== 'Connecting...')].slice(0, 40);
      renderScene();
    },
    destroy(): void {
      window.removeEventListener('keydown', onKeyDown);
      game.destroy(false);
    }
  };
}

export function startPhaserFixedSkinWorkbench(skin: GameSkin): void {
  const profile = selectFixedSkinProfile(skin);
  if (!profile) {
    throw new Error(`Skin ${skin.id} does not define fixed profiles`);
  }

  const scenario = selectScenario();
  let state = createScenarioState(scenario);
  let logs = createScenarioLogs(scenario);
  let logOpen = false;
  let inventoryOpen = false;
  let actionPending = scenario === 'status';
  let connectionStatus = scenario === 'status' ? 'thinking' : 'ready';

  document.body.dataset.workbench = 'phaser-fixed-skin';
  document.body.dataset.fixedProfile = profile.id;
  document.body.dataset.fixedScenario = scenario;
  document.body.dataset.fixedRenderer = 'phaser';
  document.body.dataset.phaserDrawer = 'closed';

  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app');
  }
  app.replaceChildren();

  const host = createPhaserHost(app);

  const scene = new PhaserFixedSkinScene({
    profile,
    skin,
    state,
    logs,
    scenario,
    connectionStatus,
    onAction: dispatchAction,
    onToggleLog() {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderScene();
    },
    onToggleInventory() {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderScene();
    }
  });

  const game = createPhaserFixedGame(host, profile, scene);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key === 'Escape' && (logOpen || inventoryOpen)) {
      logOpen = false;
      inventoryOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    if (event.key.toLowerCase() === 'l') {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    if (event.key.toLowerCase() === 'i') {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderScene();
      event.preventDefault();
      return;
    }

    const inventoryAction = inventoryActionFromKey(event.key, state, actionPending);
    if (inventoryOpen && inventoryAction) {
      dispatchAction(inventoryAction);
      event.preventDefault();
      return;
    }

    const direction = directionFromKey(event.key);
    if (direction && canMove(state, direction) && !logOpen && !inventoryOpen && !actionPending) {
      dispatchAction({ action: 'move', direction });
      event.preventDefault();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('keydown', onKeyDown);
    game.destroy(false);
  });

  function dispatchAction(action: GameAction): void {
    if (actionPending && action.action !== 'restart') {
      return;
    }

    state = applyWorkbenchAction(state, action);
    logs = action.action === 'restart'
      ? createScenarioLogs('combat')
      : [describeAction(action), ...logs].slice(0, 12);
    if (action.action === 'restart') {
      logOpen = false;
      inventoryOpen = false;
      actionPending = false;
      connectionStatus = 'ready';
    }
    renderScene();
  }

  function renderScene(): void {
    document.body.dataset.phaserDrawer = logOpen ? 'log' : inventoryOpen ? 'inventory' : 'closed';
    applyPhaserStateDatasets(state, inventoryOpen, actionPending);
    document.body.classList.toggle('in-combat', state.in_combat);
    document.body.classList.toggle('game-ended', isTerminalState(state));
    scene.renderWorkbenchState({
      state,
      logs,
      logOpen,
      inventoryOpen,
      actionPending,
      connectionStatus
    });
  }
}

function createPhaserHost(app: HTMLElement): HTMLElement {
  const host = document.createElement('div');
  host.id = 'phaser-fixed-skin-workbench';
  host.dataset.phaserFixedSkin = '1';
  host.style.width = '100vw';
  host.style.height = '100svh';
  host.style.overflow = 'hidden';
  host.style.background = '#020504';
  app.append(host);
  return host;
}

function createPhaserFixedGame(
  host: HTMLElement,
  profile: FixedSkinProfile,
  scene: Phaser.Scene
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: '#020504',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      parent: host,
      width: profile.width,
      height: profile.height
    },
    render: {
      antialias: false,
      pixelArt: true
    },
    scene
  });
}

class PhaserFixedSkinScene extends Phaser.Scene {
  private readonly profile: FixedSkinProfile;
  private readonly skin: GameSkin;
  private readonly onAction: (action: GameAction) => void;
  private readonly onToggleLog: () => void;
  private readonly onToggleInventory: () => void;
  private readonly scenario: PhaserFixedScenario;
  private viewState: SceneState;
  private ready = false;
  private faGlyphsDrawn = 0;

  constructor(config: SceneConfig) {
    super('PhaserFixedSkinScene');
    this.profile = config.profile;
    this.skin = config.skin;
    this.onAction = config.onAction;
    this.onToggleLog = config.onToggleLog;
    this.onToggleInventory = config.onToggleInventory;
    this.scenario = config.scenario;
    this.viewState = {
      state: config.state,
      logs: config.logs,
      logOpen: false,
      inventoryOpen: false,
      actionPending: config.scenario === 'status',
      connectionStatus: config.connectionStatus
    };
  }

  preload(): void {
    this.load.image(assetKey(this.profile, 'chassis'), this.profile.background);
    for (const [buttonId, button] of buttonEntries(this.profile)) {
      for (const state of Object.keys(button.states) as FixedSkinButtonState[]) {
        this.load.image(buttonKey(this.profile, buttonId, state), button.states[state]);
      }
    }

    for (const state of Object.keys(this.profile.indicators.status.states) as FixedSkinIndicatorState[]) {
      const asset = this.profile.indicators.status.states[state];
      if (asset) {
        this.load.image(indicatorKey(this.profile, 'status', state), asset);
      }
    }

    for (const state of Object.keys(this.profile.indicators.combatLed.states) as FixedSkinIndicatorState[]) {
      const asset = this.profile.indicators.combatLed.states[state];
      if (asset) {
        this.load.image(indicatorKey(this.profile, 'combatLed', state), asset);
      }
    }
  }

  create(): void {
    this.ready = true;
    void loadPhaserFontAwesome().then(() => {
      if (this.ready) {
        this.redraw();
      }
    });
    this.redraw();
  }

  renderWorkbenchState(state: SceneState): void {
    this.viewState = state;
    if (this.ready) {
      this.redraw();
    }
  }

  private redraw(): void {
    this.faGlyphsDrawn = 0;
    this.children.removeAll(true);
    this.add.image(0, 0, assetKey(this.profile, 'chassis')).setOrigin(0, 0);
    this.drawMap();
    this.drawLatest();
    this.drawTitle();
    this.drawPlayer();
    this.drawCombat();
    this.drawIndicators();
    this.drawButtons();
    if (this.viewState.logOpen) {
      this.drawLogDrawer();
    }
    if (this.viewState.inventoryOpen) {
      this.drawInventoryDrawer();
    }
    if (isTerminalState(this.viewState.state)) {
      this.drawEndState();
    }
    if (this.scenario === 'diagnostics') {
      this.drawDiagnostics();
    }
    document.body.dataset.phaserFontAwesomeGlyphs = String(this.faGlyphsDrawn);
  }

  private drawMap(): void {
    const { state } = this.viewState;
    const region = this.profile.regions.map;
    const graphics = this.add.graphics();
    const tileSize = Math.max(12, Math.floor(Math.min(region.width / state.map_width, region.height / state.map_height)));
    const boardWidth = tileSize * state.map_width;
    const boardHeight = tileSize * state.map_height;
    const originX = region.x + Math.floor((region.width - boardWidth) / 2);
    const originY = region.y + Math.floor((region.height - boardHeight) / 2);

    graphics.fillStyle(0x020504, 0.22);
    graphics.fillRect(region.x, region.y, region.width, region.height);

    for (let y = 0; y < state.map_height; y += 1) {
      for (let x = 0; x < state.map_width; x += 1) {
        const explored = state.explored[y]?.[x] ?? false;
        const cell = state.cell_types[y]?.[x];
        const base = parseHexColor(cell?.map_color);
        const tileX = originX + x * tileSize;
        const tileY = originY + y * tileSize;
        const fill = scaleRgb(base, explored ? this.skin.map.exploredTileScale : this.skin.map.unexploredTileScale);
        graphics.fillStyle(scaleRgb(fill, explored ? 0.64 : 0.36), 1);
        graphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        graphics.lineStyle(1, explored ? this.skin.map.exploredTileStroke : this.skin.map.unexploredTileStroke, explored ? 0.95 : 0.35);
        graphics.strokeRect(tileX + 0.5, tileY + 0.5, tileSize - 1, tileSize - 1);

        if (explored && tileSize >= 20) {
          this.addFontAwesomeIcon(
            cell?.font_awesome_icon,
            '.',
            tileX + tileSize / 2,
            tileY + tileSize / 2,
            Math.max(9, Math.floor(tileSize * 0.42)),
            '#d5dad2'
          ).setOrigin(0.5, 0.5).setAlpha(0.66);
        }

        if (!explored) {
          graphics.fillStyle(this.skin.map.unexploredTileOverlay, this.skin.map.unexploredTileOverlayAlpha);
          graphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        }
      }
    }

    for (const item of state.item_placements ?? []) {
      if (item.is_collected || !state.explored[item.y]?.[item.x]) {
        continue;
      }
      this.drawMapBadge(originX, originY, tileSize, item.x, item.y, item.font_awesome_icon, '+', 0xffcc4d);
    }

    for (const enemy of state.enemies) {
      if (enemy.is_defeated || !state.explored[enemy.y]?.[enemy.x]) {
        continue;
      }
      this.drawMapBadge(originX, originY, tileSize, enemy.x, enemy.y, enemy.font_awesome_icon, '!', 0xff6682);
    }

    this.drawPlayerMarker(originX, originY, tileSize);
  }

  private drawMapBadge(originX: number, originY: number, tileSize: number, x: number, y: number, icon: string | undefined, fallback: string, color: number): void {
    const centerX = originX + x * tileSize + tileSize * 0.76;
    const centerY = originY + y * tileSize + tileSize * 0.26;
    const radius = Math.max(5, Math.floor(tileSize * 0.22));
    const graphics = this.add.graphics();
    graphics.fillStyle(0x050807, 0.88);
    graphics.fillCircle(centerX, centerY, radius + 1);
    graphics.fillStyle(color, 0.96);
    graphics.fillCircle(centerX, centerY, radius);
    this.addFontAwesomeIcon(icon, fallback, centerX, centerY, Math.max(8, Math.floor(tileSize * 0.3)), '#141414')
      .setOrigin(0.5, 0.5);
  }

  private drawPlayerMarker(originX: number, originY: number, tileSize: number): void {
    const [x, y] = this.viewState.state.player_pos;
    const tileX = originX + x * tileSize;
    const tileY = originY + y * tileSize;
    const color = isTerminalState(this.viewState.state)
      ? (this.viewState.state.game_won ? this.skin.map.victoryPlayerMarker : this.skin.map.defeatedPlayerMarker)
      : this.skin.map.playerMarker;
    const graphics = this.add.graphics();
    const inset = Math.max(2, Math.floor(tileSize * 0.1));
    const length = Math.max(7, Math.floor(tileSize * 0.34));
    const right = tileX + tileSize - inset;
    const bottom = tileY + tileSize - inset;
    graphics.lineStyle(Math.max(2, Math.floor(tileSize * 0.08)), 0x020504, 0.9);
    drawCornerBrackets(graphics, tileX + inset, tileY + inset, right, bottom, length);
    graphics.lineStyle(Math.max(1, Math.floor(tileSize * 0.05)), color, 1);
    drawCornerBrackets(graphics, tileX + inset, tileY + inset, right, bottom, length);
  }

  private drawLatest(): void {
    const latest = this.profile.regions.latest;
    this.addText('LATEST', latest.x + 8, latest.y + 8, latest.width - 16, {
      fontSize: 10,
      color: '#98ff84',
      fontStyle: 'bold'
    });
    this.addText(this.viewState.logs[0] ?? 'Ready.', latest.x + 8, latest.y + 24, latest.width - 16, {
      fontSize: this.profile.kind === 'mobileCompact' ? 13 : 14,
      color: '#f3fff1',
      fontStyle: 'bold',
      lineSpacing: 2
    }, latest.height - 28);
  }

  private drawTitle(): void {
    const rect = this.profile.regions.title;
    if (this.profile.kind !== 'mobileCompact') {
      this.addText('ROGUELLM', rect.x, rect.y - 16, rect.width, {
        fontSize: 10,
        color: '#88ff7a',
        fontStyle: 'bold'
      });
    }
    const iconSize = this.profile.kind === 'mobileCompact' ? 17 : 20;
    this.addFontAwesomeIcon(
      this.viewState.state.player.font_awesome_icon,
      '@',
      rect.x + 2,
      rect.y + Math.max(15, rect.height * 0.5),
      iconSize,
      '#88ff7a'
    ).setOrigin(0, 0.5);
    this.addText(this.viewState.state.game_title, rect.x + iconSize + 12, rect.y, rect.width - iconSize - 12, {
      fontSize: this.profile.kind === 'mobileCompact' ? 20 : 24,
      color: '#f6fff3',
      fontStyle: 'bold'
    }, rect.height);
  }

  private drawPlayer(): void {
    const state = this.viewState.state;
    const hpRect = this.profile.regions.playerHp;
    const hpFill = this.profile.regions.playerHpFill;
    const hpRatio = clampRatio(state.player_hp / Math.max(1, state.player_max_hp));
    this.addText('HP', hpRect.x + 8, hpRect.y + 7, 36, {
      fontSize: 16,
      color: '#c8cdd6'
    });
    this.addText(`${Math.max(0, state.player_hp)}/${state.player_max_hp}`, hpRect.x + hpRect.width - 96, hpRect.y + 7, 88, {
      fontSize: 16,
      color: '#f7fbff',
      fontStyle: 'bold',
      align: 'right'
    });
    this.drawMeter(hpFill, hpRatio, 0x75f06a);

    const stats = this.profile.regions.playerStats;
    const tile = currentTileName(state);
    const columns = [
      ['ATK', String(state.player_attack), '#ff6682'],
      ['DEF', String(state.player_defense), '#72d6ff'],
      ['XP', String(state.player_xp), '#e776ff'],
      ['TILE', tile, '#ffd15a']
    ] as const;
    const columnWidth = Math.floor(stats.width / columns.length);
    columns.forEach(([label, value, color], index) => {
      const x = stats.x + columnWidth * index;
      this.addText(label, x, stats.y + 2, columnWidth - 4, {
        fontSize: 10,
        color,
        fontStyle: 'bold'
      });
      this.addText(value, x, stats.y + 18, columnWidth - 4, {
        fontSize: index === 3 ? 11 : 15,
        color: '#f7fbff',
        fontStyle: 'bold'
      }, stats.height - 18);
    });
  }

  private drawCombat(): void {
    const state = this.viewState.state;
    const rect = this.profile.regions.combat;
    const enemy = state.current_enemy;
    this.addText(state.in_combat ? 'COMBAT' : 'EXPLORE', rect.x + 8, rect.y + 6, 72, {
      fontSize: 11,
      color: state.in_combat ? '#ff7188' : '#88ff7a',
      fontStyle: 'bold'
    });

    if (!state.in_combat || !enemy) {
      this.addText('Movement online', rect.x + 8, rect.y + 24, rect.width - 16, {
        fontSize: 14,
        color: '#d9e4db',
        fontStyle: 'bold'
      });
      return;
    }

    this.addFontAwesomeIcon(enemy.font_awesome_icon, '!', rect.x + 14, rect.y + 32, 14, '#ff8fa0')
      .setOrigin(0.5, 0.5);
    this.addText(enemy.name, rect.x + 30, rect.y + 24, rect.width - 134, {
      fontSize: 14,
      color: '#dde5e0',
      fontStyle: 'bold'
    });
    this.addText(`${enemy.hp}/${enemy.max_hp}`, rect.x + rect.width - 86, rect.y + 24, 78, {
      fontSize: 14,
      color: '#f7fbff',
      fontStyle: 'bold',
      align: 'right'
    });
    this.drawMeter(this.profile.regions.enemyHpFill, clampRatio(enemy.hp / Math.max(1, enemy.max_hp)), 0xff4e5e);
  }

  private drawIndicators(): void {
    const statusState = statusIndicatorState(this.viewState.connectionStatus);
    this.drawImageIfLoaded(indicatorKey(this.profile, 'status', statusState), this.profile.indicators.status.rect);
    this.addText(shortStatus(this.viewState.connectionStatus), this.profile.indicators.status.rect.x + 7, this.profile.indicators.status.rect.y + 9, this.profile.indicators.status.rect.width - 14, {
      fontSize: 10,
      color: '#f5fff1',
      fontStyle: 'bold',
      align: 'center'
    });

    const combatState: FixedSkinIndicatorState = this.viewState.state.in_combat ? 'on' : 'off';
    this.drawImageIfLoaded(indicatorKey(this.profile, 'combatLed', combatState), this.profile.indicators.combatLed.rect);
  }

  private drawButtons(): void {
    for (const [buttonId, button] of buttonEntries(this.profile)) {
      this.drawButton(buttonId, button);
    }
  }

  private drawButton(buttonId: FixedButtonId, button: FixedSkinButton): void {
    if (buttonId === 'restart' && !isTerminalState(this.viewState.state)) {
      return;
    }

    const disabled = this.isButtonDisabled(buttonId);
    const active = (buttonId === 'log' && this.viewState.logOpen) || (buttonId === 'inventory' && this.viewState.inventoryOpen);
    const state: FixedSkinButtonState = disabled ? 'disabled' : active ? 'pressed' : 'idle';
    const key = buttonKey(this.profile, buttonId, state);
    if (!this.textures.exists(key)) {
      return;
    }

    const image = this.add.image(button.rect.x, button.rect.y, key).setOrigin(0, 0);
    if (!disabled) {
      image.setInteractive({ useHandCursor: true });
      image.on('pointerover', () => image.setTexture(buttonKey(this.profile, buttonId, active ? 'pressed' : 'hover')));
      image.on('pointerout', () => image.setTexture(buttonKey(this.profile, buttonId, active ? 'pressed' : 'idle')));
      image.on('pointerdown', () => image.setTexture(buttonKey(this.profile, buttonId, 'pressed')));
      image.on('pointerup', () => {
        if (buttonId === 'log') {
          this.onToggleLog();
        } else if (buttonId === 'inventory') {
          this.onToggleInventory();
        } else {
          const action = buttonActions[buttonId];
          if (action) {
            this.onAction(action);
          }
        }
      });
    }

    if (!button.hideLabel) {
      this.addText(button.label, button.rect.x + 6, button.rect.y + Math.max(6, button.rect.height * 0.34), button.rect.width - 12, {
        fontSize: button.rect.height >= 60 ? 18 : 12,
        color: disabled ? '#9aa0a8' : '#f8fff4',
        fontStyle: 'bold',
        align: 'center'
      });
    }
  }

  private drawLogDrawer(): void {
    const rect = this.profile.regions.log;
    this.drawPanelScrim(rect, 0x07100b, 0.96);
    this.addText('LOG', rect.x + 10, rect.y + 10, rect.width - 20, {
      fontSize: 13,
      color: '#aafc92',
      fontStyle: 'bold'
    });
    const rowHeight = this.profile.kind === 'mobileCompact' ? 40 : 46;
    const maxRows = Math.max(1, Math.floor((rect.height - 36) / rowHeight));
    this.viewState.logs.slice(0, maxRows).forEach((message, index) => {
      const y = rect.y + 34 + rowHeight * index;
      this.addText(index === 0 ? 'NEW' : String(index + 1).padStart(2, '0'), rect.x + 10, y + 2, 34, {
        fontSize: 10,
        color: index === 0 ? '#93ff7b' : '#7ba58a',
        fontStyle: 'bold'
      });
      this.addText(message, rect.x + 50, y, rect.width - 66, {
        fontSize: 12,
        color: '#f3fff1',
        fontStyle: index === 0 ? 'bold' : ''
      }, rowHeight - 4);
    });
  }

  private drawInventoryDrawer(): void {
    const rect = this.profile.regions.inventory ?? this.profile.regions.log;
    this.drawPanelScrim(rect, 0x07100b, 0.96);
    this.addText('INVENTORY', rect.x + 10, rect.y + 10, rect.width - 20, {
      fontSize: 13,
      color: '#aafc92',
      fontStyle: 'bold'
    });
    const rowHeight = this.profile.kind === 'mobileCompact' ? 40 : 46;
    const maxRows = Math.max(1, Math.floor((rect.height - 36) / rowHeight));
    this.viewState.state.inventory.slice(0, maxRows).forEach((item, index) => {
      const y = rect.y + 34 + rowHeight * index;
      const action = inventoryRowAction(item, this.viewState);
      const graphics = this.add.graphics();
      graphics.fillStyle(item.is_equipped ? 0x12341c : 0x0b1710, item.is_equipped ? 0.82 : 0.68);
      graphics.fillRect(rect.x + 8, y - 3, rect.width - 16, rowHeight - 6);
      graphics.lineStyle(1, item.is_equipped ? 0x9bff7c : 0x2a5d41, item.is_equipped ? 0.58 : 0.38);
      graphics.strokeRect(rect.x + 8.5, y - 2.5, rect.width - 17, rowHeight - 7);

      const badgeColor = itemTypeColor(item.type);
      graphics.fillStyle(badgeColor, 0.28);
      graphics.fillRoundedRect(rect.x + 12, y + 4, 38, 22, 4);
      graphics.lineStyle(1, badgeColor, 0.85);
      graphics.strokeRoundedRect(rect.x + 12.5, y + 4.5, 37, 21, 4);
      this.addText(itemTypeLabel(item.type), rect.x + 15, y + 9, 32, {
        fontSize: 10,
        color: itemTypeTextColor(item.type),
        fontStyle: 'bold',
        align: 'center'
      });

      this.addText(item.name, rect.x + 58, y + 1, rect.width - 138, {
        fontSize: 12,
        color: '#f3fff1',
        fontStyle: 'bold'
      }, rowHeight - 20);
      this.addText(item.description, rect.x + 58, y + 19, rect.width - 138, {
        fontSize: 9,
        color: '#b8c7bc'
      }, Math.max(12, rowHeight - 24));
      this.drawInventoryActionChip(rect.x + rect.width - 72, y + 5, 54, 24, action);
    });
  }

  private drawInventoryActionChip(x: number, y: number, width: number, height: number, rowAction: InventoryRowAction): void {
    const active = rowAction.state === 'ready';
    const equipped = rowAction.state === 'equipped';
    const border = equipped ? 0x9bff7c : active ? 0x66d7ff : 0x67706a;
    const fill = equipped ? 0x173d19 : active ? 0x102c36 : 0x171c1b;
    const graphics = this.add.graphics();
    graphics.fillStyle(fill, rowAction.disabled ? 0.72 : 0.92);
    graphics.fillRoundedRect(x, y, width, height, 5);
    graphics.lineStyle(1, border, rowAction.disabled && !equipped ? 0.45 : 0.9);
    graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 5);
    const label = this.addText(rowAction.label, x + 4, y + 6, width - 8, {
      fontSize: 10,
      color: equipped ? '#aaff8d' : active ? '#dffcff' : '#8e9690',
      fontStyle: 'bold',
      align: 'center'
    }, height - 4);
    label.setDepth(2);
    if (!rowAction.disabled && rowAction.action) {
      const hit = this.add.zone(x, y, width, height).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => {
        graphics.clear();
        graphics.fillStyle(0x184554, 0.98);
        graphics.fillRoundedRect(x, y, width, height, 5);
        graphics.lineStyle(1, 0xb0f8ff, 1);
        graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 5);
      });
      hit.on('pointerout', () => {
        graphics.clear();
        graphics.fillStyle(fill, 0.92);
        graphics.fillRoundedRect(x, y, width, height, 5);
        graphics.lineStyle(1, border, 0.9);
        graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 5);
      });
      hit.on('pointerup', () => {
        if (rowAction.action) {
          this.onAction(rowAction.action);
        }
      });
    }
  }

  private drawEndState(): void {
    const state = this.viewState.state;
    const rect = this.profile.regions.endState ?? centeredRect(this.profile, 314, 238);
    this.drawPanelScrim(rect, state.game_won ? 0x102012 : 0x211017, 0.94);
    this.addText(state.game_won ? 'VICTORY' : 'DEFEAT', rect.x + 18, rect.y + 18, rect.width - 36, {
      fontSize: 22,
      color: state.game_won ? '#a6ff83' : '#ff7188',
      fontStyle: 'bold',
      align: 'center'
    });
    this.addText(state.game_won ? 'The city opens its locked doors.' : 'The signal fades under neon rain.', rect.x + 24, rect.y + 62, rect.width - 48, {
      fontSize: 15,
      color: '#f6fff3',
      fontStyle: 'bold',
      align: 'center'
    }, 64);
    this.addText(`HP ${Math.max(0, state.player_hp)}     XP ${state.player_xp}`, rect.x + 24, rect.y + 134, rect.width - 48, {
      fontSize: 14,
      color: '#dfe8df',
      fontStyle: 'bold',
      align: 'center'
    });
  }

  private drawDiagnostics(): void {
    const rect = this.profile.regions.map;
    this.drawPanelScrim(rect, 0x020504, 0.76);
    this.addText(`${this.profile.label} Phaser renderer`, rect.x + 10, rect.y + 10, rect.width - 20, {
      fontSize: 15,
      color: '#aaff8d',
      fontStyle: 'bold'
    });
    this.addText('Canvas-only skin pass: chassis, map, meters, messages, drawers, controls, and terminal states are rendered inside Phaser.', rect.x + 10, rect.y + 36, rect.width - 20, {
      fontSize: 12,
      color: '#f5fff1'
    }, 76);
  }

  private drawMeter(rect: FixedSkinRect, ratio: number, color: number): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x0a0e11, 0.76);
    graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    graphics.fillStyle(color, 0.94);
    graphics.fillRect(rect.x, rect.y, Math.max(1, Math.round(rect.width * ratio)), rect.height);
  }

  private drawPanelScrim(rect: FixedSkinRect, color: number, alpha: number): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(color, alpha);
    graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    graphics.lineStyle(1, 0x99ff82, 0.45);
    graphics.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  private drawImageIfLoaded(key: string, rect: FixedSkinRect): void {
    if (this.textures.exists(key)) {
      this.add.image(rect.x, rect.y, key).setOrigin(0, 0);
    }
  }

  private addFontAwesomeIcon(
    iconClass: string | undefined,
    fallback: string,
    x: number,
    y: number,
    fontSize: number,
    color: string
  ): Phaser.GameObjects.Text {
    const glyph = fontAwesomeGlyph(iconClass);
    if (glyph) {
      this.faGlyphsDrawn += 1;
    }
    return this.add.text(x, y, glyph ?? fallback, {
      fontFamily: glyph ? `"${fontAwesomeFamily}"` : 'monospace',
      fontSize: `${fontSize}px`,
      color,
      fontStyle: glyph ? '900' : 'bold',
      align: 'center'
    });
  }

  private addText(
    text: string,
    x: number,
    y: number,
    width: number,
    style: {
      fontSize: number;
      color: string;
      fontStyle?: string;
      align?: 'left' | 'center' | 'right';
      lineSpacing?: number;
    },
    maxHeight?: number
  ): Phaser.GameObjects.Text {
    const object = this.add.text(x, y, text, {
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: `${style.fontSize}px`,
      color: style.color,
      fontStyle: style.fontStyle,
      align: style.align ?? 'left',
      wordWrap: { width, useAdvancedWrap: true }
    });
    object.setLineSpacing(style.lineSpacing ?? 1);
    if (style.align === 'center') {
      object.setFixedSize(width, maxHeight ?? 0);
    }
    if (style.align === 'right') {
      object.setOrigin(0, 0);
      object.setFixedSize(width, maxHeight ?? 0);
    }
    if (maxHeight && object.height > maxHeight) {
      object.setFontSize(Math.max(9, Math.floor(style.fontSize * maxHeight / object.height)));
    }
    return object;
  }

  private isButtonDisabled(buttonId: FixedButtonId): boolean {
    const { state, actionPending } = this.viewState;
    if (buttonId === 'log' || buttonId === 'inventory') {
      return false;
    }
    if (buttonId === 'restart') {
      return !isTerminalState(state) && !state.game_over && !state.game_won;
    }
    if (actionPending) {
      return true;
    }
    if (buttonId === 'attack' || buttonId === 'run') {
      return !state.in_combat || isTerminalState(state);
    }
    if (buttonId === 'moveN') {
      return !canMove(state, 'n');
    }
    if (buttonId === 'moveS') {
      return !canMove(state, 's');
    }
    if (buttonId === 'moveE') {
      return !canMove(state, 'e');
    }
    if (buttonId === 'moveW') {
      return !canMove(state, 'w');
    }
    return false;
  }
}

function selectScenario(): PhaserFixedScenario {
  const requested = new URLSearchParams(window.location.search).get('scenario') as PhaserFixedScenario | null;
  return requested && ['combat', 'movement', 'diagnostics', 'status', 'defeat', 'victory'].includes(requested)
    ? requested
    : 'combat';
}

function createScenarioState(scenario: PhaserFixedScenario): GameState {
  const base = createWorkbenchState();
  if (scenario === 'movement' || scenario === 'diagnostics') {
    return {
      ...base,
      in_combat: false,
      current_enemy: null,
      player_pos: [1, 1],
      player_pos_prev: [1, 1]
    };
  }
  if (scenario === 'defeat') {
    return {
      ...base,
      in_combat: false,
      current_enemy: null,
      player_hp: -6,
      game_over: true
    };
  }
  if (scenario === 'victory') {
    return {
      ...base,
      in_combat: false,
      current_enemy: null,
      player_hp: 71,
      game_won: true
    };
  }
  return base;
}

function createScenarioLogs(scenario: PhaserFixedScenario): string[] {
  const intro: Record<PhaserFixedScenario, string> = {
    combat: 'Phaser fixed-skin pass: combat controls, HP meters, latest message, and map are canvas-rendered.',
    movement: 'Phaser fixed-skin pass: movement is unlocked; arrows and D-pad update the canvas state.',
    diagnostics: 'Diagnostics: this renderer is the no-CSS migration target for fixed skins.',
    status: 'Status test: controls are disabled while the model is thinking.',
    defeat: 'Defeat test: terminal overlay and restart control are visible.',
    victory: 'Victory test: terminal overlay and restart control are visible.'
  };
  return [intro[scenario], ...WORKBENCH_LOGS];
}

function buttonEntries(profile: FixedSkinProfile): ButtonEntry[] {
  return Object.entries(profile.buttons)
    .filter((entry): entry is ButtonEntry => Boolean(entry[1]));
}

function assetKey(profile: FixedSkinProfile, asset: string): string {
  return `phaser-fixed:${profile.id}:${asset}`;
}

function buttonKey(profile: FixedSkinProfile, buttonId: FixedButtonId, state: FixedSkinButtonState): string {
  return assetKey(profile, `button:${buttonId}:${state}`);
}

function indicatorKey(profile: FixedSkinProfile, indicatorId: 'status' | 'combatLed', state: FixedSkinIndicatorState): string {
  return assetKey(profile, `indicator:${indicatorId}:${state}`);
}

function statusIndicatorState(status: string): FixedSkinIndicatorState {
  if (status === 'ready' || status === 'online') {
    return 'ready';
  }
  if (status === 'error' || status === 'closed') {
    return 'error';
  }
  if (status === 'offline') {
    return 'offline';
  }
  return 'thinking';
}

function shortStatus(status: string): string {
  if (status === 'ready' || status === 'online') {
    return 'READY';
  }
  if (status === 'offline') {
    return 'OFF';
  }
  if (status === 'error' || status === 'closed') {
    return 'ERR';
  }
  return 'WAIT';
}

function canMove(state: GameState, direction: Direction): boolean {
  if (state.in_combat || isTerminalState(state)) {
    return false;
  }
  const [x, y] = state.player_pos;
  const [nextX, nextY] = nextPosition(x, y, direction);
  return nextX >= 0 && nextX < state.map_width && nextY >= 0 && nextY < state.map_height;
}

function nextPosition(x: number, y: number, direction: Direction): [number, number] {
  switch (direction) {
    case 'n':
      return [x, y - 1];
    case 's':
      return [x, y + 1];
    case 'w':
      return [x - 1, y];
    case 'e':
      return [x + 1, y];
  }
}

function directionFromKey(key: string): Direction | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'n';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 's';
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'w';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'e';
    default:
      return null;
  }
}

function describeAction(action: GameAction): string {
  if (action.action === 'move') {
    return `Moved ${action.direction.toUpperCase()} inside the Phaser-rendered skin.`;
  }
  if (action.action === 'attack') {
    return 'Attack resolved on the Phaser-rendered control deck.';
  }
  if (action.action === 'run') {
    return 'Run resolved and movement controls came back online.';
  }
  if (action.action === 'restart') {
    return 'Restarted the workbench scenario.';
  }
  return 'Workbench action resolved.';
}

function currentTileName(state: GameState): string {
  const [x, y] = state.player_pos;
  return state.cell_types[y]?.[x]?.name ?? 'Unknown';
}

function itemTypeLabel(type: string): string {
  if (type === 'weapon') {
    return 'WPN';
  }
  if (type === 'armor') {
    return 'ARM';
  }
  if (type === 'consumable') {
    return 'USE';
  }
  return 'ITM';
}

function itemTypeColor(type: string): number {
  if (type === 'weapon') {
    return 0xff6682;
  }
  if (type === 'armor') {
    return 0x72d6ff;
  }
  if (type === 'consumable') {
    return 0xffd15a;
  }
  return 0xb7c4bd;
}

function itemTypeTextColor(type: string): string {
  if (type === 'weapon') {
    return '#ff92a5';
  }
  if (type === 'armor') {
    return '#8fe3ff';
  }
  if (type === 'consumable') {
    return '#ffe07b';
  }
  return '#d3ddd5';
}

function inventoryRowAction(item: Item, viewState: SceneState): InventoryRowAction {
  const disabledByState = viewState.actionPending || isTerminalState(viewState.state);
  if (item.type === 'consumable') {
    return {
      action: { action: 'use_item', item_id: item.id },
      label: 'USE',
      disabled: disabledByState,
      state: disabledByState ? 'disabled' : 'ready'
    };
  }
  if (item.type === 'weapon' || item.type === 'armor') {
    return {
      action: { action: 'equip_item', item_id: item.id },
      label: item.is_equipped ? 'ON' : 'EQP',
      disabled: disabledByState || item.is_equipped,
      state: item.is_equipped ? 'equipped' : disabledByState ? 'disabled' : 'ready'
    };
  }
  return {
    action: null,
    label: '---',
    disabled: true,
    state: 'disabled'
  };
}

function inventoryActionFromKey(key: string, state: GameState, actionPending: boolean): GameAction | null {
  const index = Number(key) - 1;
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    return null;
  }
  const item = state.inventory[index];
  if (!item) {
    return null;
  }
  const rowAction = inventoryRowAction(item, {
    state,
    logs: [],
    logOpen: false,
    inventoryOpen: true,
    actionPending,
    connectionStatus: 'ready'
  });
  return rowAction.disabled ? null : rowAction.action;
}

function applyPhaserStateDatasets(state: GameState, inventoryOpen: boolean, actionPending: boolean): void {
  const visibleItems = state.inventory.slice(0, 9);
  const rowActions = visibleItems.map((item) => inventoryRowAction(item, {
    state,
    logs: [],
    logOpen: false,
    inventoryOpen,
    actionPending,
    connectionStatus: 'ready'
  }));
  document.body.dataset.phaserInventoryOpen = inventoryOpen ? '1' : '0';
  document.body.dataset.phaserInventoryCount = String(visibleItems.length);
  document.body.dataset.phaserInventoryActions = String(rowActions.length);
  document.body.dataset.phaserInventoryReadyActions = String(rowActions.filter((action) => !action.disabled && action.action).length);
  document.body.dataset.phaserEquippedCount = String(visibleItems.filter((item) => item.is_equipped).length);
  document.body.dataset.phaserInventoryActionLabels = rowActions.map((action) => action.label).join(',');
  document.body.dataset.phaserPlayerHp = String(Math.max(0, state.player_hp));
}

function isTerminalState(state: GameState): boolean {
  return state.game_over || state.game_won || state.player_hp <= 0;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function fontAwesomeGlyph(iconClass: string | undefined): string | null {
  const classes = iconClass?.trim().split(/\s+/) ?? [];
  for (const className of classes) {
    const normalized = className.toLowerCase();
    if (!normalized.startsWith('fa-') || fontAwesomeStyleClasses.has(normalized)) {
      continue;
    }
    const iconName = normalized.slice(3);
    const glyph = fontAwesomeGlyphs[iconName];
    if (glyph) {
      return glyph;
    }
  }
  return null;
}

function drawCornerBrackets(graphics: Phaser.GameObjects.Graphics, left: number, top: number, right: number, bottom: number, length: number): void {
  graphics.lineBetween(left, top, left + length, top);
  graphics.lineBetween(left, top, left, top + length);
  graphics.lineBetween(right, top, right - length, top);
  graphics.lineBetween(right, top, right, top + length);
  graphics.lineBetween(left, bottom, left + length, bottom);
  graphics.lineBetween(left, bottom, left, bottom - length);
  graphics.lineBetween(right, bottom, right - length, bottom);
  graphics.lineBetween(right, bottom, right, bottom - length);
}

function centeredRect(profile: FixedSkinProfile, width: number, height: number): FixedSkinRect {
  return {
    x: Math.floor((profile.width - width) / 2),
    y: Math.floor((profile.height - height) / 2),
    width,
    height
  };
}

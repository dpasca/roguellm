import Phaser from 'phaser';
import faSolidFontUrl from '@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?url';
import type { Direction, GameAction, GameState, Item } from '../protocol/types';
import type {
  FixedSkinButton,
  FixedSkinButtonState,
  FixedSkinIndicatorState,
  FixedSkinMaterialKind,
  FixedSkinProfile,
  FixedSkinRect,
  FixedSkinRenderTheme,
  FixedSkinRuntimeLayout,
  FixedSkinStatSlotId,
  GameSkin
} from '../skins/types';
import { parseHexColor, scaleRgb } from '../game/color';
import { cycleFixedSkinProfile } from './fixedSkinProfileCycling';
import { selectFixedSkinProfile } from './fixedSkinProfileSelection';
import { applyWorkbenchAction, createWorkbenchState, WORKBENCH_LOGS } from './workbenchFixtures';

type FixedButtonId = keyof FixedSkinProfile['buttons'];
type PhaserFixedScenario = 'combat' | 'movement' | 'diagnostics' | 'status' | 'defeat' | 'victory';
type SkinMotif = 'amber' | 'gold' | 'signal' | 'terminal' | 'reference';
type PhaserTextStyle = {
  fontSize: number;
  color: string;
  fontStyle?: string;
  align?: 'left' | 'center' | 'right';
  lineSpacing?: number;
  minFontSize?: number;
};

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

const legacyFixedRenderers = new Set(['dom', 'html', 'legacy']);
const fontAwesomeFamily = 'Font Awesome 7 Free';
const fontAwesomeStyleClasses = new Set(['fa', 'fas', 'far', 'fab', 'fa-solid', 'fa-regular', 'fa-brands']);
const fontAwesomeGlyphs: Record<string, string> = {
  'ban': '\uf05e',
  'bolt': '\uf0e7',
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
  'car': '\uf1b9',
  'city': '\uf64f',
  'circle': '\uf111',
  'cloud': '\uf0c2',
  'cloud-rain': '\uf73d',
  'coins': '\uf51e',
  'fish': '\uf578',
  'flask': '\uf0c3',
  'fist-raised': '\uf6de',
  'gavel': '\uf0e3',
  'hand-fist': '\uf6de',
  'helicopter': '\uf533',
  'hotel': '\uf594',
  'industry': '\uf275',
  'laptop-code': '\uf5fc',
  'list': '\uf03a',
  'mask': '\uf6fa',
  'microchip': '\uf2db',
  'person-running': '\uf70c',
  'place-of-worship': '\uf67f',
  'question': '\u003f',
  'satellite-dish': '\uf7c0',
  'seedling': '\uf4d8',
  'shield-halved': '\uf3ed',
  'skull': '\uf54c',
  'store': '\uf54e',
  'subway': '\uf239',
  'torii-gate': '\uf6a1',
  'tower-broadcast': '\uf519',
  'tree': '\uf1bb',
  'train-subway': '\uf239',
  'trophy': '\uf091',
  'tv': '\uf26c',
  'user-secret': '\uf21b',
  'user-tie': '\uf508',
  'water': '\uf773'
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
    if (document.fonts.check(`16px "${fontAwesomeFamily}"`)) {
      document.body.dataset.phaserFontAwesomeReady = '1';
      return;
    }

    const fontFace = new FontFace(fontAwesomeFamily, `url(${faSolidFontUrl})`, {
      style: 'normal',
      weight: 'normal'
    });
    const loadedFace = await fontFace.load();
    document.fonts.add(loadedFace);
    await document.fonts.load(`16px "${fontAwesomeFamily}"`);
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

export function isPhaserFixedSkinRuntime(location: Location = window.location): boolean {
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
    renderer === '';
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

    if (event.key.toLowerCase() === 'r' && hasLiveState && isTerminalState(currentState)) {
      onAction({ action: 'restart' });
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

    if (cycleFixedSkinProfile(skin, profile, event)) {
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

    if (event.key.toLowerCase() === 'r' && isTerminalState(state)) {
      dispatchAction({ action: 'restart' });
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
    scene.renderWorkbenchState({
      state,
      logs,
      logOpen,
      inventoryOpen,
      actionPending,
      connectionStatus
    });
  }

  renderScene();
}

function createPhaserHost(app: HTMLElement): HTMLElement {
  document.documentElement.style.margin = '0';
  document.documentElement.style.width = '100%';
  document.documentElement.style.height = '100%';
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.background = '#020504';
  document.body.style.margin = '0';
  document.body.style.minWidth = '320px';
  document.body.style.minHeight = '100svh';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#020504';
  app.style.width = '100vw';
  app.style.height = '100svh';
  app.style.overflow = 'hidden';
  app.style.background = '#020504';
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
  private readonly theme: FixedSkinRenderTheme;
  private readonly onAction: (action: GameAction) => void;
  private readonly onToggleLog: () => void;
  private readonly onToggleInventory: () => void;
  private readonly scenario: PhaserFixedScenario;
  private viewState: SceneState;
  private ready = false;
  private faGlyphsDrawn = 0;
  private canvasIconMarksDrawn = 0;
  private materialPanelsDrawn = 0;
  private sourceMaterialPanelsDrawn = 0;
  private readonly sourceMaterialKindsDrawn = new Set<FixedSkinMaterialKind>();
  private readonly buttonStatesDrawn = new Map<FixedButtonId, FixedSkinButtonState>();
  private logRowsDrawn = 0;
  private inventoryRowsDrawn = 0;
  private inventoryActionChipsDrawn = 0;
  private actionButtonLabelsDrawn = 0;
  private chromeDetailsDrawn = 0;
  private shellDetailsDrawn = 0;
  private mapTileDetailsDrawn = 0;
  private fogTileDetailsDrawn = 0;
  private controlDetailsDrawn = 0;
  private hudDetailsDrawn = 0;
  private drawerToggleIconsDrawn = 0;
  private movementLockBadgesDrawn = 0;
  private textSlotsDrawn = 0;
  private textSlotsShrunk = 0;
  private textSlotsEllipsized = 0;
  private textSlotOverflows = 0;

  constructor(config: SceneConfig) {
    super('PhaserFixedSkinScene');
    this.profile = config.profile;
    this.skin = config.skin;
    this.theme = fixedSkinRenderTheme(config.profile);
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
    for (const materialKind of Object.keys(this.profile.materials) as FixedSkinMaterialKind[]) {
      this.load.image(materialKey(this.profile, materialKind, 'fill'), this.profile.materials[materialKind].fill);
      this.load.image(materialKey(this.profile, materialKind, 'frame'), this.profile.materials[materialKind].frame);
    }

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
    this.canvasIconMarksDrawn = 0;
    this.materialPanelsDrawn = 0;
    this.sourceMaterialPanelsDrawn = 0;
    this.sourceMaterialKindsDrawn.clear();
    this.buttonStatesDrawn.clear();
    this.logRowsDrawn = 0;
    this.inventoryRowsDrawn = 0;
    this.inventoryActionChipsDrawn = 0;
    this.actionButtonLabelsDrawn = 0;
    document.body.dataset.phaserPointerButtonState = '';
    this.chromeDetailsDrawn = 0;
    this.shellDetailsDrawn = 0;
    this.mapTileDetailsDrawn = 0;
    this.fogTileDetailsDrawn = 0;
    this.controlDetailsDrawn = 0;
    this.hudDetailsDrawn = 0;
    this.drawerToggleIconsDrawn = 0;
    this.movementLockBadgesDrawn = 0;
    this.textSlotsDrawn = 0;
    this.textSlotsShrunk = 0;
    this.textSlotsEllipsized = 0;
    this.textSlotOverflows = 0;
    this.children.removeAll(true);
    this.add.image(0, 0, assetKey(this.profile, 'chassis')).setOrigin(0, 0);
    this.drawShellHardware();
    this.drawMap();
    this.drawLatest();
    this.drawTitle();
    this.drawPlayer();
    this.drawCombat();
    this.drawIndicators();
    this.drawControlsBay();
    this.drawButtons();
    this.drawMovementLockBadge();
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
    document.body.dataset.phaserCanvasIconMarks = String(this.canvasIconMarksDrawn);
    document.body.dataset.phaserMaterialPanels = String(this.materialPanelsDrawn);
    document.body.dataset.phaserSourceMaterialPanels = String(this.sourceMaterialPanelsDrawn);
    document.body.dataset.phaserSourceMaterialKinds = [...this.sourceMaterialKindsDrawn].sort().join(',');
    document.body.dataset.phaserButtonStates = [...this.buttonStatesDrawn]
      .map(([buttonId, state]) => `${buttonId}:${state}`)
      .sort()
      .join(',');
    document.body.dataset.phaserLogRows = String(this.logRowsDrawn);
    document.body.dataset.phaserInventoryRows = String(this.inventoryRowsDrawn);
    document.body.dataset.phaserInventoryActionChips = String(this.inventoryActionChipsDrawn);
    document.body.dataset.phaserActionButtonLabels = String(this.actionButtonLabelsDrawn);
    document.body.dataset.phaserChromeDetails = String(this.chromeDetailsDrawn);
    document.body.dataset.phaserShellDetails = String(this.shellDetailsDrawn);
    document.body.dataset.phaserMapTileDetails = String(this.mapTileDetailsDrawn);
    document.body.dataset.phaserFogTileDetails = String(this.fogTileDetailsDrawn);
    document.body.dataset.phaserControlDetails = String(this.controlDetailsDrawn);
    document.body.dataset.phaserHudDetails = String(this.hudDetailsDrawn);
    document.body.dataset.phaserDrawerToggleIcons = String(this.drawerToggleIconsDrawn);
    document.body.dataset.phaserMovementLockBadges = String(this.movementLockBadgesDrawn);
    document.body.dataset.phaserTextSlots = String(this.textSlotsDrawn);
    document.body.dataset.phaserTextShrinks = String(this.textSlotsShrunk);
    document.body.dataset.phaserTextEllipses = String(this.textSlotsEllipsized);
    document.body.dataset.phaserTextOverflows = String(this.textSlotOverflows);
  }

  private drawShellHardware(): void {
    const width = this.profile.width;
    const height = this.profile.height;
    const graphics = this.add.graphics();
    const primary = this.theme.primary;
    const secondary = this.theme.secondary;
    const control = this.theme.controlFrame;

    graphics.fillStyle(0x020504, 0.28);
    graphics.fillRect(0, 0, width, height);
    graphics.lineStyle(2, control, 0.48);
    graphics.strokeRoundedRect(6.5, 6.5, width - 13, height - 13, 8);
    graphics.lineStyle(1, primary, 0.36);
    graphics.strokeRoundedRect(14.5, 36.5, width - 29, height - 45, 4);
    graphics.lineStyle(1, 0xffffff, 0.08);
    graphics.lineBetween(18, 10, width - 18, 10);
    graphics.lineBetween(10, 18, 10, height - 18);
    graphics.lineStyle(1, 0x010302, 0.62);
    graphics.lineBetween(18, height - 9, width - 18, height - 9);
    graphics.lineBetween(width - 9, 18, width - 9, height - 18);
    this.shellDetailsDrawn += 8;

    this.drawHeaderHardware(graphics, width, primary, secondary, control);
    this.drawSideRails(graphics, width, height, primary, secondary);
    this.drawRegionHarness(graphics, this.profile.regions.map, primary, 'map');
    this.drawRegionHarness(graphics, this.profile.regions.latest, secondary, 'latest');
    this.drawRegionHarness(graphics, this.profile.regions.playerHp, primary, 'player');
    this.drawRegionHarness(graphics, this.profile.regions.combat, this.theme.combat, 'combat');
    this.drawLowerDeckHardware(graphics, width, height, primary, secondary);
  }

  private drawHeaderHardware(graphics: Phaser.GameObjects.Graphics, width: number, primary: number, secondary: number, control: number): void {
    graphics.fillStyle(0x020504, 0.7);
    graphics.fillRoundedRect(18, 14, width - 36, 20, 8);
    graphics.lineStyle(1, control, 0.5);
    graphics.strokeRoundedRect(18.5, 14.5, width - 37, 19, 8);
    graphics.lineStyle(1, 0xffffff, 0.12);
    graphics.lineBetween(30, 17, width - 30, 17);
    this.shellDetailsDrawn += 3;

    for (let index = 0; index < 5; index += 1) {
      const x = width - 54 + index * 7;
      const barHeight = 5 + index * 3;
      graphics.fillStyle(index < 4 ? primary : secondary, 0.86);
      graphics.fillRoundedRect(x, 26 - barHeight, 4, barHeight, 1);
      this.shellDetailsDrawn += 1;
    }

    graphics.fillStyle(secondary, 0.86);
    graphics.fillRoundedRect(24, 21, 22, 6, 3);
    graphics.fillStyle(0x020504, 0.72);
    graphics.fillCircle(width - 24, 24, 7);
    graphics.lineStyle(1, primary, 0.5);
    graphics.strokeCircle(width - 24, 24, 5);
    this.shellDetailsDrawn += 4;

    this.drawShellScrew(graphics, 16, 16, control);
    this.drawShellScrew(graphics, width - 16, 16, control);
  }

  private drawSideRails(graphics: Phaser.GameObjects.Graphics, width: number, height: number, primary: number, secondary: number): void {
    const railTop = 52;
    const railBottom = height - 42;
    for (const side of [18, width - 22]) {
      graphics.fillStyle(0x020504, 0.62);
      graphics.fillRoundedRect(side, railTop, 4, railBottom - railTop, 2);
      graphics.lineStyle(1, primary, 0.24);
      graphics.lineBetween(side + 1, railTop + 8, side + 1, railBottom - 8);
      this.shellDetailsDrawn += 2;
      for (let y = railTop + 18; y < railBottom - 10; y += 38) {
        graphics.fillStyle((Math.floor(y / 38) % 2 === 0) ? primary : secondary, 0.5);
        graphics.fillRoundedRect(side - 1, y, 6, 11, 2);
        this.shellDetailsDrawn += 1;
      }
    }
  }

  private drawRegionHarness(graphics: Phaser.GameObjects.Graphics, rect: FixedSkinRect, tint: number, role: 'map' | 'latest' | 'player' | 'combat'): void {
    const expanded = role === 'map' ? outsetRect(rect, 5) : outsetRect(rect, 4);
    const length = role === 'map' ? 20 : 13;
    const alpha = role === 'combat' && !this.viewState.state.in_combat ? 0.22 : 0.38;

    graphics.lineStyle(1, tint, alpha);
    this.drawShellCorner(graphics, expanded.x, expanded.y, 1, 1, length);
    this.drawShellCorner(graphics, expanded.x + expanded.width, expanded.y, -1, 1, length);
    this.drawShellCorner(graphics, expanded.x, expanded.y + expanded.height, 1, -1, length);
    this.drawShellCorner(graphics, expanded.x + expanded.width, expanded.y + expanded.height, -1, -1, length);
    this.shellDetailsDrawn += 8;

    if (role === 'map') {
      graphics.lineStyle(1, 0xffffff, 0.08);
      graphics.lineBetween(expanded.x + 26, expanded.y - 3, expanded.x + expanded.width - 26, expanded.y - 3);
      graphics.lineStyle(1, tint, 0.18);
      graphics.lineBetween(expanded.x - 3, expanded.y + 22, expanded.x - 3, expanded.y + expanded.height - 22);
      graphics.lineBetween(expanded.x + expanded.width + 3, expanded.y + 22, expanded.x + expanded.width + 3, expanded.y + expanded.height - 22);
      this.shellDetailsDrawn += 3;
    }

    if (role === 'latest') {
      this.drawTinyLedCluster(graphics, expanded.x + expanded.width + 9, expanded.y + 11, tint);
      this.drawCircuitTrace(graphics, expanded.x + expanded.width + 2, expanded.y + 24, expanded.x + expanded.width + 24, expanded.y + 24, tint);
    }

    if (role === 'player' || role === 'combat') {
      this.drawCircuitTrace(graphics, expanded.x + 12, expanded.y - 7, expanded.x + expanded.width - 12, expanded.y - 7, tint);
    }
  }

  private drawLowerDeckHardware(graphics: Phaser.GameObjects.Graphics, width: number, height: number, primary: number, secondary: number): void {
    const y = height - 28;
    graphics.fillStyle(0x020504, 0.68);
    graphics.fillRoundedRect(28, y, width - 56, 13, 5);
    graphics.lineStyle(1, primary, 0.22);
    graphics.strokeRoundedRect(28.5, y + 0.5, width - 57, 12, 5);
    this.shellDetailsDrawn += 2;

    for (let index = 0; index < 12; index += 1) {
      const x = 52 + index * 12;
      const lit = index % 4 !== 0;
      graphics.fillStyle(lit ? (index % 3 === 0 ? secondary : primary) : 0x26302c, lit ? 0.58 : 0.36);
      graphics.fillRoundedRect(x, y + 5, 7, 3, 1);
      this.shellDetailsDrawn += 1;
    }

    for (let index = 0; index < 9; index += 1) {
      const x = width - 96 + index * 7;
      graphics.lineStyle(1, 0x3a453f, 0.48);
      graphics.lineBetween(x, y + 3, x, y + 10);
      this.shellDetailsDrawn += 1;
    }

    this.drawShellScrew(graphics, 17, height - 17, primary);
    this.drawShellScrew(graphics, width - 17, height - 17, primary);
  }

  private drawShellCorner(graphics: Phaser.GameObjects.Graphics, x: number, y: number, xDirection: 1 | -1, yDirection: 1 | -1, length: number): void {
    graphics.lineBetween(x, y, x + xDirection * length, y);
    graphics.lineBetween(x, y, x, y + yDirection * length);
  }

  private drawCircuitTrace(graphics: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, tint: number): void {
    const midX = Math.round((x1 + x2) / 2);
    graphics.lineStyle(1, tint, 0.22);
    graphics.lineBetween(x1, y1, midX, y1);
    graphics.lineBetween(midX, y1, midX, y2);
    graphics.lineBetween(midX, y2, x2, y2);
    graphics.fillStyle(tint, 0.45);
    graphics.fillCircle(x1, y1, 1.5);
    graphics.fillCircle(x2, y2, 1.5);
    this.shellDetailsDrawn += 5;
  }

  private drawTinyLedCluster(graphics: Phaser.GameObjects.Graphics, x: number, y: number, tint: number): void {
    for (let index = 0; index < 3; index += 1) {
      graphics.fillStyle(index === 2 ? this.theme.secondary : tint, index === 1 ? 0.32 : 0.74);
      graphics.fillRoundedRect(x, y + index * 7, 9, 3, 1);
      this.shellDetailsDrawn += 1;
    }
  }

  private drawShellScrew(graphics: Phaser.GameObjects.Graphics, x: number, y: number, tint: number): void {
    graphics.fillStyle(0x020504, 0.9);
    graphics.fillCircle(x, y, 5);
    graphics.fillStyle(tint, 0.38);
    graphics.fillCircle(x, y, 3);
    graphics.lineStyle(1, 0xffffff, 0.15);
    graphics.lineBetween(x - 3, y - 1, x + 3, y - 1);
    graphics.lineStyle(1, 0x010302, 0.62);
    graphics.lineBetween(x - 3, y + 1, x + 3, y + 1);
    this.shellDetailsDrawn += 3;
  }

  private drawMap(): void {
    const { state } = this.viewState;
    const region = this.profile.regions.map;
    const graphics = this.add.graphics();
    const tileWidth = Math.max(12, Math.floor((region.width - 12) / state.map_width));
    const tileHeight = Math.max(12, Math.floor((region.height - 12) / state.map_height));
    const tileMinor = Math.min(tileWidth, tileHeight);
    const boardWidth = tileWidth * state.map_width;
    const boardHeight = tileHeight * state.map_height;
    const originX = region.x + Math.floor((region.width - boardWidth) / 2);
    const originY = region.y + Math.floor((region.height - boardHeight) / 2);
    const contentCells = new Set<string>([cellKey(state.player_pos[0], state.player_pos[1])]);
    for (const item of state.item_placements ?? []) {
      if (!item.is_collected && state.explored[item.y]?.[item.x]) {
        contentCells.add(cellKey(item.x, item.y));
      }
    }
    for (const enemy of state.enemies) {
      if (!enemy.is_defeated && state.explored[enemy.y]?.[enemy.x]) {
        contentCells.add(cellKey(enemy.x, enemy.y));
      }
    }

    this.drawMaterialPanel(insetRect(region, 1), 'panel', {
      alpha: 0.42,
      fillTint: 0x060c09,
      frameTint: this.theme.primary
    });
    graphics.fillStyle(0x020504, 0.28);
    graphics.fillRect(region.x + 7, region.y + 7, region.width - 14, region.height - 14);
    this.drawMapBoardChrome(graphics, originX, originY, boardWidth, boardHeight, tileWidth, tileHeight);

    for (let y = 0; y < state.map_height; y += 1) {
      for (let x = 0; x < state.map_width; x += 1) {
        const explored = state.explored[y]?.[x] ?? false;
        const cell = state.cell_types[y]?.[x];
        const base = parseHexColor(cell?.map_color);
        const tileX = originX + x * tileWidth;
        const tileY = originY + y * tileHeight;
        this.drawMapTile(graphics, tileX, tileY, tileWidth, tileHeight, base, explored);

        if (
          explored &&
          tileMinor >= 20 &&
          !contentCells.has(cellKey(x, y)) &&
          this.shouldDrawTerrainIcon(state, x, y, cell?.font_awesome_icon)
        ) {
          this.drawSemanticIcon(
            cell?.font_awesome_icon,
            '.',
            tileX + tileWidth * 0.5,
            tileY + tileHeight * 0.52,
            Math.max(8, Math.floor(tileMinor * 0.36)),
            this.theme.primaryDimText,
            0.44
          );
        }

      }
    }

    for (const item of state.item_placements ?? []) {
      if (item.is_collected || !state.explored[item.y]?.[item.x]) {
        continue;
      }
      this.drawMapBadge(originX, originY, tileWidth, tileHeight, item.x, item.y, item.font_awesome_icon, '+', 0xffcc4d);
    }

    for (const enemy of state.enemies) {
      if (enemy.is_defeated || !state.explored[enemy.y]?.[enemy.x]) {
        continue;
      }
      this.drawMapBadge(originX, originY, tileWidth, tileHeight, enemy.x, enemy.y, enemy.font_awesome_icon, '!', 0xff6682);
    }

    this.drawPlayerMarker(originX, originY, tileWidth, tileHeight);
  }

  private shouldDrawTerrainIcon(state: GameState, x: number, y: number, icon: string | undefined): boolean {
    const [playerX, playerY] = state.player_pos;
    const nearPlayer = Math.abs(x - playerX) + Math.abs(y - playerY) <= 1;
    if (nearPlayer) {
      return true;
    }

    const onMapEdge = x === 0 || y === 0 || x === state.map_width - 1 || y === state.map_height - 1;
    if (onMapEdge && (x + y) % 3 === 0) {
      return true;
    }

    const iconWeight = icon ? Array.from(icon).reduce((sum, char) => sum + char.charCodeAt(0), 0) : 0;
    return (x * 31 + y * 17 + iconWeight) % 5 === 0;
  }

  private drawMapBoardChrome(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number,
    boardWidth: number,
    boardHeight: number,
    tileWidth: number,
    tileHeight: number
  ): void {
    graphics.lineStyle(1, this.theme.primary, 0.26);
    graphics.strokeRect(originX - 2.5, originY - 2.5, boardWidth + 4, boardHeight + 4);
    graphics.lineStyle(1, this.theme.secondary, 0.16);
    graphics.strokeRect(originX - 5.5, originY - 5.5, boardWidth + 10, boardHeight + 10);

    graphics.lineStyle(1, this.theme.primary, 0.13);
    for (let x = originX; x <= originX + boardWidth; x += tileWidth) {
      graphics.lineBetween(x, originY - 4, x, originY - 1);
      graphics.lineBetween(x, originY + boardHeight + 1, x, originY + boardHeight + 4);
    }
    for (let y = originY; y <= originY + boardHeight; y += tileHeight) {
      graphics.lineBetween(originX - 4, y, originX - 1, y);
      graphics.lineBetween(originX + boardWidth + 1, y, originX + boardWidth + 4, y);
    }

    graphics.lineStyle(1, this.theme.primary, 0.06);
    for (let y = originY + 5; y < originY + boardHeight - 4; y += 6) {
      graphics.lineBetween(originX + 4, y, originX + boardWidth - 4, y);
    }
    this.mapTileDetailsDrawn += 8;
  }

  private drawMapTile(
    graphics: Phaser.GameObjects.Graphics,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    color: number,
    explored: boolean
  ): void {
    const width = tileWidth - 1;
    const height = tileHeight - 1;
    const tileMinor = Math.min(tileWidth, tileHeight);
    const displayColor = explored ? color : this.theme.controlFrame;
    const scaled = scaleRgb(displayColor, explored ? this.skin.map.exploredTileScale : this.skin.map.unexploredTileScale);
    const base = scaleRgb(scaled, explored ? 1.46 : 1.18);
    const top = scaleRgb(scaled, explored ? 2.08 : 1.74);
    const shadow = scaleRgb(scaled, explored ? 0.46 : 0.34);

    graphics.fillStyle(base, 1);
    graphics.fillRect(tileX, tileY, width, height);
    graphics.fillStyle(top, explored ? 0.32 : 0.09);
    graphics.fillRect(tileX + 1, tileY + 1, Math.max(1, width - 2), Math.max(1, Math.floor(height * 0.42)));

    if (tileMinor >= 18) {
      const dotStepX = Math.max(5, Math.floor(tileWidth * 0.17));
      const dotStepY = Math.max(5, Math.floor(tileHeight * 0.22));
      graphics.fillStyle(top, explored ? 0.52 : 0.1);
      for (let dotY = tileY + 5; dotY < tileY + height - 3; dotY += dotStepY) {
        for (let dotX = tileX + 6; dotX < tileX + width - 4; dotX += dotStepX) {
          graphics.fillRect(dotX, dotY, 1, 1);
        }
      }

      graphics.lineStyle(1, top, explored ? 0.34 : 0.07);
      for (let y = tileY + 7; y < tileY + height - 5; y += Math.max(7, Math.floor(tileHeight * 0.32))) {
        graphics.lineBetween(tileX + 5, y, tileX + width - 5, Math.min(tileY + height - 5, y + 2));
      }

      graphics.lineStyle(1, top, explored ? 0.16 : 0.04);
      for (let x = tileX + 8; x < tileX + width - 6; x += Math.max(8, Math.floor(tileWidth * 0.25))) {
        graphics.lineBetween(x, tileY + 5, Math.min(tileX + width - 4, x + 2), tileY + height - 5);
      }
    }

    graphics.lineStyle(1, top, explored ? 0.68 : 0.2);
    graphics.lineBetween(tileX + 1, tileY + 1, tileX + width - 2, tileY + 1);
    graphics.lineBetween(tileX + 1, tileY + 1, tileX + 1, tileY + height - 2);
    graphics.lineStyle(1, shadow, explored ? 0.92 : 0.62);
    graphics.lineBetween(tileX + 1, tileY + height - 1, tileX + width - 1, tileY + height - 1);
    graphics.lineBetween(tileX + width - 1, tileY + 1, tileX + width - 1, tileY + height - 1);
    graphics.lineStyle(1, explored ? this.skin.map.exploredTileStroke : this.skin.map.unexploredTileStroke, explored ? 1 : 0.38);
    graphics.strokeRect(tileX + 0.5, tileY + 0.5, width, height);

    if (!explored) {
      graphics.fillStyle(this.skin.map.unexploredTileOverlay, this.skin.map.unexploredTileOverlayAlpha);
      graphics.fillRect(tileX, tileY, width, height);
      this.drawFogTileHardware(graphics, tileX, tileY, width, height, tileMinor);
    }

    this.mapTileDetailsDrawn += tileMinor >= 18 ? 5 : 1;
  }

  private drawFogTileHardware(
    graphics: Phaser.GameObjects.Graphics,
    tileX: number,
    tileY: number,
    width: number,
    height: number,
    tileMinor: number
  ): void {
    const primary = this.theme.primary;
    const control = this.theme.controlFrame;
    graphics.fillStyle(primary, 0.12);
    graphics.fillRoundedRect(
      tileX + Math.max(3, Math.floor(width * 0.12)),
      tileY + Math.max(3, Math.floor(height * 0.16)),
      Math.max(3, Math.floor(width * 0.14)),
      Math.max(2, Math.floor(height * 0.08)),
      1
    );
    graphics.fillRoundedRect(
      tileX + width - Math.max(7, Math.floor(width * 0.22)),
      tileY + height - Math.max(6, Math.floor(height * 0.18)),
      Math.max(3, Math.floor(width * 0.13)),
      Math.max(2, Math.floor(height * 0.08)),
      1
    );
    graphics.lineStyle(1, control, 0.18);
    graphics.lineBetween(tileX + 4, tileY + height - 5, tileX + Math.floor(width * 0.4), tileY + height - 5);
    graphics.lineBetween(tileX + width - 5, tileY + 4, tileX + width - 5, tileY + Math.floor(height * 0.44));

    if (tileMinor >= 18) {
      graphics.lineStyle(1, primary, 0.11);
      graphics.lineBetween(tileX + 5, tileY + 4, tileX + width - 5, tileY + height - 6);
      graphics.lineStyle(1, 0x000000, 0.22);
      graphics.lineBetween(tileX + 5, tileY + 6, tileX + width - 7, tileY + height - 4);
      this.fogTileDetailsDrawn += 6;
      return;
    }

    this.fogTileDetailsDrawn += 4;
  }

  private drawMapBadge(originX: number, originY: number, tileWidth: number, tileHeight: number, x: number, y: number, icon: string | undefined, fallback: string, color: number): void {
    const tileMinor = Math.min(tileWidth, tileHeight);
    const centerX = originX + x * tileWidth + tileWidth * 0.75;
    const centerY = originY + y * tileHeight + tileHeight * 0.28;
    const radius = Math.max(5, Math.floor(tileMinor * 0.22));
    const graphics = this.add.graphics();
    graphics.fillStyle(0x050807, 0.88);
    graphics.fillCircle(centerX, centerY, radius + 1);
    graphics.fillStyle(color, 0.96);
    graphics.fillCircle(centerX, centerY, radius);
    this.drawSemanticIcon(icon, fallback, centerX, centerY, Math.max(8, Math.floor(tileMinor * 0.34)), '#141414', 0.9);
  }

  private drawPlayerMarker(originX: number, originY: number, tileWidth: number, tileHeight: number): void {
    const [x, y] = this.viewState.state.player_pos;
    const tileX = originX + x * tileWidth;
    const tileY = originY + y * tileHeight;
    const tileMinor = Math.min(tileWidth, tileHeight);
    const color = isTerminalState(this.viewState.state)
      ? (this.viewState.state.game_won ? this.skin.map.victoryPlayerMarker : this.skin.map.defeatedPlayerMarker)
      : this.skin.map.playerMarker;
    const graphics = this.add.graphics();
    const inset = Math.max(2, Math.floor(tileMinor * 0.1));
    const length = Math.max(7, Math.floor(tileMinor * 0.34));
    const right = tileX + tileWidth - inset;
    const bottom = tileY + tileHeight - inset;
    graphics.lineStyle(Math.max(2, Math.floor(tileMinor * 0.08)), 0x020504, 0.9);
    drawCornerBrackets(graphics, tileX + inset, tileY + inset, right, bottom, length);
    graphics.lineStyle(Math.max(1, Math.floor(tileMinor * 0.05)), color, 1);
    drawCornerBrackets(graphics, tileX + inset, tileY + inset, right, bottom, length);
  }

  private drawLatest(): void {
    const latest = this.profile.regions.latest;
    const layout = runtimeLayout(this.profile).latest;
    this.drawMaterialPanel(insetRect(latest, 0), 'lcd', {
      alpha: 0.82,
      fillTint: this.theme.lcdFill,
      frameTint: this.theme.primary,
      scanlines: true
    });
    this.addTextInRect('LATEST', layout.label, {
      fontSize: 10,
      color: this.theme.primaryText,
      fontStyle: 'bold'
    });
    this.addTextInRect(this.viewState.logs[0] ?? 'Ready.', layout.message, {
      fontSize: this.profile.kind === 'mobileCompact' ? 12 : 14,
      color: this.theme.bodyText,
      fontStyle: 'bold',
      lineSpacing: this.profile.kind === 'mobileCompact' ? 1 : 2
    });
  }

  private drawTitle(): void {
    const layout = runtimeLayout(this.profile).title;
    this.drawTitleReadoutHardware(layout);
    if (layout.brand) {
      this.addTextInRect('ROGUELLM', layout.brand, {
        fontSize: 10,
        color: this.theme.primaryText,
        fontStyle: 'bold'
      });
    }
    const iconSize = Math.min(layout.playerIcon.width, layout.playerIcon.height);
    this.drawSemanticIcon(
      this.viewState.state.player.font_awesome_icon,
      '@',
      layout.playerIcon.x + layout.playerIcon.width * 0.5,
      layout.playerIcon.y + layout.playerIcon.height * 0.5,
      iconSize,
      this.theme.primaryText,
      0.96
    );
    this.addTextInRect(this.viewState.state.game_title, layout.gameTitle, {
      fontSize: this.profile.kind === 'mobileCompact' ? 20 : 24,
      color: this.theme.titleText,
      fontStyle: 'bold'
    });
  }

  private drawTitleReadoutHardware(layout: FixedSkinRuntimeLayout['title']): void {
    const rect = this.profile.regions.title;
    const graphics = this.add.graphics();
    graphics.fillStyle(0x020504, 0.42);
    graphics.fillRoundedRect(rect.x - 3, rect.y - 2, rect.width + 6, rect.height + 4, 6);
    graphics.lineStyle(1, this.theme.primary, 0.24);
    graphics.strokeRoundedRect(rect.x - 2.5, rect.y - 1.5, rect.width + 5, rect.height + 3, 6);
    graphics.fillStyle(this.theme.primary, 0.11);
    graphics.fillRoundedRect(layout.playerIcon.x - 4, layout.playerIcon.y - 4, layout.playerIcon.width + 8, layout.playerIcon.height + 8, 5);
    graphics.lineStyle(1, this.theme.primary, 0.42);
    graphics.strokeRoundedRect(layout.playerIcon.x - 3.5, layout.playerIcon.y - 3.5, layout.playerIcon.width + 7, layout.playerIcon.height + 7, 5);
    graphics.lineStyle(1, this.theme.primary, 0.35);
    graphics.lineBetween(layout.gameTitle.x, rect.y + rect.height - 4, layout.gameTitle.x + layout.gameTitle.width, rect.y + rect.height - 4);
    graphics.lineStyle(1, 0xffffff, 0.1);
    graphics.lineBetween(layout.gameTitle.x, rect.y + 4, layout.gameTitle.x + layout.gameTitle.width, rect.y + 4);
    for (let index = 0; index < 5; index += 1) {
      const alpha = 0.18 + index * 0.08;
      graphics.fillStyle(index < 3 ? this.theme.primary : this.theme.secondary, alpha);
      graphics.fillRoundedRect(rect.x + rect.width - 46 + index * 8, rect.y + 6, 4, 8 + index, 2);
    }
    this.hudDetailsDrawn += 12;
  }

  private drawPlayer(): void {
    const state = this.viewState.state;
    const hpRect = this.profile.regions.playerHp;
    const hpFill = this.profile.regions.playerHpFill;
    const layout = runtimeLayout(this.profile).player;
    const hpRatio = clampRatio(state.player_hp / Math.max(1, state.player_max_hp));
    this.drawMaterialPanel(insetRect(hpRect, 0), 'panel', {
      alpha: 0.76,
      fillTint: this.theme.panelFill,
      frameTint: this.theme.primary,
      scanlines: true
    });
    this.drawPlayerReadoutHardware(hpRect, hpFill, layout);
    this.addTextInRect('HP', layout.hpLabel, {
      fontSize: 16,
      color: '#c8cdd6'
    });
    this.addTextInRect(`${Math.max(0, state.player_hp)}/${state.player_max_hp}`, layout.hpValue, {
      fontSize: 16,
      color: this.theme.titleText,
      fontStyle: 'bold',
      align: 'right'
    });
    this.drawMeter(hpFill, hpRatio, 0x75f06a);

    for (const slot of layout.stats) {
      this.addTextInRect(slot.label, slot.labelRect, {
        fontSize: this.profile.kind === 'mobileCompact' ? 9 : 10,
        color: statAccentColor(slot.id),
        fontStyle: 'bold'
      });
      this.addTextInRect(statValue(state, slot.id), slot.valueRect, {
        fontSize: slot.id === 'tile' ? (this.profile.kind === 'mobileCompact' ? 10 : 11) : 13,
        color: this.theme.titleText,
        fontStyle: 'bold'
      });
    }
  }

  private drawPlayerReadoutHardware(
    panel: FixedSkinRect,
    hpFill: FixedSkinRect,
    layout: FixedSkinRuntimeLayout['player']
  ): void {
    const graphics = this.add.graphics();
    const statsBounds = unionRects(layout.stats.flatMap((slot) => [slot.labelRect, slot.valueRect]));

    graphics.fillStyle(0x020504, 0.34);
    graphics.fillRoundedRect(panel.x + 5, panel.y + 5, panel.width - 10, panel.height - 10, 5);
    graphics.lineStyle(1, this.theme.primary, 0.16);
    graphics.strokeRoundedRect(panel.x + 5.5, panel.y + 5.5, panel.width - 11, panel.height - 11, 5);

    graphics.fillStyle(0x020504, 0.72);
    graphics.fillRoundedRect(hpFill.x - 4, hpFill.y - 4, hpFill.width + 8, hpFill.height + 8, 3);
    graphics.lineStyle(1, this.theme.primary, 0.42);
    graphics.strokeRoundedRect(hpFill.x - 3.5, hpFill.y - 3.5, hpFill.width + 7, hpFill.height + 7, 3);
    graphics.lineStyle(1, 0xffffff, 0.14);
    graphics.lineBetween(hpFill.x - 1, hpFill.y - 2, hpFill.x + hpFill.width + 1, hpFill.y - 2);

    for (let tick = 0; tick <= 10; tick += 1) {
      const x = hpFill.x + Math.round((hpFill.width * tick) / 10);
      const tall = tick % 5 === 0;
      graphics.lineStyle(1, tall ? this.theme.primary : this.theme.controlFrame, tall ? 0.42 : 0.2);
      graphics.lineBetween(x, hpFill.y + hpFill.height + 4, x, hpFill.y + hpFill.height + (tall ? 9 : 7));
    }

    if (statsBounds) {
      graphics.fillStyle(0x040806, 0.54);
      graphics.fillRoundedRect(statsBounds.x - 4, statsBounds.y - 3, statsBounds.width + 8, statsBounds.height + 5, 4);
      graphics.lineStyle(1, this.theme.primary, 0.18);
      graphics.strokeRoundedRect(statsBounds.x - 3.5, statsBounds.y - 2.5, statsBounds.width + 7, statsBounds.height + 4, 4);
      for (let index = 1; index < layout.stats.length; index += 1) {
        const previous = layout.stats[index - 1];
        const current = layout.stats[index];
        const x = Math.floor((previous.valueRect.x + previous.valueRect.width + current.labelRect.x) / 2) + 0.5;
        graphics.lineStyle(1, this.theme.controlFrame, 0.3);
        graphics.lineBetween(x, statsBounds.y - 1, x, statsBounds.y + statsBounds.height + 1);
      }
    }

    this.hudDetailsDrawn += statsBounds ? 25 : 18;
  }

  private drawCombat(): void {
    const state = this.viewState.state;
    const rect = this.profile.regions.combat;
    const enemy = state.current_enemy;
    const layout = runtimeLayout(this.profile).combat;
    this.drawMaterialPanel(insetRect(rect, 0), state.in_combat ? 'button' : 'panel', {
      alpha: state.in_combat ? 0.82 : 0.72,
      fillTint: state.in_combat ? 0x351018 : this.theme.panelFill,
      frameTint: state.in_combat ? this.theme.combat : this.theme.primary,
      scanlines: true
    });
    this.drawCombatReadoutHardware(rect, layout, state.in_combat);
    this.addTextInRect(state.in_combat ? 'COMBAT' : 'EXPLORE', layout.mode, {
      fontSize: 11,
      color: state.in_combat ? this.theme.combatText : this.theme.primaryText,
      fontStyle: 'bold'
    });

    if (!state.in_combat || !enemy) {
      this.addTextInRect('Movement online', layout.exploreText, {
        fontSize: 14,
        color: this.theme.bodyText,
        fontStyle: 'bold'
      });
      return;
    }

    this.drawSemanticIcon(
      enemy.font_awesome_icon,
      '!',
      layout.enemyIcon.x + layout.enemyIcon.width * 0.5,
      layout.enemyIcon.y + layout.enemyIcon.height * 0.5,
      Math.min(layout.enemyIcon.width, layout.enemyIcon.height),
      this.theme.combatText,
      0.96
    );
    this.addTextInRect(enemy.name, layout.enemyName, {
      fontSize: this.profile.kind === 'mobileCompact' ? 12 : 14,
      color: this.theme.bodyText,
      fontStyle: 'bold'
    });
    this.addTextInRect(`${enemy.hp}/${enemy.max_hp}`, layout.enemyHpValue, {
      fontSize: 14,
      color: this.theme.titleText,
      fontStyle: 'bold',
      align: 'right'
    });
    this.drawMeter(this.profile.regions.enemyHpFill, clampRatio(enemy.hp / Math.max(1, enemy.max_hp)), 0xff4e5e);
  }

  private drawCombatReadoutHardware(
    rect: FixedSkinRect,
    layout: FixedSkinRuntimeLayout['combat'],
    active: boolean
  ): void {
    const graphics = this.add.graphics();
    const tint = active ? this.theme.combat : this.theme.primary;
    graphics.fillStyle(active ? 0x180508 : 0x020504, active ? 0.46 : 0.34);
    graphics.fillRoundedRect(rect.x + 5, rect.y + 5, rect.width - 10, rect.height - 10, 5);
    graphics.lineStyle(1, tint, active ? 0.42 : 0.2);
    graphics.strokeRoundedRect(rect.x + 5.5, rect.y + 5.5, rect.width - 11, rect.height - 11, 5);

    graphics.fillStyle(tint, active ? 0.22 : 0.14);
    graphics.fillRoundedRect(layout.mode.x - 3, layout.mode.y - 2, layout.mode.width + 8, layout.mode.height + 5, 4);
    graphics.lineStyle(1, tint, active ? 0.62 : 0.38);
    graphics.strokeRoundedRect(layout.mode.x - 2.5, layout.mode.y - 1.5, layout.mode.width + 7, layout.mode.height + 4, 4);

    if (active) {
      const enemyWell = {
        x: layout.enemyIcon.x - 3,
        y: layout.enemyIcon.y - 3,
        width: layout.enemyName.x + layout.enemyName.width - layout.enemyIcon.x + 6,
        height: Math.max(layout.enemyIcon.height, layout.enemyName.height) + 6
      };
      graphics.fillStyle(0x040202, 0.62);
      graphics.fillRoundedRect(enemyWell.x, enemyWell.y, enemyWell.width, enemyWell.height, 4);
      graphics.lineStyle(1, this.theme.combat, 0.26);
      graphics.strokeRoundedRect(enemyWell.x + 0.5, enemyWell.y + 0.5, enemyWell.width - 1, enemyWell.height - 1, 4);
      graphics.lineStyle(1, this.theme.combat, 0.28);
      const meter = this.profile.regions.enemyHpFill;
      graphics.strokeRoundedRect(meter.x - 4.5, meter.y - 4.5, meter.width + 9, meter.height + 8, 3);
      for (let tick = 0; tick < 6; tick += 1) {
        const x = rect.x + rect.width - 68 + tick * 9;
        graphics.fillStyle(this.theme.combat, 0.18 + tick * 0.045);
        graphics.fillRoundedRect(x, rect.y + 9, 5, 4 + tick, 2);
      }
      this.hudDetailsDrawn += 16;
      return;
    }

    graphics.lineStyle(1, this.theme.primary, 0.22);
    graphics.lineBetween(layout.exploreText.x, layout.exploreText.y - 4, layout.exploreText.x + layout.exploreText.width - 10, layout.exploreText.y - 4);
    graphics.lineStyle(1, 0xffffff, 0.08);
    graphics.lineBetween(layout.exploreText.x, layout.exploreText.y + layout.exploreText.height + 2, layout.exploreText.x + layout.exploreText.width - 10, layout.exploreText.y + layout.exploreText.height + 2);
    this.hudDetailsDrawn += 9;
  }

  private drawIndicators(): void {
    const statusState = statusIndicatorState(this.viewState.connectionStatus);
    this.drawImageIfLoaded(indicatorKey(this.profile, 'status', statusState), this.profile.indicators.status.rect);
    this.addText(shortStatus(this.viewState.connectionStatus), this.profile.indicators.status.rect.x + 7, this.profile.indicators.status.rect.y + 9, this.profile.indicators.status.rect.width - 14, {
      fontSize: 10,
      color: this.theme.titleText,
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

  private drawControlsBay(): void {
    const rect = this.profile.regions.controls;
    if (!rect) {
      return;
    }
    this.drawMaterialPanel(insetRect(rect, 0), 'panel', {
      alpha: 0.48,
      fillTint: 0x0b100d,
      frameTint: this.theme.controlFrame,
      scanlines: false
    });
    this.drawControlBayHardware(rect);
  }

  private drawButton(buttonId: FixedButtonId, button: FixedSkinButton): void {
    if (buttonId === 'restart' && !isTerminalState(this.viewState.state)) {
      return;
    }

    const disabled = this.isButtonDisabled(buttonId);
    const active = (buttonId === 'log' && this.viewState.logOpen) || (buttonId === 'inventory' && this.viewState.inventoryOpen);
    const state: FixedSkinButtonState = disabled ? 'disabled' : active ? 'pressed' : 'idle';
    this.buttonStatesDrawn.set(buttonId, state);
    const key = buttonKey(this.profile, buttonId, state);
    if (!this.textures.exists(key)) {
      return;
    }

    const image = this.add.image(button.rect.x, button.rect.y, key).setOrigin(0, 0);
    this.drawButtonHardwareOverlay(buttonId, button, state, disabled);
    if (!disabled) {
      image.setInteractive({ useHandCursor: true });
      image.on('pointerover', () => {
        const nextState = active ? 'pressed' : 'hover';
        image.setTexture(buttonKey(this.profile, buttonId, nextState));
        this.setPointerButtonState(buttonId, nextState);
      });
      image.on('pointerout', () => {
        const nextState = active ? 'pressed' : 'idle';
        image.setTexture(buttonKey(this.profile, buttonId, nextState));
        this.setPointerButtonState(buttonId, nextState);
      });
      image.on('pointerdown', () => {
        image.setTexture(buttonKey(this.profile, buttonId, 'pressed'));
        this.setPointerButtonState(buttonId, 'pressed');
      });
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
      const hasLargeIcon = button.icon && (buttonId === 'attack' || buttonId === 'run' || buttonId === 'restart');
      const labelX = hasLargeIcon ? button.rect.x + 52 : button.rect.x + 6;
      const labelWidth = hasLargeIcon ? button.rect.width - 66 : button.rect.width - 12;
      this.addText(button.label, labelX, button.rect.y + Math.max(6, button.rect.height * 0.34), labelWidth, {
        fontSize: button.rect.height >= 60 ? 18 : 12,
        color: disabled ? '#9aa0a8' : this.theme.titleText,
        fontStyle: 'bold',
        align: 'center'
      }, Math.max(14, button.rect.height - 18));
      if (buttonId === 'attack' || buttonId === 'run') {
        this.actionButtonLabelsDrawn += 1;
      }
    }
  }

  private setPointerButtonState(buttonId: FixedButtonId, state: FixedSkinButtonState): void {
    document.body.dataset.phaserPointerButtonState = `${buttonId}:${state}`;
  }

  private drawControlBayHardware(rect: FixedSkinRect): void {
    const graphics = this.add.graphics();
    const moveRects = [
      this.profile.buttons.moveN?.rect,
      this.profile.buttons.moveS?.rect,
      this.profile.buttons.moveE?.rect,
      this.profile.buttons.moveW?.rect
    ].filter(Boolean) as FixedSkinRect[];
    const dpadBounds = unionRects(moveRects);
    const attack = this.profile.buttons.attack?.rect;
    const run = this.profile.buttons.run?.rect;

    graphics.fillStyle(0x020504, 0.42);
    graphics.fillRoundedRect(rect.x + 8, rect.y + 8, rect.width - 16, rect.height - 16, 9);
    graphics.lineStyle(1, this.theme.controlFrame, 0.28);
    graphics.strokeRoundedRect(rect.x + 8.5, rect.y + 8.5, rect.width - 17, rect.height - 17, 9);
    graphics.lineStyle(1, 0xffffff, 0.09);
    graphics.lineBetween(rect.x + 16, rect.y + 11, rect.x + rect.width - 16, rect.y + 11);

    if (dpadBounds) {
      const well = outsetRect(dpadBounds, 12);
      graphics.fillStyle(0x020504, 0.72);
      graphics.fillRoundedRect(well.x, well.y, well.width, well.height, 12);
      graphics.lineStyle(2, 0x1c2723, 0.95);
      graphics.strokeRoundedRect(well.x + 0.5, well.y + 0.5, well.width - 1, well.height - 1, 12);
      graphics.lineStyle(1, this.theme.primary, 0.2);
      graphics.strokeRoundedRect(well.x + 5.5, well.y + 5.5, well.width - 11, well.height - 11, 8);

      const cx = well.x + well.width * 0.5;
      const cy = well.y + well.height * 0.5;
      graphics.fillStyle(0x0b1110, 0.96);
      graphics.fillRoundedRect(cx - 25, well.y + 8, 50, well.height - 16, 8);
      graphics.fillRoundedRect(well.x + 8, cy - 25, well.width - 16, 50, 8);
      graphics.lineStyle(1, 0x39443f, 0.6);
      graphics.strokeRoundedRect(cx - 25.5, well.y + 8.5, 50, well.height - 17, 8);
      graphics.strokeRoundedRect(well.x + 8.5, cy - 25.5, well.width - 17, 50, 8);
      this.drawKnurledPlate(cx - 17, cy - 17, 34, 34, this.theme.primary);
      this.drawHardwareScrew(graphics, well.x + 9, well.y + 9, this.theme.controlFrame);
      this.drawHardwareScrew(graphics, well.x + well.width - 9, well.y + well.height - 9, this.theme.controlFrame);
      this.controlDetailsDrawn += 11;
    }

    if (attack && run) {
      const actionBounds = unionRects([attack, run]);
      if (actionBounds) {
        const rack = outsetRect(actionBounds, 9);
        graphics.fillStyle(0x030403, 0.7);
        graphics.fillRoundedRect(rack.x, rack.y, rack.width, rack.height, 10);
        graphics.lineStyle(2, 0x1e2925, 0.95);
        graphics.strokeRoundedRect(rack.x + 0.5, rack.y + 0.5, rack.width - 1, rack.height - 1, 10);
        graphics.lineStyle(1, this.theme.buttonFrame, 0.34);
        graphics.strokeRoundedRect(rack.x + 5.5, rack.y + 5.5, rack.width - 11, rack.height - 11, 7);
        this.drawHardwareScrew(graphics, rack.x + 11, rack.y + 11, this.theme.buttonFrame);
        this.drawHardwareScrew(graphics, rack.x + rack.width - 11, rack.y + 11, this.theme.combat);
        this.drawHardwareScrew(graphics, rack.x + 11, rack.y + rack.height - 11, this.theme.controlFrame);
        this.drawHardwareScrew(graphics, rack.x + rack.width - 11, rack.y + rack.height - 11, this.theme.primary);
        this.controlDetailsDrawn += 8;
      }
    }

    const railY = rect.y + rect.height - 19;
    graphics.fillStyle(0x050807, 0.7);
    graphics.fillRoundedRect(rect.x + 20, railY, rect.width - 40, 9, 4);
    graphics.lineStyle(1, 0x2f3b36, 0.72);
    graphics.strokeRoundedRect(rect.x + 20.5, railY + 0.5, rect.width - 41, 8, 4);
    for (let index = 0; index < 8; index += 1) {
      const lit = index % 3 !== 0;
      graphics.fillStyle(lit ? (index % 2 === 0 ? this.theme.primary : this.theme.secondary) : 0x24302b, lit ? 0.7 : 0.42);
      graphics.fillRoundedRect(rect.x + 154 + index * 10, railY + 3, 6, 3, 2);
    }
    this.controlDetailsDrawn += 10;
  }

  private drawButtonHardwareOverlay(
    buttonId: FixedButtonId,
    button: FixedSkinButton,
    state: FixedSkinButtonState,
    disabled: boolean
  ): void {
    const rect = button.rect;
    const graphics = this.add.graphics();
    const accent = buttonId === 'attack'
      ? this.theme.combat
      : buttonId === 'run'
        ? this.theme.primary
        : buttonId === 'restart'
          ? this.theme.secondary
          : this.theme.controlFrame;
    const alpha = disabled ? 0.22 : state === 'pressed' ? 0.62 : 0.82;

    graphics.lineStyle(1, 0xffffff, alpha * 0.16);
    graphics.lineBetween(rect.x + 8, rect.y + 5, rect.x + rect.width - 8, rect.y + 5);
    graphics.lineStyle(1, 0x010302, alpha * 0.52);
    graphics.lineBetween(rect.x + 8, rect.y + rect.height - 5, rect.x + rect.width - 8, rect.y + rect.height - 5);
    graphics.lineStyle(1, accent, alpha * 0.52);
    graphics.strokeRoundedRect(rect.x + 4.5, rect.y + 4.5, rect.width - 9, rect.height - 9, Math.min(10, rect.height * 0.18));

    if (buttonId === 'attack' || buttonId === 'run' || buttonId === 'restart') {
      graphics.fillStyle(accent, alpha * 0.18);
      graphics.fillRoundedRect(rect.x + 12, rect.y + 12, rect.width - 24, Math.max(5, Math.floor(rect.height * 0.18)), 4);
      graphics.lineStyle(2, accent, alpha * 0.78);
      graphics.lineBetween(rect.x + 16, rect.y + 11, rect.x + rect.width - 18, rect.y + 11);
      graphics.fillStyle(accent, disabled ? 0.22 : 0.95);
      graphics.fillCircle(rect.x + rect.width - 9, rect.y + 8, 4);
      graphics.fillStyle(0xffffff, disabled ? 0.08 : 0.28);
      graphics.fillCircle(rect.x + rect.width - 10, rect.y + 7, 1.5);
      if (button.icon) {
        this.drawButtonIconMark(button.icon, rect.x + 31, rect.y + rect.height * 0.55, 26, accent, disabled);
        this.controlDetailsDrawn += 2;
      }
      this.controlDetailsDrawn += 6;
      return;
    }

    if (isMoveButton(buttonId)) {
      const cx = rect.x + rect.width * 0.5;
      const cy = rect.y + rect.height * 0.5;
      graphics.fillStyle(0x020504, disabled ? 0.28 : 0.45);
      graphics.fillRoundedRect(rect.x + 9, rect.y + 9, rect.width - 18, rect.height - 18, 6);
      graphics.fillStyle(disabled ? 0x5f6963 : this.theme.primary, disabled ? 0.3 : 0.86);
      this.fillDirectionTriangle(graphics, buttonId, cx, cy, Math.max(10, Math.floor(rect.width * 0.26)));
      graphics.lineStyle(1, this.theme.primary, disabled ? 0.12 : 0.3);
      graphics.strokeRoundedRect(rect.x + 9.5, rect.y + 9.5, rect.width - 19, rect.height - 19, 6);
      this.controlDetailsDrawn += 5;
      return;
    }

    if (buttonId === 'log' || buttonId === 'inventory') {
      graphics.lineStyle(1, accent, alpha * 0.72);
      graphics.lineBetween(rect.x + 8, rect.y + rect.height - 7, rect.x + rect.width - 8, rect.y + rect.height - 7);
      graphics.fillStyle(accent, alpha * (state === 'pressed' ? 0.18 : 0.1));
      graphics.fillRoundedRect(rect.x + 8, rect.y + 7, rect.width - 16, rect.height - 15, 4);
      this.drawDrawerToggleMark(buttonId, rect, disabled ? 0x758184 : this.theme.primary, disabled ? 0.36 : 0.92);
      this.controlDetailsDrawn += 4;
    }
  }

  private drawDrawerToggleMark(buttonId: FixedButtonId, rect: FixedSkinRect, tint: number, alpha: number): void {
    const graphics = this.add.graphics();
    const cx = rect.x + rect.width * 0.5;
    const cy = rect.y + rect.height * 0.47;
    const s = Math.min(rect.width, rect.height) / 22;

    graphics.fillStyle(tint, alpha);
    if (buttonId === 'log') {
      for (const yOffset of [-5, 0, 5]) {
        graphics.fillRoundedRect(cx - 9 * s, cy + yOffset * s - 1.4 * s, 3 * s, 2.8 * s, 1.4 * s);
        graphics.fillRoundedRect(cx - 4 * s, cy + yOffset * s - 1.1 * s, 13 * s, 2.2 * s, 1.1 * s);
      }
    } else {
      graphics.fillRoundedRect(cx - 8 * s, cy - 4 * s, 16 * s, 11 * s, 2.5 * s);
      graphics.lineStyle(Math.max(1, 1.2 * s), tint, alpha);
      graphics.strokeRoundedRect(cx - 5 * s, cy - 8 * s, 10 * s, 5 * s, 2.5 * s);
      graphics.fillStyle(0x020504, alpha * 0.5);
      graphics.fillRoundedRect(cx - 5 * s, cy - 1 * s, 10 * s, 2 * s, 1 * s);
    }

    this.canvasIconMarksDrawn += 1;
    this.drawerToggleIconsDrawn += 1;
  }

  private drawMovementLockBadge(): void {
    const state = this.viewState.state;
    if (!state.in_combat || isTerminalState(state)) {
      return;
    }

    const moveButtonIds = ['moveN', 'moveS', 'moveE', 'moveW'] as const;
    const moveRects = moveButtonIds
      .map((buttonId) => this.profile.buttons[buttonId]?.rect)
      .filter(Boolean) as FixedSkinRect[];
    const dpadBounds = unionRects(moveRects);
    if (!dpadBounds || !moveButtonIds.every((buttonId) => this.isButtonDisabled(buttonId))) {
      return;
    }

    const graphics = this.add.graphics();
    const x = Math.round(dpadBounds.x + dpadBounds.width * 0.5 - 31);
    const y = Math.round(dpadBounds.y + dpadBounds.height * 0.5 - 10);
    const width = 62;
    const height = 20;

    graphics.fillStyle(0x050203, 0.9);
    graphics.fillRoundedRect(x, y, width, height, 5);
    graphics.lineStyle(1, this.theme.combat, 0.72);
    graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 5);
    graphics.lineStyle(1, 0xffffff, 0.12);
    graphics.lineBetween(x + 7, y + 4, x + width - 7, y + 4);
    for (let stripe = 0; stripe < 5; stripe += 1) {
      const stripeX = x + 6 + stripe * 11;
      graphics.lineStyle(1, this.theme.combat, 0.24);
      graphics.lineBetween(stripeX, y + height - 4, stripeX + 7, y + 6);
    }

    this.addText('LOCK', x + 4, y + 4, width - 8, {
      fontSize: 10,
      color: this.theme.combatText,
      fontStyle: 'bold',
      align: 'center'
    }, height - 6);
    this.movementLockBadgesDrawn += 1;
    this.controlDetailsDrawn += 6;
  }

  private drawButtonIconMark(icon: string, x: number, y: number, size: number, tint: number, disabled: boolean): void {
    const alpha = disabled ? 0.34 : 0.88;
    if (icon.includes('bolt')) {
      this.drawBoltMark(x, y, size, tint, alpha);
      return;
    }

    if (icon.includes('person-running')) {
      this.drawRunMark(x, y, size, tint, alpha);
      return;
    }

    if (icon.includes('rotate-right')) {
      this.drawRotateMark(x, y, size, tint, alpha);
      return;
    }

    this.addFontAwesomeIcon(icon, '*', x, y, size, disabled ? '#7b837e' : this.theme.titleText)
      .setOrigin(0.5, 0.5)
      .setAlpha(alpha);
  }

  private drawBoltMark(x: number, y: number, size: number, tint: number, alpha: number): void {
    const graphics = this.add.graphics();
    const half = size * 0.5;
    graphics.fillStyle(tint, alpha);
    graphics.beginPath();
    graphics.moveTo(x + half * 0.08, y - half);
    graphics.lineTo(x - half * 0.58, y + half * 0.08);
    graphics.lineTo(x - half * 0.08, y + half * 0.08);
    graphics.lineTo(x - half * 0.34, y + half);
    graphics.lineTo(x + half * 0.62, y - half * 0.2);
    graphics.lineTo(x + half * 0.12, y - half * 0.2);
    graphics.closePath();
    graphics.fillPath();
    graphics.lineStyle(1, 0xffffff, alpha * 0.22);
    graphics.lineBetween(x - half * 0.28, y + half * 0.02, x + half * 0.08, y - half * 0.42);
  }

  private drawRunMark(x: number, y: number, size: number, tint: number, alpha: number): void {
    const graphics = this.add.graphics();
    const scale = size / 26;
    graphics.lineStyle(Math.max(2, 3 * scale), tint, alpha);
    graphics.fillStyle(tint, alpha);
    graphics.fillCircle(x + 2 * scale, y - 10 * scale, 4 * scale);
    graphics.lineBetween(x, y - 5 * scale, x - 4 * scale, y + 3 * scale);
    graphics.lineBetween(x - 1 * scale, y - 3 * scale, x + 8 * scale, y - 1 * scale);
    graphics.lineBetween(x - 3 * scale, y + 2 * scale, x - 11 * scale, y + 8 * scale);
    graphics.lineBetween(x - 3 * scale, y + 2 * scale, x + 7 * scale, y + 10 * scale);
    graphics.lineStyle(1, 0xffffff, alpha * 0.18);
    graphics.lineBetween(x + 5 * scale, y - 2 * scale, x + 10 * scale, y - 3 * scale);
  }

  private drawRotateMark(x: number, y: number, size: number, tint: number, alpha: number): void {
    const graphics = this.add.graphics();
    const radius = size * 0.34;
    graphics.lineStyle(Math.max(2, Math.floor(size * 0.12)), tint, alpha);
    graphics.beginPath();
    graphics.arc(x, y, radius, Math.PI * 0.1, Math.PI * 1.55, false);
    graphics.strokePath();
    graphics.fillStyle(tint, alpha);
    graphics.fillTriangle(
      x + radius * 0.9,
      y - radius * 0.18,
      x + radius * 1.24,
      y - radius * 0.78,
      x + radius * 0.35,
      y - radius * 0.78
    );
  }

  private fillDirectionTriangle(
    graphics: Phaser.GameObjects.Graphics,
    buttonId: FixedButtonId,
    cx: number,
    cy: number,
    size: number
  ): void {
    if (buttonId === 'moveN') {
      graphics.fillTriangle(cx, cy - size, cx - size, cy + size * 0.72, cx + size, cy + size * 0.72);
    } else if (buttonId === 'moveS') {
      graphics.fillTriangle(cx, cy + size, cx - size, cy - size * 0.72, cx + size, cy - size * 0.72);
    } else if (buttonId === 'moveE') {
      graphics.fillTriangle(cx + size, cy, cx - size * 0.72, cy - size, cx - size * 0.72, cy + size);
    } else if (buttonId === 'moveW') {
      graphics.fillTriangle(cx - size, cy, cx + size * 0.72, cy - size, cx + size * 0.72, cy + size);
    }
  }

  private drawKnurledPlate(x: number, y: number, width: number, height: number, tint: number): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x020504, 0.9);
    graphics.fillRoundedRect(x, y, width, height, 5);
    graphics.lineStyle(1, tint, 0.24);
    graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 5);
    graphics.lineStyle(1, tint, 0.12);
    for (let offset = -height; offset < width; offset += 7) {
      graphics.lineBetween(x + offset, y + height, x + offset + height, y);
      graphics.lineBetween(x + offset, y, x + offset + height, y + height);
    }
    this.controlDetailsDrawn += 4;
  }

  private drawHardwareScrew(graphics: Phaser.GameObjects.Graphics, x: number, y: number, tint: number): void {
    graphics.fillStyle(0x020504, 0.88);
    graphics.fillCircle(x, y, 4);
    graphics.fillStyle(tint, 0.42);
    graphics.fillCircle(x, y, 2.7);
    graphics.lineStyle(1, 0xffffff, 0.16);
    graphics.lineBetween(x - 2, y - 1, x + 2, y - 1);
    graphics.lineStyle(1, 0x010302, 0.6);
    graphics.lineBetween(x - 2, y + 1, x + 2, y + 1);
    this.controlDetailsDrawn += 1;
  }

  private drawLogDrawer(): void {
    const rect = this.profile.regions.log;
    const layout = runtimeLayout(this.profile).drawers.log;
    this.drawMaterialPanel(rect, 'lcd', {
      alpha: 0.97,
      fillTint: this.theme.lcdFill,
      frameTint: this.theme.primary,
      scanlines: true
    });
    this.addTextInRect('LOG', layout.header, {
      fontSize: 13,
      color: this.theme.primaryText,
      fontStyle: 'bold'
    });
    const maxRows = Math.max(1, Math.floor((rect.y + rect.height - layout.rowText.y) / layout.rowHeight));
    this.viewState.logs.slice(0, maxRows).forEach((message, index) => {
      const rowLabel = offsetRect(layout.rowLabel, 0, layout.rowHeight * index);
      const rowText = offsetRect(layout.rowText, 0, layout.rowHeight * index);
      this.drawLogRowHardware(rowLabel, rowText, layout.rowHeight, index);
      this.addTextInRect(index === 0 ? 'NEW' : String(index + 1).padStart(2, '0'), rowLabel, {
        fontSize: 10,
        color: index === 0 ? this.theme.primaryText : this.theme.primaryDimText,
        fontStyle: 'bold'
      });
      this.addTextInRect(message, rowText, {
        fontSize: 12,
        color: this.theme.bodyText,
        fontStyle: index === 0 ? 'bold' : ''
      });
      this.logRowsDrawn += 1;
    });
  }

  private drawLogRowHardware(label: FixedSkinRect, text: FixedSkinRect, rowHeight: number, index: number): void {
    const graphics = this.add.graphics();
    const y = text.y - 2;
    const x = label.x - 2;
    const width = text.x + text.width - x + 2;
    const height = Math.max(22, rowHeight - 5);
    const active = index === 0;
    graphics.fillStyle(active ? this.theme.primary : 0x050807, active ? 0.12 : 0.36);
    graphics.fillRoundedRect(x, y, width, height, 4);
    graphics.lineStyle(1, active ? this.theme.primary : this.theme.controlFrame, active ? 0.44 : 0.2);
    graphics.strokeRoundedRect(x + 0.5, y + 0.5, width - 1, height - 1, 4);

    const labelStroke = parseHexColor(active ? this.theme.primaryText : this.theme.primaryDimText, this.theme.primary);
    graphics.fillStyle(active ? this.theme.primary : 0x0b1510, active ? 0.22 : 0.78);
    graphics.fillRoundedRect(label.x - 2, label.y - 3, label.width + 6, label.height + 7, 4);
    graphics.lineStyle(1, labelStroke, active ? 0.55 : 0.24);
    graphics.strokeRoundedRect(label.x - 1.5, label.y - 2.5, label.width + 5, label.height + 6, 4);
    graphics.lineStyle(1, this.theme.primary, active ? 0.18 : 0.08);
    graphics.lineBetween(text.x, y + height - 4, text.x + text.width - 2, y + height - 4);
  }

  private drawInventoryDrawer(): void {
    const rect = this.profile.regions.inventory ?? this.profile.regions.log;
    const layout = runtimeLayout(this.profile).drawers.inventory;
    this.drawMaterialPanel(rect, 'lcd', {
      alpha: 0.97,
      fillTint: this.theme.lcdFill,
      frameTint: this.theme.primary,
      scanlines: true
    });
    this.addTextInRect('INVENTORY', layout.header, {
      fontSize: 13,
      color: this.theme.primaryText,
      fontStyle: 'bold'
    });
    const maxRows = Math.max(1, Math.floor((rect.y + rect.height - layout.rowPanel.y) / layout.rowHeight));
    if (this.viewState.state.inventory.length === 0) {
      this.drawMaterialPanel(layout.emptyBox, 'panel', {
        alpha: 0.9,
        fillTint: this.theme.panelFill,
        frameTint: this.theme.primary,
        scanlines: true
      });
      this.addTextInRect('EMPTY', layout.emptyTitle, {
        fontSize: 18,
        color: this.theme.primaryText,
        fontStyle: 'bold',
        align: 'center'
      });
      this.addTextInRect('Recovered gear and consumables will appear here.', layout.emptyBody, {
        fontSize: 11,
        color: this.theme.mutedText,
        align: 'center'
      });
      return;
    }

    this.viewState.state.inventory.slice(0, maxRows).forEach((item, index) => {
      const action = inventoryRowAction(item, this.viewState);
      const rowPanel = offsetRect(layout.rowPanel, 0, layout.rowHeight * index);
      const rowBadge = offsetRect(layout.rowBadge, 0, layout.rowHeight * index);
      const rowText = offsetRect(layout.rowText, 0, layout.rowHeight * index);
      const rowMeta = offsetRect(layout.rowMeta, 0, layout.rowHeight * index);
      const rowAction = offsetRect(layout.rowAction, 0, layout.rowHeight * index);
      this.drawMaterialPanel(rowPanel, 'panel', {
        alpha: item.is_equipped ? 0.9 : 0.72,
        fillTint: item.is_equipped ? 0x163f20 : 0x101a14,
        frameTint: item.is_equipped ? 0xaaff87 : 0x497055
      });

      const badgeColor = itemTypeColor(item.type);
      const graphics = this.add.graphics();
      graphics.fillStyle(badgeColor, 0.28);
      graphics.fillRoundedRect(rowBadge.x, rowBadge.y, rowBadge.width, rowBadge.height, 4);
      graphics.lineStyle(1, badgeColor, 0.85);
      graphics.strokeRoundedRect(rowBadge.x + 0.5, rowBadge.y + 0.5, rowBadge.width - 1, rowBadge.height - 1, 4);
      this.addTextInRect(itemTypeLabel(item.type), rowBadge, {
        fontSize: 10,
        color: itemTypeTextColor(item.type),
        fontStyle: 'bold',
        align: 'center'
      });

      this.addTextInRect(item.name, rowText, {
        fontSize: 12,
        color: this.theme.bodyText,
        fontStyle: 'bold'
      });
      this.addTextInRect(item.description, rowMeta, {
        fontSize: 9,
        color: this.theme.mutedText
      });
      this.drawInventoryActionChip(rowAction.x, rowAction.y, rowAction.width, rowAction.height, action);
      this.inventoryRowsDrawn += 1;
    });
  }

  private drawInventoryActionChip(x: number, y: number, width: number, height: number, rowAction: InventoryRowAction): void {
    this.inventoryActionChipsDrawn += 1;
    const active = rowAction.state === 'ready';
    const equipped = rowAction.state === 'equipped';
    const border = equipped ? 0x9bff7c : active ? 0x66d7ff : 0x67706a;
    const fill = equipped ? 0x173d19 : active ? 0x102c36 : 0x171c1b;
    this.drawMaterialPanel({ x, y, width, height }, 'button', {
      alpha: rowAction.disabled ? 0.58 : 0.82,
      fillTint: fill,
      frameTint: border
    });
    const graphics = this.add.graphics();
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
    this.drawMaterialPanel(rect, state.game_won ? 'lcd' : 'button', {
      alpha: 0.97,
      fillTint: state.game_won ? 0x17301b : 0x321119,
      frameTint: state.game_won ? this.theme.primary : this.theme.combat,
      scanlines: true
    });
    this.addText(state.game_won ? 'VICTORY' : 'DEFEAT', rect.x + 18, rect.y + 18, rect.width - 36, {
      fontSize: 22,
      color: state.game_won ? this.theme.primaryText : this.theme.combatText,
      fontStyle: 'bold',
      align: 'center'
    });
    this.addText(state.game_won ? 'The city opens its locked doors.' : 'The signal fades under neon rain.', rect.x + 24, rect.y + 62, rect.width - 48, {
      fontSize: 15,
      color: this.theme.titleText,
      fontStyle: 'bold',
      align: 'center'
    }, 64);
    this.addText(`HP ${Math.max(0, state.player_hp)}     XP ${state.player_xp}`, rect.x + 24, rect.y + 134, rect.width - 48, {
      fontSize: 14,
      color: this.theme.bodyText,
      fontStyle: 'bold',
      align: 'center'
    });
  }

  private drawDiagnostics(): void {
    const rect = this.profile.regions.map;
    this.drawMaterialPanel(rect, 'lcd', {
      alpha: 0.86,
      fillTint: this.theme.lcdFill,
      frameTint: this.theme.primary,
      scanlines: true
    });
    this.addText(`${this.profile.label} Phaser renderer`, rect.x + 10, rect.y + 10, rect.width - 20, {
      fontSize: 15,
      color: this.theme.primaryText,
      fontStyle: 'bold'
    });
    this.addText('Canvas-only skin pass: chassis, map, meters, messages, drawers, controls, and terminal states are rendered inside Phaser.', rect.x + 10, rect.y + 36, rect.width - 20, {
      fontSize: 12,
      color: this.theme.bodyText
    }, 76);
  }

  private drawMeter(rect: FixedSkinRect, ratio: number, color: number): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x030504, 0.96);
    graphics.fillRoundedRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 2);
    graphics.lineStyle(1, 0x355241, 0.7);
    graphics.strokeRoundedRect(rect.x - 1.5, rect.y - 1.5, rect.width + 3, rect.height + 3, 2);
    graphics.fillStyle(0x050807, 0.88);
    graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    const fillWidth = Math.max(1, Math.round(rect.width * ratio));
    graphics.fillStyle(scaleRgb(color, 0.72), 0.96);
    graphics.fillRect(rect.x, rect.y, fillWidth, rect.height);
    graphics.fillStyle(color, 0.88);
    graphics.fillRect(rect.x, rect.y, fillWidth, Math.max(1, Math.floor(rect.height * 0.42)));
    graphics.lineStyle(1, 0x0a120d, 0.55);
    for (let tick = 1; tick < 5; tick += 1) {
      const x = rect.x + Math.round((rect.width * tick) / 5);
      graphics.lineBetween(x, rect.y + 1, x, rect.y + rect.height - 1);
    }
    graphics.lineStyle(1, 0xffffff, 0.18);
    graphics.lineBetween(rect.x + 1, rect.y + 1, rect.x + fillWidth - 1, rect.y + 1);
    if (fillWidth > 8) {
      graphics.fillStyle(0xffffff, 0.16);
      graphics.fillRect(rect.x + fillWidth - 3, rect.y + 1, 2, rect.height - 2);
    }
  }

  private drawPanelScrim(rect: FixedSkinRect, color: number, alpha: number): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(color, alpha);
    graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    graphics.lineStyle(1, 0x99ff82, 0.45);
    graphics.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  private drawMaterialPanel(
    rect: FixedSkinRect,
    kind: FixedSkinMaterialKind,
    options: {
      alpha?: number;
      fillTint?: number;
      frameTint?: number;
      scanlines?: boolean;
    } = {}
  ): void {
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const material = this.profile.materials[kind];
    const fillKey = materialKey(this.profile, kind, 'fill');
    const frameKey = materialKey(this.profile, kind, 'frame');
    const alpha = options.alpha ?? 0.86;
    const useSourceColors = material.renderMode === 'source';
    if (this.textures.exists(fillKey)) {
      const fill = this.add.tileSprite(rect.x, rect.y, rect.width, rect.height, fillKey).setOrigin(0, 0);
      fill.setAlpha(useSourceColors ? Math.min(1, alpha + 0.08) : alpha);
      if (!useSourceColors && options.fillTint !== undefined) {
        fill.setTint(options.fillTint);
      }
    } else {
      this.drawPanelScrim(rect, options.fillTint ?? 0x07100b, alpha);
    }

    if (options.scanlines) {
      this.drawScanlines(rect, alpha * 0.35);
    }
    this.drawMaterialMotif(rect, kind, alpha * (useSourceColors ? 0.52 : 0.62));

    if (this.textures.exists(frameKey)) {
      const frame = this.add.nineslice(
        rect.x,
        rect.y,
        frameKey,
        undefined,
        rect.width,
        rect.height,
        material.slice,
        material.slice,
        material.slice,
        material.slice,
        false,
        false
      ).setOrigin(0, 0);
      frame.setAlpha(useSourceColors ? 1 : Math.min(1, alpha + 0.06));
      if (!useSourceColors && options.frameTint !== undefined) {
        frame.setTint(options.frameTint);
      }
    }
    this.drawMaterialChrome(rect, options.frameTint ?? defaultMaterialTint(kind, this.theme), useSourceColors ? alpha * 0.58 : alpha);
    this.materialPanelsDrawn += 1;
    if (useSourceColors) {
      this.sourceMaterialPanelsDrawn += 1;
      this.sourceMaterialKindsDrawn.add(kind);
    }
  }

  private drawMaterialMotif(rect: FixedSkinRect, kind: FixedSkinMaterialKind, alpha: number): void {
    if (rect.width < 70 || rect.height < 32) {
      return;
    }

    const motif = this.skinMotif();
    const graphics = this.add.graphics();
    const primary = this.theme.primary;
    const secondary = this.theme.secondary;
    const inset = 8;
    const left = rect.x + inset;
    const right = rect.x + rect.width - inset;
    const top = rect.y + inset;
    const bottom = rect.y + rect.height - inset;
    const centerX = rect.x + rect.width * 0.5;
    const centerY = rect.y + rect.height * 0.5;
    const motifAlpha = Math.min(kind === 'lcd' ? 0.16 : 0.13, Math.max(0.04, alpha * 0.18));

    if (motif === 'amber') {
      const spacing = Math.max(16, Math.floor(Math.min(rect.width, rect.height) * 0.28));
      for (let x = rect.x - rect.height; x < rect.x + rect.width; x += spacing) {
        graphics.lineStyle(2, primary, motifAlpha);
        graphics.lineBetween(x, bottom, x + rect.height, top);
        graphics.lineStyle(1, secondary, motifAlpha * 0.72);
        graphics.lineBetween(x + 6, bottom, x + rect.height + 6, top);
      }
      graphics.lineStyle(1, secondary, motifAlpha * 1.2);
      graphics.strokeRoundedRect(rect.x + 5.5, rect.y + 5.5, rect.width - 11, rect.height - 11, 4);
      this.chromeDetailsDrawn += 5;
      return;
    }

    if (motif === 'gold') {
      const radius = Math.max(18, Math.min(rect.width, rect.height) * 0.36);
      graphics.lineStyle(1, secondary, motifAlpha * 1.1);
      graphics.strokeCircle(centerX, centerY, radius);
      graphics.lineStyle(1, primary, motifAlpha * 0.72);
      graphics.strokeCircle(centerX, centerY, radius * 0.62);
      graphics.lineStyle(1, secondary, motifAlpha * 0.9);
      graphics.lineBetween(left, top + 7, left + 32, top + 7);
      graphics.lineBetween(left + 32, top + 7, left + 44, top + 18);
      graphics.lineBetween(right - 44, bottom - 18, right - 32, bottom - 7);
      graphics.lineBetween(right - 32, bottom - 7, right, bottom - 7);
      this.chromeDetailsDrawn += 6;
      return;
    }

    if (motif === 'signal') {
      const rows = Math.max(2, Math.min(5, Math.floor(rect.height / 24)));
      for (let row = 0; row < rows; row += 1) {
        const y = top + 8 + row * Math.max(16, (bottom - top - 16) / Math.max(1, rows - 1));
        let previousX = left;
        let previousY = y;
        const segments = 9;
        for (let step = 1; step <= segments; step += 1) {
          const x = left + ((right - left) * step) / segments;
          const wave = Math.sin((step + row) * Math.PI * 0.7) * Math.min(9, rect.height * 0.08);
          const nextY = y + wave;
          graphics.lineStyle(1, step % 2 === 0 ? primary : secondary, motifAlpha * (step % 2 === 0 ? 1 : 0.72));
          graphics.lineBetween(previousX, previousY, x, nextY);
          previousX = x;
          previousY = nextY;
        }
      }
      graphics.lineStyle(1, secondary, motifAlpha * 0.8);
      graphics.strokeCircle(right - 26, top + 24, Math.min(22, rect.height * 0.22));
      this.chromeDetailsDrawn += 7;
      return;
    }

    if (motif === 'terminal') {
      graphics.lineStyle(1, primary, motifAlpha * 0.72);
      for (let y = top; y <= bottom; y += 10) {
        graphics.lineBetween(left, y, right, y);
      }
      graphics.lineStyle(1, secondary, motifAlpha * 0.45);
      for (let x = left; x <= right; x += 18) {
        graphics.lineBetween(x, top, x, bottom);
      }
      graphics.fillStyle(primary, motifAlpha * 1.3);
      graphics.fillRect(left, bottom - 2, Math.min(rect.width * 0.42, 128), 2);
      this.chromeDetailsDrawn += 7;
      return;
    }

    graphics.lineStyle(1, primary, motifAlpha * 0.55);
    graphics.lineBetween(left, top, left + 26, top);
    graphics.lineBetween(left, top, left, top + 18);
    graphics.lineBetween(right - 26, bottom, right, bottom);
    graphics.lineBetween(right, bottom - 18, right, bottom);
    this.chromeDetailsDrawn += 2;
  }

  private skinMotif(): SkinMotif {
    const meta = this.profile.meta;
    const tokens = new Set([
      this.profile.id,
      ...(meta?.tags ?? []),
      ...(meta?.mood ?? []),
      ...(meta?.palette ?? [])
    ]);

    if (tokens.has('terminal') || tokens.has('green-screen') || tokens.has('emerald')) {
      return 'terminal';
    }
    if (tokens.has('amber') || tokens.has('industrial') || tokens.has('relay')) {
      return 'amber';
    }
    if (tokens.has('gold')) {
      return 'gold';
    }
    if (tokens.has('signal') || tokens.has('noir') || tokens.has('rain') || tokens.has('coral') || tokens.has('cyan')) {
      return 'signal';
    }
    return 'reference';
  }

  private drawMaterialChrome(rect: FixedSkinRect, tint: number, alpha: number): void {
    if (rect.width < 72 || rect.height < 28) {
      return;
    }

    const graphics = this.add.graphics();
    const radius = Math.min(8, Math.max(3, Math.floor(Math.min(rect.width, rect.height) * 0.08)));
    graphics.lineStyle(1, tint, Math.min(0.28, alpha * 0.22));
    graphics.strokeRoundedRect(rect.x + 2.5, rect.y + 2.5, rect.width - 5, rect.height - 5, radius);
    graphics.lineStyle(1, 0xffffff, Math.min(0.2, alpha * 0.12));
    graphics.lineBetween(rect.x + 8, rect.y + 5, rect.x + rect.width - 8, rect.y + 5);
    graphics.lineBetween(rect.x + 5, rect.y + 8, rect.x + 5, rect.y + rect.height - 8);
    graphics.lineStyle(1, 0x020504, Math.min(0.42, alpha * 0.34));
    graphics.lineBetween(rect.x + 8, rect.y + rect.height - 5, rect.x + rect.width - 8, rect.y + rect.height - 5);
    graphics.lineBetween(rect.x + rect.width - 5, rect.y + 8, rect.x + rect.width - 5, rect.y + rect.height - 8);

    if (rect.width >= 112 && rect.height >= 42) {
      const screwRadius = Math.max(2, Math.min(4, Math.floor(Math.min(rect.width, rect.height) * 0.06)));
      const inset = Math.max(8, screwRadius + 5);
      const points = [
        [rect.x + inset, rect.y + inset],
        [rect.x + rect.width - inset, rect.y + inset],
        [rect.x + inset, rect.y + rect.height - inset],
        [rect.x + rect.width - inset, rect.y + rect.height - inset]
      ] as const;
      for (const [x, y] of points) {
        graphics.fillStyle(0x020504, Math.min(0.68, alpha * 0.62));
        graphics.fillCircle(x, y, screwRadius + 1);
        graphics.fillStyle(tint, Math.min(0.44, alpha * 0.34));
        graphics.fillCircle(x, y, screwRadius);
        graphics.lineStyle(1, 0xffffff, Math.min(0.18, alpha * 0.12));
        graphics.lineBetween(x - screwRadius + 1, y - 1, x + screwRadius - 1, y - 1);
      }
    }

    this.chromeDetailsDrawn += 1;
  }

  private drawScanlines(rect: FixedSkinRect, alpha: number): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, this.theme.primary, Math.min(0.28, Math.max(0.04, alpha)));
    for (let y = rect.y + 4; y < rect.y + rect.height - 3; y += 5) {
      graphics.lineBetween(rect.x + 4, y, rect.x + rect.width - 4, y);
    }
  }

  private drawImageIfLoaded(key: string, rect: FixedSkinRect): void {
    if (this.textures.exists(key)) {
      this.add.image(rect.x, rect.y, key).setOrigin(0, 0);
    }
  }

  private drawSemanticIcon(
    iconClass: string | undefined,
    fallback: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1
  ): void {
    const iconName = fontAwesomeIconName(iconClass);
    const tint = parseHexColor(color, 0xffffff);
    const graphics = this.add.graphics();
    if (iconName && this.drawCanvasIconMark(graphics, iconName, x, y, size, tint, alpha)) {
      this.canvasIconMarksDrawn += 1;
      return;
    }

    graphics.destroy();
    this.addFontAwesomeIcon(iconClass, fallback, x, y, size, color)
      .setOrigin(0.5, 0.5)
      .setAlpha(alpha);
  }

  private drawCanvasIconMark(
    graphics: Phaser.GameObjects.Graphics,
    iconName: string,
    x: number,
    y: number,
    size: number,
    tint: number,
    alpha: number
  ): boolean {
    if (['building', 'city', 'hotel', 'industry'].includes(iconName)) {
      this.drawBuildingIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (['building-columns', 'place-of-worship', 'torii-gate'].includes(iconName)) {
      this.drawMonumentIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'store') {
      this.drawStoreIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'seedling' || iconName === 'tree') {
      this.drawPlantIcon(graphics, x, y, size, tint, alpha, iconName === 'tree');
      return true;
    }

    if (iconName === 'subway' || iconName === 'train-subway') {
      this.drawTransitIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (['tv', 'laptop-code', 'microchip'].includes(iconName)) {
      this.drawTechIcon(graphics, x, y, size, tint, alpha, iconName);
      return true;
    }

    if (iconName === 'list') {
      this.drawListIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'satellite-dish' || iconName === 'tower-broadcast') {
      this.drawSignalIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'cloud' || iconName === 'cloud-rain') {
      this.drawCloudIcon(graphics, x, y, size, tint, alpha, iconName === 'cloud-rain');
      return true;
    }

    if (iconName === 'water') {
      this.drawWaterIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'fish') {
      this.drawFishIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (iconName === 'bowl-food') {
      this.drawBowlIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    if (['box', 'briefcase', 'briefcase-medical', 'coins'].includes(iconName)) {
      this.drawItemIcon(graphics, x, y, size, tint, alpha, iconName);
      return true;
    }

    if (['mask', 'user-secret', 'user-tie', 'skull', 'fist-raised', 'hand-fist'].includes(iconName)) {
      this.drawPersonIcon(graphics, x, y, size, tint, alpha, iconName);
      return true;
    }

    if (iconName === 'car' || iconName === 'helicopter') {
      this.drawVehicleIcon(graphics, x, y, size, tint, alpha, iconName);
      return true;
    }

    if (iconName === 'question' || iconName === 'ban') {
      this.drawQuestionIcon(graphics, x, y, size, tint, alpha);
      return true;
    }

    return false;
  }

  private drawBuildingIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillRect(x - 8 * s, y - 6 * s, 5 * s, 12 * s);
    graphics.fillRect(x - 2 * s, y - 9 * s, 5 * s, 15 * s);
    graphics.fillRect(x + 4 * s, y - 4 * s, 5 * s, 10 * s);
    graphics.fillStyle(0x020504, alpha * 0.42);
    for (const offset of [-6, 0, 6]) {
      graphics.fillRect(x + offset * s, y - 2 * s, 1.5 * s, 2 * s);
      graphics.fillRect(x + offset * s, y + 2 * s, 1.5 * s, 2 * s);
    }
    graphics.lineStyle(Math.max(1, 1.2 * s), tint, alpha * 0.55);
    graphics.lineBetween(x - 9 * s, y + 7 * s, x + 10 * s, y + 7 * s);
  }

  private drawMonumentIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillTriangle(x, y - 9 * s, x - 9 * s, y - 3 * s, x + 9 * s, y - 3 * s);
    graphics.fillRect(x - 8 * s, y - 1 * s, 16 * s, 2 * s);
    for (const offset of [-5, 0, 5]) {
      graphics.fillRect(x + offset * s - 1 * s, y + 1 * s, 2 * s, 7 * s);
    }
    graphics.fillRect(x - 8 * s, y + 8 * s, 16 * s, 2 * s);
  }

  private drawStoreIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillRect(x - 8 * s, y - 3 * s, 16 * s, 10 * s);
    graphics.fillTriangle(x - 9 * s, y - 4 * s, x + 9 * s, y - 4 * s, x, y - 9 * s);
    graphics.fillStyle(0x020504, alpha * 0.45);
    graphics.fillRect(x - 5 * s, y + 1 * s, 3 * s, 5 * s);
    graphics.fillRect(x + 2 * s, y + 1 * s, 4 * s, 3 * s);
  }

  private drawPlantIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, tree: boolean): void {
    const s = size / 20;
    graphics.lineStyle(Math.max(1, 1.6 * s), tint, alpha);
    graphics.lineBetween(x, y + 8 * s, x, y - (tree ? 2 : 5) * s);
    graphics.fillStyle(tint, alpha);
    graphics.fillEllipse(x - 4 * s, y - 2 * s, 8 * s, 5 * s);
    graphics.fillEllipse(x + 4 * s, y - 5 * s, 8 * s, 5 * s);
    if (tree) {
      graphics.fillCircle(x, y - 7 * s, 6 * s);
    }
  }

  private drawTransitIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillRoundedRect(x - 8 * s, y - 8 * s, 16 * s, 14 * s, 3 * s);
    graphics.fillStyle(0x020504, alpha * 0.46);
    graphics.fillRect(x - 5 * s, y - 5 * s, 4 * s, 4 * s);
    graphics.fillRect(x + 1 * s, y - 5 * s, 4 * s, 4 * s);
    graphics.fillStyle(tint, alpha);
    graphics.fillCircle(x - 4 * s, y + 7 * s, 2 * s);
    graphics.fillCircle(x + 4 * s, y + 7 * s, 2 * s);
  }

  private drawTechIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, iconName: string): void {
    const s = size / 20;
    graphics.lineStyle(Math.max(1, 1.4 * s), tint, alpha);
    graphics.strokeRoundedRect(x - 8 * s, y - 6 * s, 16 * s, 11 * s, 2 * s);
    if (iconName === 'microchip') {
      for (let offset = -7; offset <= 7; offset += 4) {
        graphics.lineBetween(x + offset * s, y - 9 * s, x + offset * s, y - 6 * s);
        graphics.lineBetween(x + offset * s, y + 5 * s, x + offset * s, y + 8 * s);
      }
      graphics.fillStyle(tint, alpha * 0.35);
      graphics.fillRect(x - 3 * s, y - 2 * s, 6 * s, 4 * s);
      return;
    }
    graphics.lineBetween(x - 3 * s, y + 7 * s, x + 3 * s, y + 7 * s);
    graphics.lineBetween(x, y + 5 * s, x, y + 7 * s);
  }

  private drawListIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    for (const yOffset of [-6, 0, 6]) {
      graphics.fillRoundedRect(x - 8 * s, y + yOffset * s - 1.5 * s, 3 * s, 3 * s, 1.5 * s);
      graphics.fillRoundedRect(x - 3 * s, y + yOffset * s - 1.2 * s, 12 * s, 2.4 * s, 1.2 * s);
    }
  }

  private drawSignalIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.lineStyle(Math.max(1, 1.4 * s), tint, alpha);
    graphics.lineBetween(x, y + 8 * s, x, y - 7 * s);
    graphics.lineBetween(x - 5 * s, y + 8 * s, x + 5 * s, y + 8 * s);
    for (const radius of [4, 7]) {
      graphics.beginPath();
      graphics.arc(x, y - 4 * s, radius * s, -0.95, 0.95);
      graphics.strokePath();
    }
  }

  private drawCloudIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, rain: boolean): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillCircle(x - 5 * s, y - 2 * s, 4 * s);
    graphics.fillCircle(x, y - 5 * s, 5 * s);
    graphics.fillCircle(x + 5 * s, y - 2 * s, 4 * s);
    graphics.fillRect(x - 8 * s, y - 2 * s, 16 * s, 5 * s);
    if (rain) {
      graphics.lineStyle(Math.max(1, 1.2 * s), tint, alpha);
      graphics.lineBetween(x - 5 * s, y + 5 * s, x - 7 * s, y + 9 * s);
      graphics.lineBetween(x, y + 5 * s, x - 2 * s, y + 9 * s);
      graphics.lineBetween(x + 5 * s, y + 5 * s, x + 3 * s, y + 9 * s);
    }
  }

  private drawWaterIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.lineStyle(Math.max(1, 1.5 * s), tint, alpha);
    for (const offset of [-4, 2, 8]) {
      graphics.beginPath();
      graphics.moveTo(x - 8 * s, y + offset * s);
      graphics.lineTo(x - 3 * s, y + (offset - 2) * s);
      graphics.lineTo(x + 2 * s, y + offset * s);
      graphics.lineTo(x + 7 * s, y + (offset - 2) * s);
      graphics.strokePath();
    }
  }

  private drawFishIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillEllipse(x - 1 * s, y, 13 * s, 8 * s);
    graphics.fillTriangle(x + 6 * s, y, x + 11 * s, y - 5 * s, x + 11 * s, y + 5 * s);
    graphics.fillStyle(0x020504, alpha * 0.55);
    graphics.fillCircle(x - 5 * s, y - 1 * s, 1 * s);
  }

  private drawBowlIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    graphics.fillRoundedRect(x - 8 * s, y - 1 * s, 16 * s, 8 * s, 5 * s);
    graphics.lineStyle(Math.max(1, 1.2 * s), tint, alpha);
    graphics.lineBetween(x - 6 * s, y - 4 * s, x - 2 * s, y - 8 * s);
    graphics.lineBetween(x, y - 4 * s, x + 4 * s, y - 8 * s);
  }

  private drawItemIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, iconName: string): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    if (iconName === 'coins') {
      for (const offset of [-4, 0, 4]) {
        graphics.fillEllipse(x + offset * s, y + (offset === 0 ? -2 : 2) * s, 8 * s, 4 * s);
      }
      return;
    }
    graphics.fillRoundedRect(x - 7 * s, y - 6 * s, 14 * s, 12 * s, 2 * s);
    graphics.fillStyle(0x020504, alpha * 0.45);
    if (iconName === 'briefcase-medical') {
      graphics.fillRect(x - 1.3 * s, y - 4 * s, 2.6 * s, 8 * s);
      graphics.fillRect(x - 4 * s, y - 1.3 * s, 8 * s, 2.6 * s);
    } else {
      graphics.strokeRect(x - 4 * s, y - 2 * s, 8 * s, 5 * s);
    }
  }

  private drawPersonIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, iconName: string): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    if (iconName === 'skull') {
      graphics.fillCircle(x, y - 3 * s, 7 * s);
      graphics.fillRect(x - 5 * s, y + 2 * s, 10 * s, 6 * s);
      graphics.fillStyle(0x020504, alpha * 0.55);
      graphics.fillCircle(x - 3 * s, y - 3 * s, 1.5 * s);
      graphics.fillCircle(x + 3 * s, y - 3 * s, 1.5 * s);
      return;
    }
    if (iconName === 'fist-raised' || iconName === 'hand-fist') {
      graphics.fillRoundedRect(x - 5 * s, y - 7 * s, 10 * s, 10 * s, 3 * s);
      graphics.fillRect(x - 3 * s, y + 2 * s, 6 * s, 7 * s);
      return;
    }
    graphics.fillCircle(x, y - 5 * s, 4 * s);
    graphics.fillRoundedRect(x - 6 * s, y, 12 * s, 9 * s, 4 * s);
    if (iconName === 'user-secret' || iconName === 'mask') {
      graphics.fillTriangle(x - 8 * s, y - 8 * s, x + 8 * s, y - 8 * s, x, y - 12 * s);
      graphics.fillStyle(0x020504, alpha * 0.5);
      graphics.fillRect(x - 5 * s, y - 5 * s, 10 * s, 2 * s);
    }
  }

  private drawVehicleIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number, iconName: string): void {
    const s = size / 20;
    graphics.fillStyle(tint, alpha);
    if (iconName === 'helicopter') {
      graphics.fillRoundedRect(x - 6 * s, y - 3 * s, 12 * s, 6 * s, 3 * s);
      graphics.fillRect(x + 4 * s, y - 1 * s, 7 * s, 2 * s);
      graphics.lineStyle(Math.max(1, 1.2 * s), tint, alpha);
      graphics.lineBetween(x - 10 * s, y - 7 * s, x + 10 * s, y - 7 * s);
      return;
    }
    graphics.fillRoundedRect(x - 8 * s, y - 2 * s, 16 * s, 7 * s, 3 * s);
    graphics.fillRect(x - 4 * s, y - 6 * s, 8 * s, 5 * s);
    graphics.fillStyle(0x020504, alpha * 0.55);
    graphics.fillCircle(x - 5 * s, y + 5 * s, 2 * s);
    graphics.fillCircle(x + 5 * s, y + 5 * s, 2 * s);
  }

  private drawQuestionIcon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, tint: number, alpha: number): void {
    const s = size / 20;
    graphics.lineStyle(Math.max(1, 2 * s), tint, alpha);
    graphics.beginPath();
    graphics.arc(x, y - 4 * s, 5 * s, Math.PI * 1.08, Math.PI * 1.92);
    graphics.strokePath();
    graphics.lineBetween(x + 3 * s, y - 1 * s, x, y + 3 * s);
    graphics.fillStyle(tint, alpha);
    graphics.fillCircle(x, y + 8 * s, Math.max(1, 1.5 * s));
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
      fontStyle: glyph ? 'normal' : 'bold',
      align: 'center'
    });
  }

  private addText(
    text: string,
    x: number,
    y: number,
    width: number,
    style: PhaserTextStyle,
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
    this.fitTextToSlot(object, text, width, maxHeight, style);
    if (style.align === 'center') {
      object.setFixedSize(width, maxHeight ?? 0);
    }
    if (style.align === 'right') {
      object.setOrigin(0, 0);
      object.setFixedSize(width, maxHeight ?? 0);
    }
    return object;
  }

  private fitTextToSlot(
    object: Phaser.GameObjects.Text,
    text: string,
    width: number,
    maxHeight: number | undefined,
    style: PhaserTextStyle
  ): void {
    if (!Number.isFinite(width) || width <= 0) {
      return;
    }

    this.textSlotsDrawn += 1;
    const minFontSize = Math.min(style.fontSize, style.minFontSize ?? 8);
    let fontSize = style.fontSize;
    let shrunk = false;

    while (this.textOverflowsSlot(object, width, maxHeight) && fontSize > minFontSize) {
      fontSize -= 1;
      object.setFontSize(fontSize);
      shrunk = true;
    }

    if (shrunk) {
      this.textSlotsShrunk += 1;
    }

    if (this.textOverflowsSlot(object, width, maxHeight) && text.length > 3) {
      const fitted = this.ellipsizeTextForSlot(object, text, width, maxHeight);
      if (fitted) {
        this.textSlotsEllipsized += 1;
      }
    }

    if (this.textOverflowsSlot(object, width, maxHeight)) {
      this.textSlotOverflows += 1;
    }
  }

  private ellipsizeTextForSlot(
    object: Phaser.GameObjects.Text,
    text: string,
    width: number,
    maxHeight: number | undefined
  ): boolean {
    const trimmed = text.trim();
    const suffix = '...';
    if (trimmed.length <= suffix.length) {
      return false;
    }

    let low = 1;
    let high = trimmed.length - suffix.length;
    let best = '';

    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      const candidate = `${trimmed.slice(0, midpoint).trimEnd()}${suffix}`;
      object.setText(candidate);
      if (this.textOverflowsSlot(object, width, maxHeight)) {
        high = midpoint - 1;
      } else {
        best = candidate;
        low = midpoint + 1;
      }
    }

    if (best) {
      object.setText(best);
      return true;
    }

    object.setText(suffix);
    return !this.textOverflowsSlot(object, width, maxHeight);
  }

  private textOverflowsSlot(object: Phaser.GameObjects.Text, width: number, maxHeight: number | undefined): boolean {
    const tolerance = 1.25;
    const tooWide = object.width > width + tolerance;
    const tooTall = maxHeight !== undefined && object.height > maxHeight + tolerance;
    return tooWide || tooTall;
  }

  private addTextInRect(
    text: string,
    rect: FixedSkinRect,
    style: PhaserTextStyle
  ): Phaser.GameObjects.Text {
    return this.addText(text, rect.x, rect.y, rect.width, style, rect.height);
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
    diagnostics: 'Diagnostics: this renderer is the canvas skin target for fixed skins.',
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

function materialKey(profile: FixedSkinProfile, kind: FixedSkinMaterialKind, part: 'fill' | 'frame'): string {
  return assetKey(profile, `material:${kind}:${part}`);
}

function runtimeLayout(profile: FixedSkinProfile): FixedSkinRuntimeLayout {
  return profile.runtime ?? fallbackRuntimeLayout(profile);
}

function fallbackRuntimeLayout(profile: FixedSkinProfile): FixedSkinRuntimeLayout {
  const title = profile.regions.title;
  const latest = profile.regions.latest;
  const player = profile.regions.playerHp;
  const stats = profile.regions.playerStats;
  const combat = profile.regions.combat;
  const log = profile.regions.log;
  const inventory = profile.regions.inventory ?? profile.regions.log;
  const iconSize = profile.kind === 'mobileCompact' ? 17 : 20;
  const rowHeight = profile.kind === 'mobileCompact' ? 40 : 46;
  const statTop = stats.y + Math.max(0, Math.floor((stats.height - 16) / 2));

  return {
    title: {
      ...(profile.kind === 'mobileCompact' ? {} : { brand: { x: title.x, y: title.y - 16, width: title.width, height: 12 } }),
      playerIcon: { x: title.x + 2, y: title.y + Math.max(0, Math.floor((title.height - iconSize) / 2)), width: iconSize, height: iconSize },
      gameTitle: { x: title.x + iconSize + 12, y: title.y, width: Math.max(1, title.width - iconSize - 12), height: title.height }
    },
    latest: {
      label: { x: latest.x + 8, y: latest.y + 8, width: latest.width - 16, height: 12 },
      message: { x: latest.x + 8, y: latest.y + 24, width: latest.width - 16, height: Math.max(12, latest.height - 28) }
    },
    player: {
      hpLabel: { x: player.x + 8, y: player.y + 7, width: 36, height: 18 },
      hpValue: { x: player.x + player.width - 96, y: player.y + 7, width: 88, height: 18 },
      stats: [
        { id: 'attack', label: 'ATK', labelRect: { x: stats.x, y: statTop, width: 28, height: 16 }, valueRect: { x: stats.x + 30, y: statTop, width: 34, height: 16 } },
        { id: 'defense', label: 'DEF', labelRect: { x: stats.x + 74, y: statTop, width: 30, height: 16 }, valueRect: { x: stats.x + 108, y: statTop, width: 34, height: 16 } },
        { id: 'xp', label: 'XP', labelRect: { x: stats.x + 152, y: statTop, width: 24, height: 16 }, valueRect: { x: stats.x + 180, y: statTop, width: 38, height: 16 } },
        { id: 'tile', label: 'TILE', labelRect: { x: stats.x + 224, y: statTop, width: 32, height: 16 }, valueRect: { x: stats.x + 260, y: statTop, width: Math.max(44, stats.width - 260), height: 16 } }
      ]
    },
    combat: {
      mode: { x: combat.x + 8, y: combat.y + 6, width: 72, height: 14 },
      exploreText: { x: combat.x + 8, y: combat.y + 24, width: combat.width - 16, height: Math.max(16, combat.height - 28) },
      enemyIcon: { x: combat.x + 6, y: combat.y + 24, width: 16, height: 16 },
      enemyName: { x: combat.x + 30, y: combat.y + 24, width: Math.max(60, combat.width - 134), height: Math.max(16, combat.height - 28) },
      enemyHpValue: { x: combat.x + combat.width - 86, y: combat.y + 24, width: 78, height: Math.max(16, combat.height - 28) }
    },
    drawers: {
      log: {
        header: { x: log.x + 10, y: log.y + 10, width: log.width - 20, height: 16 },
        rowLabel: { x: log.x + 10, y: log.y + 36, width: 34, height: 14 },
        rowText: { x: log.x + 50, y: log.y + 34, width: log.width - 66, height: rowHeight - 4 },
        rowHeight
      },
      inventory: {
        header: { x: inventory.x + 10, y: inventory.y + 10, width: inventory.width - 20, height: 16 },
        rowPanel: { x: inventory.x + 8, y: inventory.y + 31, width: inventory.width - 16, height: rowHeight - 6 },
        rowBadge: { x: inventory.x + 12, y: inventory.y + 38, width: 38, height: 22 },
        rowText: { x: inventory.x + 58, y: inventory.y + 35, width: inventory.width - 138, height: rowHeight - 20 },
        rowMeta: { x: inventory.x + 58, y: inventory.y + 53, width: inventory.width - 138, height: Math.max(12, rowHeight - 24) },
        rowAction: { x: inventory.x + inventory.width - 72, y: inventory.y + 39, width: 54, height: 24 },
        rowHeight,
        emptyBox: { x: inventory.x + 18, y: inventory.y + 46, width: inventory.width - 36, height: Math.min(74, inventory.height - 66) },
        emptyTitle: { x: inventory.x + 30, y: inventory.y + 58, width: inventory.width - 60, height: 22 },
        emptyBody: { x: inventory.x + 34, y: inventory.y + 88, width: inventory.width - 68, height: 28 }
      }
    }
  };
}

function fixedSkinRenderTheme(profile: FixedSkinProfile): FixedSkinRenderTheme {
  if (profile.renderTheme) {
    return profile.renderTheme;
  }

  return {
    primary: 0x8dff70,
    primaryText: '#aaff8d',
    primaryDimText: '#7ba58a',
    secondary: 0xffa441,
    secondaryText: '#ffc46d',
    lcdFill: 0x0d2615,
    panelFill: 0x122019,
    controlFrame: 0x5b8d66,
    buttonFrame: 0xff7188,
    titleText: '#f6fff3',
    bodyText: '#f3fff1',
    mutedText: '#b8c7bc',
    combat: 0xff7188,
    combatText: '#ff8fa0'
  };
}

function defaultMaterialTint(kind: FixedSkinMaterialKind, theme: FixedSkinRenderTheme): number {
  if (kind === 'button') {
    return theme.buttonFrame;
  }
  if (kind === 'lcd') {
    return theme.primary;
  }
  return theme.primary;
}

function statValue(state: GameState, slotId: FixedSkinStatSlotId): string {
  if (slotId === 'attack') {
    return String(state.player_attack);
  }
  if (slotId === 'defense') {
    return String(state.player_defense);
  }
  if (slotId === 'xp') {
    return String(state.player_xp);
  }
  return currentTileName(state);
}

function statAccentColor(slotId: FixedSkinStatSlotId): string {
  if (slotId === 'attack') {
    return '#ff6682';
  }
  if (slotId === 'defense') {
    return '#72d6ff';
  }
  if (slotId === 'xp') {
    return '#e776ff';
  }
  return '#ffd15a';
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

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
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
  document.body.dataset.phaserPlayerX = String(state.player_pos[0]);
  document.body.dataset.phaserPlayerY = String(state.player_pos[1]);
  document.body.dataset.phaserInCombat = state.in_combat ? '1' : '0';
  document.body.dataset.phaserTerminalState = state.game_won ? 'victory' : isTerminalState(state) ? 'defeat' : 'active';
}

function isTerminalState(state: GameState): boolean {
  return state.game_over || state.game_won || state.player_hp <= 0;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function fontAwesomeGlyph(iconClass: string | undefined): string | null {
  const iconName = fontAwesomeIconName(iconClass);
  return iconName ? fontAwesomeGlyphs[iconName] ?? null : null;
}

function fontAwesomeIconName(iconClass: string | undefined): string | null {
  const classes = iconClass?.trim().split(/\s+/) ?? [];
  for (const className of classes) {
    const normalized = className.toLowerCase();
    if (!normalized.startsWith('fa-') || fontAwesomeStyleClasses.has(normalized)) {
      continue;
    }
    return normalized.slice(3);
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

function insetRect(rect: FixedSkinRect, inset: number): FixedSkinRect {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(1, rect.width - inset * 2),
    height: Math.max(1, rect.height - inset * 2)
  };
}

function outsetRect(rect: FixedSkinRect, outset: number): FixedSkinRect {
  return {
    x: rect.x - outset,
    y: rect.y - outset,
    width: rect.width + outset * 2,
    height: rect.height + outset * 2
  };
}

function offsetRect(rect: FixedSkinRect, dx: number, dy: number): FixedSkinRect {
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height
  };
}

function unionRects(rects: FixedSkinRect[]): FixedSkinRect | null {
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function isMoveButton(buttonId: FixedButtonId): boolean {
  return buttonId === 'moveN' || buttonId === 'moveS' || buttonId === 'moveE' || buttonId === 'moveW';
}

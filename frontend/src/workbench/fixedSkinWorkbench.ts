import Phaser from 'phaser';
import { RogueScene } from '../game/RogueScene';
import type { Direction, GameAction, GameState, Item } from '../protocol/types';
import type { FixedSkinButton, FixedSkinButtonState, FixedSkinProfile, FixedSkinRect, GameSkin } from '../skins/types';
import { normalizeFontAwesomeClass } from '../ui/icons';
import { applyWorkbenchAction, createWorkbenchState, WORKBENCH_LOGS } from './skinWorkbench';

type FixedButtonId = keyof FixedSkinProfile['buttons'];
type FixedWorkbenchScenario = 'combat' | 'movement' | 'diagnostics' | 'status' | 'defeat' | 'victory' | 'escaped-copy';
type DrawerState = {
  logOpen: boolean;
  inventoryOpen: boolean;
};

const buttonActions: Partial<Record<FixedButtonId, GameAction>> = {
  attack: { action: 'attack' },
  run: { action: 'run' },
  restart: { action: 'restart' },
  moveN: { action: 'move', direction: 'n' },
  moveS: { action: 'move', direction: 's' },
  moveE: { action: 'move', direction: 'e' },
  moveW: { action: 'move', direction: 'w' }
};

const messageFreshClass = 'message-fresh';

const domIds: Record<FixedButtonId, string> = {
  attack: 'attack',
  run: 'run',
  log: 'fixed-log-toggle',
  inventory: 'fixed-inventory-toggle',
  moveN: 'move-n',
  moveS: 'move-s',
  moveE: 'move-e',
  moveW: 'move-w',
  restart: 'restart'
};

export interface FixedSkinRuntimeUi {
  scene: RogueScene;
  render(state: GameState): void;
  setActionPending(pending: boolean): void;
  setConnectionStatus(status: string): void;
  addLog(message: string): void;
  destroy(): void;
}

export function isFixedSkinWorkbench(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('workbench') === 'fixed-skin' || params.get('bench') === 'fixed-skin';
}

export function isFixedSkinRuntime(location: Location = window.location, viewportWidth = window.innerWidth): boolean {
  const params = new URL(location.href).searchParams;
  const requestedUi = params.get('ui')?.toLowerCase();
  if (requestedUi === 'classic' || requestedUi === 'responsive') {
    return false;
  }

  if (requestedUi === 'fixed-skin' || params.get('fixed_skin') === '1') {
    return true;
  }

  return viewportWidth <= 860;
}

export function createFixedSkinRuntime(skin: GameSkin, onAction: (action: GameAction) => void): FixedSkinRuntimeUi {
  const selectedProfile = selectProfile(skin);
  if (!selectedProfile) {
    throw new Error(`Skin ${skin.id} does not define fixed profiles`);
  }
  const profile = selectedProfile;

  document.body.classList.add('fixed-runtime-mode', 'fixed-workbench-mode');
  document.body.dataset.ui = 'fixed-skin';
  document.body.dataset.fixedProfile = profile.id;

  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app');
  }

  let currentState: GameState | null = null;
  let logs: string[] = [];
  let logOpen = false;
  let inventoryOpen = false;
  let actionPending = false;
  let connectionStatus = 'offline';
  const stage = buildStage(app, profile, 'combat');
  const scene = new RogueScene(skin.map);
  const game = createFixedGame(scene, skin, profile);
  const buttons = bindButtons(profile, (buttonId) => {
    if (buttonId === 'log') {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderAll();
      return;
    }

    if (buttonId === 'inventory') {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderAll();
      return;
    }

    const action = buttonActions[buttonId];
    if (action) {
      onAction(action);
    }
  });
  const handleDrawerKey = (event: KeyboardEvent) => {
    const nextState = nextDrawerStateForKey(event, { logOpen, inventoryOpen });
    if (!nextState) {
      return false;
    }

    logOpen = nextState.logOpen;
    inventoryOpen = nextState.inventoryOpen;
    renderAll();
    event.preventDefault();
    return true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (handleDrawerKey(event)) {
      return;
    }

    if (
      actionPending ||
      logOpen ||
      inventoryOpen ||
      !currentState ||
      currentState.in_combat ||
      isTerminalState(currentState)
    ) {
      return;
    }

    const direction = directionFromKey(event.key);
    if (!direction || !canMoveDirection(currentState, moveButtonId(direction))) {
      return;
    }

    event.preventDefault();
    onAction({ action: 'move', direction });
  };

  const resize = () => fitStage(stage, profile);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', resize);
  resize();
  renderAll();

  return {
    scene,
    render(state: GameState): void {
      currentState = state;
      renderAll();
    },
    setActionPending(pending: boolean): void {
      actionPending = pending;
      renderAll();
    },
    setConnectionStatus(status: string): void {
      connectionStatus = status;
      renderAll();
    },
    addLog(message: string): void {
      if (!message.trim()) {
        return;
      }
      logs = [message, ...logs].slice(0, 40);
      renderAll();
    },
    destroy(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', resize);
      game.destroy(false);
    }
  };

  function renderAll(): void {
    applyFixedStateClasses(stage, currentState, logOpen, inventoryOpen);
    renderStatusIndicator(profile, connectionStatus);
    renderLogs(logs, logOpen);

    if (!currentState) {
      return;
    }

    scene.renderGameState(currentState);
    renderTextState(profile, currentState, logs, logOpen, connectionStatus);
    renderInventoryState(currentState, onAction, !actionPending);
    renderButtonState(profile, buttons, currentState, actionPending, { log: logOpen, inventory: inventoryOpen });
  }
}

export function startFixedSkinWorkbench(skin: GameSkin): void {
  const selectedProfile = selectProfile(skin);
  if (!selectedProfile) {
    throw new Error(`Skin ${skin.id} does not define fixed profiles`);
  }
  const profile = selectedProfile;
  const scenario = selectScenario();

  document.body.classList.add('workbench-mode', 'fixed-workbench-mode');
  document.body.dataset.workbench = 'fixed-skin';
  document.body.dataset.fixedProfile = profile.id;
  document.body.dataset.fixedScenario = scenario;

  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app');
  }

  let state = createInitialState(scenario);
  let logs = createInitialLogs(scenario);
  let logOpen = false;
  let inventoryOpen = false;
  const stage = buildStage(app, profile, scenario);
  const scene = new RogueScene(skin.map);
  const game = createFixedGame(scene, skin, profile);
  const buttons = bindButtons(profile, (buttonId) => {
    if (buttonId === 'log') {
      logOpen = !logOpen;
      inventoryOpen = false;
      renderAll();
      return;
    }

    if (buttonId === 'inventory') {
      inventoryOpen = !inventoryOpen;
      logOpen = false;
      renderAll();
      return;
    }

    const action = buttonActions[buttonId];
    if (!action) {
      return;
    }

    dispatchAction(action);
  });
  const handleDrawerKey = (event: KeyboardEvent) => {
    const nextState = nextDrawerStateForKey(event, { logOpen, inventoryOpen });
    if (!nextState) {
      return false;
    }

    logOpen = nextState.logOpen;
    inventoryOpen = nextState.inventoryOpen;
    renderAll();
    event.preventDefault();
    return true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.repeat) {
      handleDrawerKey(event);
    }
  };

  function dispatchAction(action: GameAction): void {
    state = applyWorkbenchAction(state, action);
    logs = action.action === 'restart' ? createInitialLogs('combat') : [describeAction(action), ...logs].slice(0, 8);
    renderAll();
  }

  const resize = () => fitStage(stage, profile);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', resize);
  resize();
  renderAll();

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', resize);
    game.destroy(false);
  });

  function renderAll(): void {
    applyFixedStateClasses(stage, state, logOpen, inventoryOpen);
    scene.renderGameState(state);
    renderTextState(profile, state, logs, logOpen, scenario === 'status' ? 'revealing' : undefined);
    renderInventoryState(state, dispatchAction, true);
    renderButtonState(profile, buttons, state, scenario === 'status', { log: logOpen, inventory: inventoryOpen });
  }
}

function selectProfile(skin: GameSkin): FixedSkinProfile | null {
  const profiles = skin.fixedProfiles ?? [];
  if (profiles.length === 0) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const preferredId = params.get('profile');
  const preferred = profiles.find((profile) => profile.id === preferredId);
  if (preferred) {
    return preferred;
  }

  if (window.innerWidth >= 900) {
    return selectPreferredProfile(profiles, 'desktopWide') ?? profiles[0] ?? null;
  }

  const themed = selectThemedProfile(profiles, 'mobilePortrait', params);
  if (themed) {
    return themed;
  }

  return selectPreferredProfile(profiles, 'mobilePortrait') ?? profiles[0] ?? null;
}

function nextDrawerStateForKey(event: KeyboardEvent, current: DrawerState): DrawerState | null {
  if (event.key === 'Escape') {
    return current.logOpen || current.inventoryOpen
      ? { logOpen: false, inventoryOpen: false }
      : null;
  }

  const key = event.key.toLowerCase();
  if (key === 'l') {
    return { logOpen: !current.logOpen, inventoryOpen: false };
  }

  if (key === 'b' || key === 'i') {
    return { logOpen: false, inventoryOpen: !current.inventoryOpen };
  }

  return null;
}

function selectThemedProfile(
  profiles: FixedSkinProfile[],
  kind: FixedSkinProfile['kind'],
  params: URLSearchParams
): FixedSkinProfile | null {
  const request = {
    tags: readTokenParams(params, 'skin_tags'),
    mood: readTokenParams(params, 'skin_mood'),
    palette: readTokenParams(params, 'skin_palette')
  };

  if (request.tags.length === 0 && request.mood.length === 0 && request.palette.length === 0) {
    return null;
  }

  return profiles
    .filter((profile) => profile.kind === kind)
    .reduce<{ profile: FixedSkinProfile; score: number } | null>((best, profile) => {
      const score = themedProfileScore(profile, request);
      if (score <= 0) {
        return best;
      }

      if (!best || score > best.score || (score === best.score && profilePriority(profile) > profilePriority(best.profile))) {
        return { profile, score };
      }

      return best;
    }, null)?.profile ?? null;
}

function selectPreferredProfile(
  profiles: FixedSkinProfile[],
  kind: FixedSkinProfile['kind']
): FixedSkinProfile | null {
  return profiles
    .filter((profile) => profile.kind === kind)
    .reduce<FixedSkinProfile | null>((best, profile) => {
      if (!best) {
        return profile;
      }

      return profilePriority(profile) > profilePriority(best) ? profile : best;
    }, null);
}

function profilePriority(profile: FixedSkinProfile): number {
  return profile.meta?.defaultPriority ?? 0;
}

function themedProfileScore(
  profile: FixedSkinProfile,
  request: { tags: string[]; mood: string[]; palette: string[] }
): number {
  return countTokenMatches(profile.meta?.tags, request.tags) * 4 +
    countTokenMatches(profile.meta?.mood, request.mood) * 2 +
    countTokenMatches(profile.meta?.palette, request.palette);
}

function countTokenMatches(profileTokens: string[] | undefined, requestTokens: string[]): number {
  if (!profileTokens || requestTokens.length === 0) {
    return 0;
  }

  const available = new Set(profileTokens.map((token) => token.toLowerCase()));
  return requestTokens.filter((token) => available.has(token)).length;
}

function readTokenParams(params: URLSearchParams, key: string): string[] {
  return params.getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function selectScenario(): FixedWorkbenchScenario {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  return scenario === 'movement' || scenario === 'diagnostics' || scenario === 'status' || scenario === 'defeat' || scenario === 'victory'
    || scenario === 'escaped-copy'
    ? scenario
    : 'combat';
}

function createInitialState(scenario: FixedWorkbenchScenario): GameState {
  const state = createWorkbenchState();
  if (scenario === 'escaped-copy') {
    const [x, y] = state.player_pos;
    const cellTypes = state.cell_types.map((row, rowIndex) =>
      row.map((cell, columnIndex) =>
        rowIndex === y && columnIndex === x
          ? { ...cell, name: 'Glass <Hotel>' }
          : cell
      )
    );

    return {
      ...state,
      game_title: 'Neo <img> Tokyo',
      player: {
        ...state.player,
        font_awesome_icon: 'fa-solid fa-user-secret"><img src=x>'
      },
      cell_types: cellTypes,
      current_enemy: state.current_enemy
        ? { ...state.current_enemy, name: 'Chrome <Oni>' }
        : state.current_enemy
    };
  }

  if (scenario === 'combat' || scenario === 'diagnostics' || scenario === 'status') {
    return state;
  }

  if (scenario === 'defeat') {
    return {
      ...state,
      player_hp: -6,
      in_combat: false,
      game_over: true,
      game_won: false
    };
  }

  if (scenario === 'victory') {
    return {
      ...state,
      player_hp: 74,
      player_xp: 420,
      in_combat: false,
      current_enemy: null,
      enemies: state.enemies.map((enemy) => ({ ...enemy, is_defeated: true })),
      defeated_enemies: state.enemies.map((enemy) => ({ ...enemy, is_defeated: true })),
      game_over: false,
      game_won: true
    };
  }

  const explored = state.explored.map((row) => [...row]);
  explored[3][5] = true;
  return {
    ...state,
    player_pos_prev: state.player_pos,
    player_pos: [5, 3],
    explored,
    in_combat: false,
    current_enemy: null
  };
}

function createInitialLogs(scenario: FixedWorkbenchScenario): string[] {
  const baseLogs = [...WORKBENCH_LOGS].reverse();
  if (scenario === 'combat') {
    return baseLogs;
  }

  if (scenario === 'diagnostics') {
    return ['Diagnostics: every fixed skin sprite state is visible in the map aperture.', ...baseLogs];
  }

  if (scenario === 'status') {
    return ['Status test: compact WAIT label, thinking indicator sprite, and disabled pending controls must fit cleanly.', ...baseLogs];
  }

  if (scenario === 'defeat') {
    return ['End-state test: defeat overlay, red marker, disabled controls, and fixed restart sprite are visible.', ...baseLogs];
  }

  if (scenario === 'victory') {
    return ['End-state test: victory overlay, gold marker, disabled controls, and fixed restart sprite are visible.', ...baseLogs];
  }

  if (scenario === 'escaped-copy') {
    return ['Escaped copy test: <script> stays readable text inside the fixed skin.', ...baseLogs];
  }

  return ['Movement test: D-pad is unlocked; tap an arrow to verify movement hitboxes.', ...baseLogs];
}

function buildStage(app: HTMLElement, profile: FixedSkinProfile, scenario: FixedWorkbenchScenario): HTMLElement {
  app.replaceChildren();

  const viewport = document.createElement('main');
  viewport.className = 'fixed-skin-viewport';

  const stage = document.createElement('section');
  stage.className = 'shell fixed-skin-stage';
  stage.style.width = `${profile.width}px`;
  stage.style.height = `${profile.height}px`;
  stage.style.backgroundImage = `url("${profile.background}")`;
  stage.dataset.profile = profile.id;
  stage.dataset.profileRole = profile.meta?.role ?? 'legacy';

  stage.append(
    region('game-canvas', 'fixed-map-region', profile.regions.map),
    region('fixed-title', 'fixed-title-region', profile.regions.title),
    region('latest-message-panel', 'panel latest-message-panel fixed-latest-region', profile.regions.latest),
    region('player-panel', 'panel player-panel fixed-player-region', profile.regions.playerHp),
    region('combat-panel', 'panel combat-panel fixed-combat-region', profile.regions.combat),
    region('log-panel', 'panel log-panel fixed-log-region', profile.regions.log),
    region('inventory-panel', 'panel inventory-panel fixed-inventory-region', profile.regions.inventory ?? profile.regions.log),
    region('end-state-overlay', 'fixed-end-state-overlay', profile.regions.endState ?? defaultEndStateRect(profile)),
    region('fixed-player-hp-fill', 'fixed-meter-fill fixed-player-hp-fill', profile.regions.playerHpFill),
    region('fixed-enemy-hp-fill', 'fixed-meter-fill fixed-enemy-hp-fill', profile.regions.enemyHpFill),
    indicator('connection-status', 'fixed-status-indicator', profile.indicators.status.rect),
    indicator('fixed-combat-led', 'fixed-combat-led', profile.indicators.combatLed.rect)
  );

  const latest = stage.querySelector('#latest-message-panel');
  latest?.append(el('h2', 'fixed-region-label', 'Latest'), el('p', 'latest-message', '', 'latest-message'));

  const player = stage.querySelector('#player-panel');
  player?.append(
    createPlayerHpRow(),
    el('div', 'fixed-stat-row', '', 'fixed-player-stats')
  );

  const combat = stage.querySelector('#combat-panel');
  combat?.append(
    el('h2', '', 'Combat', 'combat-mode-label'),
    createCombatRow()
  );

  const log = stage.querySelector('#log-panel');
  log?.append(el('h2', 'fixed-region-label', 'Log'), el('div', 'game-log fixed-game-log', '', 'game-log'));

  const inventory = stage.querySelector('#inventory-panel');
  inventory?.append(el('h2', 'fixed-region-label', 'Inventory'), el('div', 'fixed-inventory-list', '', 'inventory-list'));

  const endState = stage.querySelector('#end-state-overlay');
  endState?.setAttribute('hidden', '');
  endState?.append(createEndStatePanel());

  if (scenario === 'diagnostics') {
    stage.querySelector('#game-canvas')?.append(buildDiagnosticsBoard(profile));
  }

  for (const [buttonId, button] of Object.entries(profile.buttons) as [FixedButtonId, FixedSkinButton][]) {
    stage.append(createButton(buttonId, button));
  }

  viewport.append(stage);
  app.append(viewport);
  return stage;
}

function buildDiagnosticsBoard(profile: FixedSkinProfile): HTMLElement {
  const board = document.createElement('div');
  board.className = 'fixed-diagnostics-board';
  board.dataset.diagnostics = 'fixed-skin';

  const heading = document.createElement('h2');
  heading.textContent = `${profile.label} diagnostics`;

  const grid = document.createElement('div');
  grid.className = 'fixed-diagnostics-grid';
  appendDiagnosticHeader(grid);

  for (const [buttonId, button] of Object.entries(profile.buttons) as [FixedButtonId, FixedSkinButton][]) {
    appendDiagnosticRow(grid, buttonId, [
      button.states.idle,
      button.states.hover,
      button.states.pressed,
      button.states.disabled
    ]);
  }

  appendDiagnosticRow(grid, 'status', [
    profile.indicators.status.states.ready,
    profile.indicators.status.states.thinking,
    profile.indicators.status.states.error,
    profile.indicators.status.states.offline
  ]);
  appendDiagnosticRow(grid, 'combatLed', [
    profile.indicators.combatLed.states.on,
    profile.indicators.combatLed.states.off
  ]);

  board.append(heading, grid);
  return board;
}

function appendDiagnosticHeader(grid: HTMLElement): void {
  for (const label of ['Widget', 'Idle', 'Hover', 'Pressed', 'Disabled']) {
    const cell = document.createElement('strong');
    cell.textContent = label;
    grid.append(cell);
  }
}

function appendDiagnosticRow(grid: HTMLElement, label: string, assets: (string | undefined)[]): void {
  const name = document.createElement('span');
  name.className = 'fixed-diagnostic-name';
  name.textContent = label;
  grid.append(name);

  for (let index = 0; index < 4; index += 1) {
    const cell = document.createElement('span');
    cell.className = 'fixed-diagnostic-asset';
    const asset = assets[index];
    if (asset) {
      const image = document.createElement('img');
      image.src = asset;
      image.alt = `${label} state ${index + 1}`;
      cell.append(image);
    }
    grid.append(cell);
  }
}

function region(id: string, className: string, rect: FixedSkinRect): HTMLElement {
  const element = document.createElement('section');
  element.id = id;
  element.className = className;
  applyRect(element, rect);
  return element;
}

function indicator(id: string, className: string, rect: FixedSkinRect): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  element.className = className;
  applyRect(element, rect);
  return element;
}

function createButton(buttonId: FixedButtonId, button: FixedSkinButton): HTMLButtonElement {
  const element = document.createElement('button');
  element.id = domIds[buttonId];
  element.className = `fixed-skin-button fixed-${buttonId}`;
  element.type = 'button';
  element.dataset.fixedButton = buttonId;
  element.setAttribute('aria-label', button.label);
  applyRect(element, button.rect);

  if (!button.hideLabel && button.icon) {
    const icon = document.createElement('i');
    icon.className = button.icon;
    icon.setAttribute('aria-hidden', 'true');
    element.append(icon);
  }

  if (!button.hideLabel) {
    const label = document.createElement('span');
    label.textContent = button.label;
    element.append(label);
  }
  if (buttonId === 'log') {
    element.setAttribute('aria-controls', 'log-panel');
    element.setAttribute('aria-expanded', 'false');
    element.setAttribute('aria-pressed', 'false');
  } else if (buttonId === 'inventory') {
    element.setAttribute('aria-controls', 'inventory-panel');
    element.setAttribute('aria-expanded', 'false');
    element.setAttribute('aria-pressed', 'false');
  }
  setButtonVisual(element, button, 'idle');
  return element;
}

function createPlayerHpRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fixed-hp-row';

  const label = document.createElement('span');
  label.textContent = 'HP';

  const value = document.createElement('strong');
  value.id = 'player-hp';
  value.textContent = '--';

  row.append(label, value);
  return row;
}

function createCombatRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fixed-combat-row';

  const name = document.createElement('span');
  name.id = 'enemy-name';
  name.textContent = 'Enemy';

  const hp = document.createElement('strong');
  hp.id = 'enemy-hp';
  hp.textContent = '--';

  row.append(name, hp);
  return row;
}

function createEndStatePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'fixed-end-state-panel';

  const kicker = el('p', 'end-state-kicker', 'Mission ended', 'end-state-kicker');
  const title = el('h2', '', 'RogueLLM', 'end-state-title');
  const message = el('p', '', '', 'end-state-message');
  const stats = document.createElement('dl');
  stats.className = 'end-state-stats';
  stats.append(createEndStateStat('HP', 'end-state-hp'), createEndStateStat('XP', 'end-state-xp'));

  panel.append(kicker, title, message, stats);
  return panel;
}

function createEndStateStat(label: string, id: string): HTMLElement {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const value = document.createElement('dd');
  value.id = id;
  value.textContent = '--';
  wrapper.append(term, value);
  return wrapper;
}

function bindButtons(
  profile: FixedSkinProfile,
  onClick: (buttonId: FixedButtonId) => void
): Map<FixedButtonId, HTMLButtonElement> {
  const buttons = new Map<FixedButtonId, HTMLButtonElement>();

  for (const [buttonId, button] of Object.entries(profile.buttons) as [FixedButtonId, FixedSkinButton][]) {
    const element = document.querySelector(`[data-fixed-button="${buttonId}"]`);
    if (!(element instanceof HTMLButtonElement)) {
      continue;
    }

    buttons.set(buttonId, element);
    element.addEventListener('pointerenter', () => {
      if (!element.disabled) {
        setButtonVisual(element, button, 'hover');
      }
    });
    element.addEventListener('pointerleave', () => {
      if (!element.disabled) {
        setButtonVisual(element, button, 'idle');
      }
    });
    element.addEventListener('pointerdown', () => {
      if (!element.disabled) {
        setButtonVisual(element, button, 'pressed');
      }
    });
    element.addEventListener('pointerup', () => {
      if (!element.disabled) {
        setButtonVisual(element, button, 'hover');
      }
    });
    element.addEventListener('click', () => {
      if (!element.disabled) {
        onClick(buttonId);
      }
    });
  }

  return buttons;
}

function createFixedGame(scene: RogueScene, skin: GameSkin, profile: FixedSkinProfile): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: skin.map.canvasBackground,
    scale: {
      mode: Phaser.Scale.NONE,
      parent: 'game-canvas',
      width: profile.regions.map.width,
      height: profile.regions.map.height
    },
    render: {
      antialias: false,
      pixelArt: true
    },
    scene
  });

  return game;
}

function renderTextState(
  profile: FixedSkinProfile,
  state: GameState,
  logs: string[],
  logOpen: boolean,
  connectionStatus?: string
): void {
  renderTitleState(state);
  renderStatusIndicator(profile, connectionStatus ?? 'ready');
  setLatestMessage(logs[0] ?? '');
  setText('player-hp', `${Math.max(0, state.player_hp)}/${state.player_max_hp}`);
  renderPlayerStatsState(state);

  const enemy = state.current_enemy;
  setText('combat-mode-label', state.in_combat ? 'Combat' : 'Explore');
  setText('enemy-name', enemy?.name ?? (state.in_combat ? 'No enemy' : 'No hostile'));
  setText('enemy-hp', enemy ? `${enemy.hp}/${enemy.max_hp}` : '--');
  setFill('fixed-player-hp-fill', state.player_hp, state.player_max_hp, profile.regions.playerHpFill.width);
  setFill('fixed-enemy-hp-fill', enemy?.hp ?? 0, enemy?.max_hp ?? 1, profile.regions.enemyHpFill.width);
  renderEndState(state);
  renderLogs(logs, logOpen);

  const led = document.getElementById('fixed-combat-led');
  led?.style.setProperty(
    'background-image',
    `url("${state.in_combat ? profile.indicators.combatLed.states.on : profile.indicators.combatLed.states.off}")`
  );
}

function renderTitleState(state: GameState): void {
  const title = document.getElementById('fixed-title');
  if (!title) {
    return;
  }

  const kicker = document.createElement('p');
  kicker.textContent = 'RogueLLM';

  const heading = document.createElement('h1');
  const icon = document.createElement('i');
  icon.className = normalizeFontAwesomeClass(state.player.font_awesome_icon, 'fa-solid fa-user-secret');
  icon.setAttribute('aria-hidden', 'true');
  heading.append(icon, document.createTextNode(state.game_title));

  title.replaceChildren(kicker, heading);
}

function renderPlayerStatsState(state: GameState): void {
  const stats = document.getElementById('fixed-player-stats');
  if (!stats) {
    return;
  }

  stats.replaceChildren(
    createStatCell('ATK', state.player_attack),
    createStatCell('DEF', state.player_defense),
    createStatCell('XP', state.player_xp),
    createStatCell('TILE', currentTileName(state))
  );
}

function createStatCell(label: string, value: number | string): HTMLElement {
  const cell = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = String(value);
  cell.append(`${label} `, strong);
  return cell;
}

function renderButtonState(
  profile: FixedSkinProfile,
  buttons: Map<FixedButtonId, HTMLButtonElement>,
  state: GameState,
  actionPending = false,
  activeButtons: Partial<Record<FixedButtonId, boolean>> = {}
): void {
  const inCombat = state.in_combat && !!state.current_enemy;
  const terminal = isTerminalState(state);
  const canMove = !state.in_combat && !terminal;

  for (const [buttonId, element] of buttons) {
    const button = profile.buttons[buttonId];
    if (!button) {
      continue;
    }
    const blockedByPending = actionPending && buttonId !== 'log' && buttonId !== 'inventory' && buttonId !== 'restart';
    const disabled =
      blockedByPending
        ? true
        : buttonId === 'attack' || buttonId === 'run'
        ? !inCombat
        : buttonId === 'restart'
          ? !terminal
          : buttonId === 'log' || buttonId === 'inventory'
          ? false
          : !canMove || !canMoveDirection(state, buttonId);
    element.hidden = buttonId === 'restart' && !terminal;
    element.disabled = disabled;
    if (buttonId === 'log' || buttonId === 'inventory') {
      const active = activeButtons[buttonId] ? 'true' : 'false';
      element.setAttribute('aria-expanded', active);
      element.setAttribute('aria-pressed', active);
    }
    setButtonVisual(element, button, disabled ? 'disabled' : activeButtons[buttonId] ? 'pressed' : 'idle');
  }
}

function renderInventoryState(state: GameState, onAction: (action: GameAction) => void, actionsEnabled: boolean): void {
  const list = document.getElementById('inventory-list');
  if (!list) {
    return;
  }

  if (state.inventory.length === 0) {
    list.replaceChildren(el('p', 'fixed-inventory-empty', 'Empty'));
    return;
  }

  list.replaceChildren(
    ...state.inventory.map((item) => createInventoryRow(item, onAction, actionsEnabled && !isTerminalState(state)))
  );
}

function createInventoryRow(item: Item, onAction: (action: GameAction) => void, actionsEnabled: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = item.is_equipped ? 'inventory-item fixed-inventory-item equipped' : 'inventory-item fixed-inventory-item';

  const body = document.createElement('div');
  body.className = 'fixed-inventory-item-body';

  const name = document.createElement('strong');
  name.textContent = item.name;
  const detail = document.createElement('span');
  detail.textContent = item.description;
  body.append(name, detail);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'fixed-inventory-action';
  action.disabled = !actionsEnabled;

  if (item.type === 'consumable') {
    action.textContent = 'Use';
    action.addEventListener('click', () => onAction({ action: 'use_item', item_id: item.id }));
  } else if (item.type === 'weapon' || item.type === 'armor') {
    action.textContent = item.is_equipped ? 'On' : 'Equip';
    action.disabled = action.disabled || item.is_equipped;
    action.addEventListener('click', () => onAction({ action: 'equip_item', item_id: item.id }));
  } else {
    action.textContent = item.type;
    action.disabled = true;
  }

  row.append(body, action);
  return row;
}

function applyFixedStateClasses(stage: HTMLElement, state: GameState | null, logOpen: boolean, inventoryOpen: boolean): void {
  const terminal = state ? isTerminalState(state) : false;
  const inCombat = state?.in_combat ?? false;
  document.body.classList.toggle('in-combat', state?.in_combat ?? false);
  document.body.classList.toggle('game-ended', terminal);
  document.body.classList.toggle('log-open', logOpen);
  document.body.classList.toggle('fixed-log-open', logOpen);
  document.body.classList.toggle('fixed-inventory-open', inventoryOpen);
  stage.classList.toggle('fixed-combat-state', inCombat);
  stage.classList.toggle('fixed-terminal-state', terminal);
  stage.classList.toggle('fixed-victory-state', state?.game_won ?? false);
  stage.classList.toggle('fixed-defeat-state', state ? state.game_over || state.player_hp <= 0 : false);
}

function renderStatusIndicator(profile: FixedSkinProfile, status: string): void {
  const element = document.getElementById('connection-status');
  if (!element) {
    return;
  }

  const normalized = status.trim().toLowerCase();
  const { label, visualState } = fixedStatusDisplay(normalized);
  element.textContent = label;
  element.style.setProperty(
    'background-image',
    `url("${profile.indicators.status.states[visualState] ?? profile.indicators.status.states.ready}")`
  );
}

function fixedStatusDisplay(status: string): { label: string; visualState: 'ready' | 'thinking' | 'error' | 'offline' } {
  switch (status) {
    case 'error':
      return { label: 'ERR', visualState: 'error' };
    case 'closed':
    case 'offline':
      return { label: 'OFF', visualState: 'offline' };
    case 'creating':
      return { label: 'MAKE', visualState: 'thinking' };
    case 'restarting':
      return { label: 'BOOT', visualState: 'thinking' };
    case 'thinking':
    case 'revealing':
      return { label: 'WAIT', visualState: 'thinking' };
    case 'open':
      return { label: 'OPEN', visualState: 'ready' };
    case 'online':
      return { label: 'NET', visualState: 'ready' };
    case 'ready':
    default:
      return { label: 'READY', visualState: 'ready' };
  }
}

function renderEndState(state: GameState): void {
  const overlay = document.getElementById('end-state-overlay');
  if (!overlay) {
    return;
  }

  const defeated = state.game_over || state.player_hp <= 0;
  const won = state.game_won;
  overlay.hidden = !defeated && !won;

  if (overlay.hidden) {
    return;
  }

  setText('end-state-kicker', won ? 'Case closed' : 'Down for the count');
  setText('end-state-title', state.game_title || 'RogueLLM');
  setText(
    'end-state-message',
    won
      ? 'Every active threat on this board has been cleared.'
      : `You were defeated${state.current_enemy ? ` by ${state.current_enemy.name}` : ''}.`
  );
  setText('end-state-hp', `${Math.max(0, state.player_hp)}/${state.player_max_hp}`);
  setText('end-state-xp', String(state.player_xp));
}

function renderLogs(logs: string[], logOpen: boolean): void {
  const log = document.getElementById('game-log');
  if (!log) {
    return;
  }

  const visibleLogs = logOpen ? logs : logs.slice(0, 1);
  const latestMessage = visibleLogs[0] ?? '';
  const latestChanged = Boolean(latestMessage) && latestMessage !== (log.dataset.latestMessage ?? '');
  log.replaceChildren(
    ...visibleLogs.map((message, index) => {
      const row = document.createElement('p');
      if (index === 0) {
        row.className = 'latest';
        if (latestChanged) {
          row.classList.add(messageFreshClass);
          window.setTimeout(() => row.classList.remove(messageFreshClass), 520);
        }
      }
      row.textContent = message;
      return row;
    })
  );
  log.dataset.latestMessage = latestMessage;
}

function setButtonVisual(element: HTMLButtonElement, button: FixedSkinButton, state: FixedSkinButtonState): void {
  element.dataset.visualState = state;
  element.style.backgroundImage = `url("${button.states[state]}")`;
}

function canMoveDirection(state: GameState, buttonId: FixedButtonId): boolean {
  const directionByButton: Partial<Record<FixedButtonId, Direction>> = {
    moveN: 'n',
    moveS: 's',
    moveE: 'e',
    moveW: 'w'
  };
  const direction = directionByButton[buttonId];
  if (!direction) {
    return true;
  }

  const [x, y] = state.player_pos;
  switch (direction) {
    case 'n':
      return y > 0;
    case 's':
      return y < state.map_height - 1;
    case 'e':
      return x < state.map_width - 1;
    case 'w':
      return x > 0;
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

function moveButtonId(direction: Direction): FixedButtonId {
  switch (direction) {
    case 'n':
      return 'moveN';
    case 's':
      return 'moveS';
    case 'e':
      return 'moveE';
    case 'w':
      return 'moveW';
  }
}

function describeAction(action: GameAction): string {
  switch (action.action) {
    case 'attack':
      return 'Fixed-skin button state: ATTACK clicked, sprite returned from pressed to idle.';
    case 'run':
      return 'Fixed-skin button state: RUN clicked, combat modules switch off and movement unlocks.';
    case 'restart':
      return 'Fixed-skin terminal state restarted into the default combat bench.';
    case 'move':
      return `Fixed-skin D-pad state: moved ${action.direction.toUpperCase()} on a fixed artboard.`;
    case 'equip_item':
    case 'use_item':
    case 'get_initial_state':
      return 'Fixed-skin workbench action received.';
  }
}

function isTerminalState(state: GameState): boolean {
  return state.game_over || state.game_won || state.player_hp <= 0;
}

function defaultEndStateRect(profile: FixedSkinProfile): FixedSkinRect {
  return {
    x: 24,
    y: Math.max(24, Math.floor(profile.height * 0.42)),
    width: Math.max(240, profile.width - 48),
    height: Math.min(300, Math.max(180, Math.floor(profile.height * 0.32)))
  };
}

function currentTileName(state: GameState): string {
  const [x, y] = state.player_pos;
  return state.cell_types[y]?.[x]?.name ?? `${x}, ${y}`;
}

function fitStage(stage: HTMLElement, profile: FixedSkinProfile): void {
  const scale = Math.min(1, window.innerWidth / profile.width, window.innerHeight / profile.height);
  stage.style.transform = `scale(${scale})`;
  stage.dataset.scale = scale.toFixed(3);
}

function applyRect(element: HTMLElement, rect: FixedSkinRect): void {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function setFill(id: string, value: number, max: number, width: number): void {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  element.style.width = `${Math.round(width * pct)}px`;
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setLatestMessage(value: string): void {
  const element = document.getElementById('latest-message');
  if (!element) {
    return;
  }

  const changed = Boolean(value) && value !== (element.dataset.latestMessage ?? '');
  element.textContent = value;
  element.dataset.latestMessage = value;
  if (changed) {
    flashMessageElement(element);
  }
}

function flashMessageElement(element: HTMLElement): void {
  element.classList.remove(messageFreshClass);
  void element.offsetWidth;
  element.classList.add(messageFreshClass);
  window.setTimeout(() => element.classList.remove(messageFreshClass), 520);
}

function el(tagName: string, className: string, text: string, id?: string): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  if (id) {
    element.id = id;
  }
  element.textContent = text;
  return element;
}

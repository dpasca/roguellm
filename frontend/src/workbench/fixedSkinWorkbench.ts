import Phaser from 'phaser';
import { RogueScene } from '../game/RogueScene';
import type { Direction, GameAction, GameState } from '../protocol/types';
import type { FixedSkinButton, FixedSkinButtonState, FixedSkinProfile, FixedSkinRect, GameSkin } from '../skins/types';
import { applyWorkbenchAction, createWorkbenchState, WORKBENCH_LOGS } from './skinWorkbench';

type FixedButtonId = keyof FixedSkinProfile['buttons'];
type FixedWorkbenchScenario = 'combat' | 'movement' | 'diagnostics' | 'defeat' | 'victory';

const buttonActions: Partial<Record<FixedButtonId, GameAction>> = {
  attack: { action: 'attack' },
  run: { action: 'run' },
  restart: { action: 'restart' },
  moveN: { action: 'move', direction: 'n' },
  moveS: { action: 'move', direction: 's' },
  moveE: { action: 'move', direction: 'e' },
  moveW: { action: 'move', direction: 'w' }
};

const domIds: Record<FixedButtonId, string> = {
  attack: 'attack',
  run: 'run',
  log: 'fixed-log-toggle',
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

export function isFixedSkinRuntime(location: Location = window.location): boolean {
  const params = new URL(location.href).searchParams;
  return params.get('ui') === 'fixed-skin' || params.get('fixed_skin') === '1';
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
  let actionPending = false;
  let connectionStatus = 'offline';
  const stage = buildStage(app, profile, 'combat');
  const scene = new RogueScene(skin.map);
  const game = createFixedGame(scene, skin, profile);
  const buttons = bindButtons(profile, (buttonId) => {
    if (buttonId === 'log') {
      logOpen = !logOpen;
      renderAll();
      return;
    }

    const action = buttonActions[buttonId];
    if (action) {
      onAction(action);
    }
  });

  const resize = () => fitStage(stage, profile);
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
      window.removeEventListener('resize', resize);
      game.destroy(false);
    }
  };

  function renderAll(): void {
    applyFixedStateClasses(stage, currentState, logOpen);
    renderStatusIndicator(profile, connectionStatus);
    renderLogs(logs, logOpen);

    if (!currentState) {
      return;
    }

    scene.renderGameState(currentState);
    renderTextState(profile, currentState, logs, logOpen, connectionStatus);
    renderButtonState(profile, buttons, currentState, actionPending);
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
  const stage = buildStage(app, profile, scenario);
  const scene = new RogueScene(skin.map);
  const game = createFixedGame(scene, skin, profile);
  const buttons = bindButtons(profile, (buttonId) => {
    if (buttonId === 'log') {
      logOpen = !logOpen;
      renderAll();
      return;
    }

    const action = buttonActions[buttonId];
    if (!action) {
      return;
    }

    state = applyWorkbenchAction(state, action);
    logs = action.action === 'restart' ? createInitialLogs('combat') : [describeAction(action), ...logs].slice(0, 8);
    renderAll();
  });

  const resize = () => fitStage(stage, profile);
  window.addEventListener('resize', resize);
  resize();
  renderAll();

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('resize', resize);
    game.destroy(false);
  });

  function renderAll(): void {
    applyFixedStateClasses(stage, state, logOpen);
    scene.renderGameState(state);
    renderTextState(profile, state, logs, logOpen);
    renderButtonState(profile, buttons, state);
  }
}

function selectProfile(skin: GameSkin): FixedSkinProfile | null {
  const profiles = skin.fixedProfiles ?? [];
  if (profiles.length === 0) {
    return null;
  }

  const preferredId = new URLSearchParams(window.location.search).get('profile');
  const preferred = profiles.find((profile) => profile.id === preferredId);
  if (preferred) {
    return preferred;
  }

  if (window.innerWidth >= 900) {
    return profiles.find((profile) => profile.kind === 'desktopWide') ?? profiles[0] ?? null;
  }

  return (
    profiles.find((profile) => profile.id === 'gold-mobile') ??
    profiles.find((profile) => profile.id === 'reference-mobile-v2') ??
    profiles.find((profile) => profile.kind === 'mobilePortrait') ??
    profiles[0] ??
    null
  );
}

function selectScenario(): FixedWorkbenchScenario {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  return scenario === 'movement' || scenario === 'diagnostics' || scenario === 'defeat' || scenario === 'victory'
    ? scenario
    : 'combat';
}

function createInitialState(scenario: FixedWorkbenchScenario): GameState {
  const state = createWorkbenchState();
  if (scenario === 'combat' || scenario === 'diagnostics') {
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

  if (scenario === 'defeat') {
    return ['End-state test: defeat overlay, red marker, disabled controls, and fixed restart sprite are visible.', ...baseLogs];
  }

  if (scenario === 'victory') {
    return ['End-state test: victory overlay, gold marker, disabled controls, and fixed restart sprite are visible.', ...baseLogs];
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

  stage.append(
    region('game-canvas', 'fixed-map-region', profile.regions.map),
    region('fixed-title', 'fixed-title-region', profile.regions.title),
    region('latest-message-panel', 'panel latest-message-panel fixed-latest-region', profile.regions.latest),
    region('player-panel', 'panel player-panel fixed-player-region', profile.regions.playerHp),
    region('combat-panel', 'panel combat-panel fixed-combat-region', profile.regions.combat),
    region('log-panel', 'panel log-panel fixed-log-region', profile.regions.log),
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
    el('div', 'fixed-hp-row', '<span>HP</span><strong id="player-hp">--</strong>'),
    el('div', 'fixed-stat-row', '', 'fixed-player-stats')
  );

  const combat = stage.querySelector('#combat-panel');
  combat?.append(
    el('h2', '', 'Combat'),
    el('div', 'fixed-combat-row', '<span id="enemy-name">Enemy</span><strong id="enemy-hp">--</strong>')
  );

  const log = stage.querySelector('#log-panel');
  log?.append(el('h2', 'fixed-region-label', 'Log'), el('div', 'game-log fixed-game-log', '', 'game-log'));

  const endState = stage.querySelector('#end-state-overlay');
  endState?.setAttribute('hidden', '');
  endState?.append(
    el(
      'div',
      'fixed-end-state-panel',
      '<p class="end-state-kicker" id="end-state-kicker">Mission ended</p>' +
        '<h2 id="end-state-title">RogueLLM</h2>' +
        '<p id="end-state-message"></p>' +
        '<dl class="end-state-stats">' +
        '<div><dt>HP</dt><dd id="end-state-hp">--</dd></div>' +
        '<div><dt>XP</dt><dd id="end-state-xp">--</dd></div>' +
        '</dl>'
    )
  );

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
  setButtonVisual(element, button, 'idle');
  return element;
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
  setHtml('fixed-title', `<p>RogueLLM</p><h1><i class="${state.player.font_awesome_icon ?? 'fa-solid fa-user-secret'}"></i>${state.game_title}</h1>`);
  renderStatusIndicator(profile, connectionStatus ?? (state.in_combat ? 'ready' : 'open'));
  setText('latest-message', logs[0] ?? '');
  setText('player-hp', `${Math.max(0, state.player_hp)}/${state.player_max_hp}`);
  setHtml(
    'fixed-player-stats',
    `<span>ATK <strong>${state.player_attack}</strong></span>` +
      `<span>DEF <strong>${state.player_defense}</strong></span>` +
      `<span>XP <strong>${state.player_xp}</strong></span>` +
      `<span>TILE <strong>${currentTileName(state)}</strong></span>`
  );

  const enemy = state.current_enemy;
  setText('enemy-name', enemy?.name ?? 'No enemy');
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

function renderButtonState(
  profile: FixedSkinProfile,
  buttons: Map<FixedButtonId, HTMLButtonElement>,
  state: GameState,
  actionPending = false
): void {
  const inCombat = state.in_combat && !!state.current_enemy;
  const terminal = isTerminalState(state);
  const canMove = !state.in_combat && !terminal;

  for (const [buttonId, element] of buttons) {
    const button = profile.buttons[buttonId];
    if (!button) {
      continue;
    }
    const blockedByPending = actionPending && buttonId !== 'log' && buttonId !== 'restart';
    const disabled =
      blockedByPending
        ? true
        : buttonId === 'attack' || buttonId === 'run'
        ? !inCombat
        : buttonId === 'restart'
          ? !terminal
          : buttonId === 'log'
          ? false
          : !canMove || !canMoveDirection(state, buttonId);
    element.hidden = buttonId === 'restart' && !terminal;
    element.disabled = disabled;
    setButtonVisual(element, button, disabled ? 'disabled' : 'idle');
  }
}

function applyFixedStateClasses(stage: HTMLElement, state: GameState | null, logOpen: boolean): void {
  const terminal = state ? isTerminalState(state) : false;
  document.body.classList.toggle('in-combat', state?.in_combat ?? false);
  document.body.classList.toggle('game-ended', terminal);
  document.body.classList.toggle('log-open', logOpen);
  document.body.classList.toggle('fixed-log-open', logOpen);
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
  const visualState =
    normalized === 'error'
      ? 'error'
      : normalized === 'closed' || normalized === 'offline'
        ? 'offline'
        : normalized === 'thinking' || normalized === 'creating' || normalized === 'restarting' || normalized === 'revealing'
          ? 'thinking'
          : 'ready';
  element.textContent = normalized ? normalized.toUpperCase() : 'OFFLINE';
  element.style.setProperty(
    'background-image',
    `url("${profile.indicators.status.states[visualState] ?? profile.indicators.status.states.ready}")`
  );
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
  log.replaceChildren(
    ...visibleLogs.map((message, index) => {
      const row = document.createElement('p');
      if (index === 0) {
        row.className = 'latest';
      }
      row.textContent = message;
      return row;
    })
  );
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
    case 'restart':
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
  const scale = Math.min(window.innerWidth / profile.width, window.innerHeight / profile.height);
  stage.style.transform = `scale(${scale})`;
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

function setHtml(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = value;
  }
}

function el(tagName: string, className: string, html: string, id?: string): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  if (id) {
    element.id = id;
  }
  element.innerHTML = html;
  return element;
}

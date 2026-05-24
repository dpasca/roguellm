import { GameSocketClient } from './protocol/socketClient';
import { getBackendOrigin, getGeneratorIdFromLocation, getSessionIdFromLocation } from './protocol/session';
import { getSkinFromLocation } from './skins/registry';
import type { GameSkin } from './skins/types';
import { createPhaserFixedSkinRuntime, isPhaserFixedSkinRuntime, isPhaserFixedSkinWorkbench, startPhaserFixedSkinWorkbench } from './workbench/phaserFixedSkinWorkbench';
import type { Direction, GameAction, GameServerMessage, GameState } from './protocol/types';

const GAME2_SESSION_QUERY_PARAMS = [
  'fixture',
  'skin',
  'ui',
  'renderer',
  'fixed_skin',
  'profile',
  'skin_tags',
  'skin_mood',
  'skin_palette'
];

function showFatal(message: string): void {
  const element = document.createElement('div');
  element.className = 'fatal';
  element.textContent = message;
  document.body.replaceChildren(element);
}

interface RuntimeUi {
  scene?: unknown;
  render(state: GameState): void;
  setActionPending(pending: boolean): void;
  setConnectionStatus(status: string): void;
  addLog(message: string): void;
  destroy(): void;
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  showFatal(error instanceof Error ? error.message : 'Failed to start Game2.');
});

async function bootstrap(): Promise<void> {
  const activeSkin = getSkinFromLocation();
  const phaserFixedWorkbench = isPhaserFixedSkinWorkbench();
  if (!phaserFixedWorkbench && isLegacyDomRequest()) {
    showFatal('Legacy DOM/CSS Game2 UI has been retired. Use the Phaser fixed-skin renderer.');
    throw new Error('Legacy DOM/CSS Game2 UI requested');
  }

  const phaserFixedRuntime = !phaserFixedWorkbench &&
    !!activeSkin.fixedProfiles &&
    isPhaserFixedSkinRuntime();

  document.body.dataset.renderSurface = 'phaser-canvas';
  markCanvasSkin(activeSkin);

  if (phaserFixedWorkbench) {
    startPhaserFixedSkinWorkbench(activeSkin);
    return;
  }

  const sessionId = getSessionIdFromLocation();

  if (!sessionId) {
    const generatorId = getGeneratorIdFromLocation();
    if (generatorId) {
      const gameUrl = new URL('/game2', getBackendOrigin());
      gameUrl.searchParams.set('game_id', generatorId);
      const currentParams = new URLSearchParams(window.location.search);
      for (const paramName of GAME2_SESSION_QUERY_PARAMS) {
        for (const paramValue of currentParams.getAll(paramName)) {
          if (paramValue) {
            gameUrl.searchParams.append(paramName, paramValue);
          }
        }
      }
      window.location.replace(gameUrl.toString());
      showFatal('Creating session from game id...');
      throw new Error('Redirecting to create a session from game id');
    }

    showFatal('Missing game session id. Open /game2/<session_id>.');
    throw new Error('Missing game session id');
  }

  let currentState: GameState | null = null;
  let actionPending = false;
  let nextClientActionId = 1;
  let pendingActionId: number | null = null;
  const ui = phaserFixedRuntime
    ? createPhaserFixedSkinRuntime(activeSkin, handleUserAction)
    : createUnsupportedRuntime(activeSkin);

  const socket = new GameSocketClient(sessionId, {
    onOpen() {
      ui.setConnectionStatus('online');
    },
    onClose() {
      actionPending = false;
      ui.setActionPending(false);
      ui.setConnectionStatus('closed');
    },
    onError() {
      actionPending = false;
      ui.setActionPending(false);
      ui.setConnectionStatus('error');
    },
    onMessage(message) {
      handleServerMessage(message);
    }
  });

  function handleUserAction(action: GameAction): void {
    if (actionPending && action.action !== 'restart') {
      return;
    }

    const actionToSend = attachClientActionId(action);
    const optimistic = applyOptimisticAction(action);
    if (isGameplayAction(action)) {
      actionPending = true;
      pendingActionId = actionToSend.client_action_id ?? null;
      ui.setActionPending(true);
      ui.setConnectionStatus(optimistic ? 'revealing' : 'thinking');
      if (action.action === 'run') {
        ui.addLog('Trying to break away...');
      }
    }

    socket.send(actionToSend);
  }

  function handleServerMessage(message: GameServerMessage): void {
    switch (message.type) {
      case 'connection_established':
        ui.setConnectionStatus('ready');
        socket.send({ action: 'get_initial_state' });
        break;
      case 'status':
        actionPending = false;
        ui.setActionPending(false);
        ui.setConnectionStatus(message.status);
        ui.addLog(message.message);
        if (message.status === 'ready') {
          socket.send({ action: 'get_initial_state' });
        }
        break;
      case 'error':
        actionPending = false;
        ui.setActionPending(false);
        ui.setConnectionStatus('error');
        ui.addLog(message.message);
        break;
      case 'update':
        if (isStaleActionResponse(message)) {
          return;
        }
        actionPending = false;
        pendingActionId = null;
        ui.setActionPending(false);
        currentState = message.state;
        ui.render(message.state);
        ui.setConnectionStatus('ready');
        if (message.description) {
          ui.addLog(message.description);
        }
        break;
    }
  }

  function attachClientActionId(action: GameAction): GameAction {
    if (!isGameplayAction(action)) {
      return action;
    }

    return {
      ...action,
      client_action_id: nextClientActionId++
    };
  }

  function isStaleActionResponse(message: GameServerMessage): boolean {
    if (message.type !== 'update' || !message.client_action_id || pendingActionId === null) {
      return false;
    }

    return message.client_action_id !== pendingActionId;
  }

  function applyOptimisticAction(action: GameAction): boolean {
    if (action.action !== 'move' || !currentState || !canOptimisticallyMove(currentState, action.direction)) {
      return false;
    }

    const nextState = structuredClone(currentState);
    const [x, y] = nextState.player_pos;
    const [nextX, nextY] = nextPosition(x, y, action.direction);
    nextState.player_pos_prev = [x, y];
    nextState.player_pos = [nextX, nextY];
    nextState.explored = nextState.explored.map((row) => [...row]);
    nextState.explored[nextY][nextX] = true;
    currentState = nextState;

    ui.render(nextState);
    return true;
  }

  function canOptimisticallyMove(state: GameState, direction: Direction): boolean {
    if (state.in_combat || state.game_over || state.game_won || state.player_hp <= 0) {
      return false;
    }

    const [x, y] = state.player_pos;
    const [nextX, nextY] = nextPosition(x, y, direction);
    return nextX >= 0 &&
      nextX < state.map_width &&
      nextY >= 0 &&
      nextY < state.map_height &&
      !hasKnownUndefeatedEnemyAt(state, nextX, nextY);
  }

  function hasKnownUndefeatedEnemyAt(state: GameState, x: number, y: number): boolean {
    if (!state.explored[y]?.[x]) {
      return false;
    }

    return state.enemies.some((enemy) => enemy.x === x && enemy.y === y && !enemy.is_defeated);
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

  function isGameplayAction(action: GameAction): boolean {
    return action.action !== 'get_initial_state';
  }

  socket.connect();

  window.addEventListener('beforeunload', () => {
    socket.close();
    ui.destroy();
  });
}

function markCanvasSkin(skin: GameSkin): void {
  document.body.dataset.skin = skin.id;
}

function isLegacyDomRequest(location: Location = window.location): boolean {
  const params = new URL(location.href).searchParams;
  const requestedUi = params.get('ui')?.toLowerCase();
  const renderer = (params.get('fixed_renderer') ?? params.get('renderer') ?? '').toLowerCase();
  const workbench = (params.get('workbench') ?? params.get('bench') ?? '').toLowerCase();
  return requestedUi === 'classic' ||
    requestedUi === 'responsive' ||
    renderer === 'dom' ||
    renderer === 'html' ||
    renderer === 'legacy' ||
    workbench === 'skin';
}

function createUnsupportedRuntime(skin: GameSkin): RuntimeUi {
  throw new Error(`Skin ${skin.id} does not define a Phaser fixed-skin runtime profile`);
}

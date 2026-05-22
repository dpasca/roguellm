import Phaser from 'phaser';
import './styles.css';
import { RogueScene } from './game/RogueScene';
import { GameSocketClient } from './protocol/socketClient';
import { getBackendOrigin, getGeneratorIdFromLocation, getSessionIdFromLocation } from './protocol/session';
import { applySkin } from './skins/applySkin';
import { getSkinFromLocation } from './skins/registry';
import type { GameSkin } from './skins/types';
import { HudController } from './ui/hud';
import { createFixedSkinRuntime, isFixedSkinRuntime, isFixedSkinWorkbench, startFixedSkinWorkbench } from './workbench/fixedSkinWorkbench';
import { isSkinWorkbench, startSkinWorkbench } from './workbench/skinWorkbench';
import type { Direction, GameAction, GameServerMessage, GameState } from './protocol/types';

const GAME2_SESSION_QUERY_PARAMS = [
  'fixture',
  'skin',
  'ui',
  'fixed_skin',
  'profile',
  'skin_tags',
  'skin_mood',
  'skin_palette'
];

interface RuntimeUi {
  scene: RogueScene;
  render(state: GameState): void;
  setActionPending(pending: boolean): void;
  setConnectionStatus(status: string): void;
  addLog(message: string): void;
  destroy(): void;
}

const activeSkin = getSkinFromLocation();
applySkin(activeSkin);

if (isFixedSkinWorkbench()) {
  startFixedSkinWorkbench(activeSkin);
} else if (isSkinWorkbench()) {
  startSkinWorkbench(activeSkin);
} else {
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
      document.body.innerHTML = '<div class="fatal">Creating session from game id...</div>';
      throw new Error('Redirecting to create a session from game id');
    }

    document.body.innerHTML = '<div class="fatal">Missing game session id. Open /game2/&lt;session_id&gt;.</div>';
    throw new Error('Missing game session id');
  }

  let currentState: GameState | null = null;
  let actionPending = false;
  let nextClientActionId = 1;
  let pendingActionId: number | null = null;
  const ui = isFixedSkinRuntime() && activeSkin.fixedProfiles
    ? createFixedSkinRuntime(activeSkin, handleUserAction)
    : createResponsiveRuntimeUi(activeSkin, handleUserAction);

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

  function isGameplayAction(action: GameAction): boolean {
    return action.action !== 'get_initial_state';
  }

  socket.connect();

  window.addEventListener('beforeunload', () => {
    socket.close();
    ui.destroy();
  });
}

function createResponsiveRuntimeUi(skin: GameSkin, onAction: (action: GameAction) => void): RuntimeUi {
  const scene = new RogueScene(skin.map);
  const canvasParent = document.getElementById('game-canvas');
  const initialWidth = Math.max(320, canvasParent?.clientWidth ?? 960);
  const initialHeight = Math.max(240, canvasParent?.clientHeight ?? 640);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: skin.map.canvasBackground,
    scale: {
      mode: Phaser.Scale.NONE,
      parent: 'game-canvas',
      width: initialWidth,
      height: initialHeight
    },
    render: {
      antialias: false,
      pixelArt: true
    },
    scene
  });
  const hud = new HudController(onAction);
  let resizeObserver: ResizeObserver | null = null;

  if (canvasParent) {
    resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width > 0 && height > 0) {
        game.scale.resize(width, height);
      }
    });
    resizeObserver.observe(canvasParent);
  }

  return {
    scene,
    render(state: GameState): void {
      scene.renderGameState(state);
      hud.render(state);
    },
    setActionPending(pending: boolean): void {
      hud.setActionPending(pending);
    },
    setConnectionStatus(status: string): void {
      hud.setConnectionStatus(status);
    },
    addLog(message: string): void {
      hud.addLog(message);
    },
    destroy(): void {
      resizeObserver?.disconnect();
      game.destroy(false);
    }
  };
}

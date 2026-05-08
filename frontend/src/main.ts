import Phaser from 'phaser';
import './styles.css';
import { RogueScene } from './game/RogueScene';
import { GameSocketClient } from './protocol/socketClient';
import { getBackendOrigin, getGeneratorIdFromLocation, getSessionIdFromLocation } from './protocol/session';
import { applySkin } from './skins/applySkin';
import { getSkinFromLocation } from './skins/registry';
import { HudController } from './ui/hud';
import type { Direction, GameAction, GameServerMessage, GameState } from './protocol/types';

const sessionId = getSessionIdFromLocation();

if (!sessionId) {
  const generatorId = getGeneratorIdFromLocation();
  if (generatorId) {
    const gameUrl = new URL('/game2', getBackendOrigin());
    gameUrl.searchParams.set('game_id', generatorId);
    const currentParams = new URLSearchParams(window.location.search);
    for (const paramName of ['fixture', 'skin']) {
      const paramValue = currentParams.get(paramName);
      if (paramValue) {
        gameUrl.searchParams.set(paramName, paramValue);
      }
    }
    window.location.replace(gameUrl.toString());
    document.body.innerHTML = '<div class="fatal">Creating session from game id...</div>';
    throw new Error('Redirecting to create a session from game id');
  }

  document.body.innerHTML = '<div class="fatal">Missing game session id. Open /game2/&lt;session_id&gt;.</div>';
  throw new Error('Missing game session id');
}

const activeSkin = getSkinFromLocation();
applySkin(activeSkin);

const scene = new RogueScene(activeSkin.map);
const canvasParent = document.getElementById('game-canvas');
const initialWidth = Math.max(320, canvasParent?.clientWidth ?? 960);
const initialHeight = Math.max(240, canvasParent?.clientHeight ?? 640);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  backgroundColor: activeSkin.map.canvasBackground,
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

if (canvasParent) {
  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width);
    const height = Math.floor(entry.contentRect.height);
    if (width > 0 && height > 0) {
      game.scale.resize(width, height);
    }
  });
  resizeObserver.observe(canvasParent);

  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
  });
}

let currentState: GameState | null = null;
let actionPending = false;
let nextClientActionId = 1;
let pendingActionId: number | null = null;

const socket = new GameSocketClient(sessionId, {
  onOpen() {
    hud.setConnectionStatus('online');
  },
  onClose() {
    actionPending = false;
    hud.setActionPending(false);
    hud.setConnectionStatus('closed');
  },
  onError() {
    actionPending = false;
    hud.setActionPending(false);
    hud.setConnectionStatus('error');
  },
  onMessage(message) {
    handleServerMessage(message);
  }
});

const hud = new HudController((action) => {
  if (actionPending && action.action !== 'restart') {
    return;
  }

  const actionToSend = attachClientActionId(action);
  const optimistic = applyOptimisticAction(action);
  if (isGameplayAction(action)) {
    actionPending = true;
    pendingActionId = actionToSend.client_action_id ?? null;
    hud.setActionPending(true);
    hud.setConnectionStatus(optimistic ? 'revealing' : 'thinking');
    if (action.action === 'run') {
      hud.addLog('Trying to break away...');
    }
  }

  socket.send(actionToSend);
});

function handleServerMessage(message: GameServerMessage): void {
  switch (message.type) {
    case 'connection_established':
      hud.setConnectionStatus('ready');
      socket.send({ action: 'get_initial_state' });
      break;
    case 'status':
      actionPending = false;
      hud.setActionPending(false);
      hud.setConnectionStatus(message.status);
      hud.addLog(message.message);
      if (message.status === 'ready') {
        socket.send({ action: 'get_initial_state' });
      }
      break;
    case 'error':
      actionPending = false;
      hud.setActionPending(false);
      hud.setConnectionStatus('error');
      hud.addLog(message.message);
      break;
    case 'update':
      if (isStaleActionResponse(message)) {
        return;
      }
      actionPending = false;
      pendingActionId = null;
      hud.setActionPending(false);
      currentState = message.state;
      scene.renderGameState(message.state);
      hud.render(message.state);
      hud.setConnectionStatus('ready');
      if (message.description) {
        hud.addLog(message.description);
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

  scene.renderGameState(nextState);
  hud.render(nextState);
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
  game.destroy(false);
});

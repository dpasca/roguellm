import Phaser from 'phaser';
import './styles.css';
import { RogueScene } from './game/RogueScene';
import { GameSocketClient } from './protocol/socketClient';
import { getBackendOrigin, getGeneratorIdFromLocation, getSessionIdFromLocation } from './protocol/session';
import { HudController } from './ui/hud';
import type { GameServerMessage } from './protocol/types';

const sessionId = getSessionIdFromLocation();

if (!sessionId) {
  const generatorId = getGeneratorIdFromLocation();
  if (generatorId) {
    const gameUrl = new URL('/game2', getBackendOrigin());
    gameUrl.searchParams.set('game_id', generatorId);
    window.location.replace(gameUrl.toString());
    document.body.innerHTML = '<div class="fatal">Creating session from game id...</div>';
    throw new Error('Redirecting to create a session from game id');
  }

  document.body.innerHTML = '<div class="fatal">Missing game session id. Open /game2/&lt;session_id&gt;.</div>';
  throw new Error('Missing game session id');
}

const scene = new RogueScene();
const canvasParent = document.getElementById('game-canvas');
const initialWidth = Math.max(320, canvasParent?.clientWidth ?? 960);
const initialHeight = Math.max(240, canvasParent?.clientHeight ?? 640);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  backgroundColor: '#0e1014',
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

const socket = new GameSocketClient(sessionId, {
  onOpen() {
    hud.setConnectionStatus('online');
  },
  onClose() {
    hud.setConnectionStatus('closed');
  },
  onError() {
    hud.setConnectionStatus('error');
  },
  onMessage(message) {
    handleServerMessage(message);
  }
});

const hud = new HudController((action) => socket.send(action));

function handleServerMessage(message: GameServerMessage): void {
  switch (message.type) {
    case 'connection_established':
      hud.setConnectionStatus('ready');
      socket.send({ action: 'get_initial_state' });
      break;
    case 'status':
      hud.setConnectionStatus(message.status);
      hud.addLog(message.message);
      if (message.status === 'ready') {
        socket.send({ action: 'get_initial_state' });
      }
      break;
    case 'error':
      hud.setConnectionStatus('error');
      hud.addLog(message.message);
      break;
    case 'update':
      scene.renderGameState(message.state);
      hud.render(message.state);
      if (message.description) {
        hud.addLog(message.description);
      }
      break;
  }
}

socket.connect();

window.addEventListener('beforeunload', () => {
  socket.close();
  game.destroy(false);
});

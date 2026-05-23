import Phaser from 'phaser';
import { RogueScene } from '../game/RogueScene';
import type { GameSkin } from '../skins/types';
import { HudController } from '../ui/hud';
import { applyWorkbenchAction, createWorkbenchState, WORKBENCH_LOGS } from './workbenchFixtures';

export function isSkinWorkbench(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('workbench') === 'skin' || params.get('bench') === 'skin';
}

export function startSkinWorkbench(skin: GameSkin): void {
  document.body.classList.add('workbench-mode');
  document.body.dataset.workbench = 'skin';

  let currentState = createWorkbenchState();
  const scene = new RogueScene(skin.map);
  const game = createWorkbenchGame(scene, skin);
  const hud = new HudController((action) => {
    currentState = applyWorkbenchAction(currentState, action);
    renderAll();
  });

  for (const message of WORKBENCH_LOGS) {
    hud.addLog(message);
  }

  renderAll();

  window.addEventListener('beforeunload', () => {
    game.destroy(false);
  });

  function renderAll(): void {
    scene.renderGameState(currentState);
    hud.render(currentState);
    hud.setConnectionStatus('bench');
  }
}

function createWorkbenchGame(scene: RogueScene, skin: GameSkin): Phaser.Game {
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

  return game;
}

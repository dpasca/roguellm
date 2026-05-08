import type { GameSkin } from './types';

export const neoTokyoConsoleSkin: GameSkin = {
  id: 'neo-tokyo-console',
  name: 'Neo Tokyo Console',
  className: 'skin-neo-tokyo-console',
  tags: ['cyberpunk', 'city', 'neon', 'technology', 'crime', 'modern'],
  mood: ['dense', 'electric', 'urban', 'tactical'],
  map: {
    canvasBackground: '#070b0d',
    exploredTileScale: 0.78,
    unexploredTileScale: 0.28,
    exploredTileStroke: 0x30414a,
    unexploredTileStroke: 0x172025,
    unexploredTileOverlay: 0x071014,
    unexploredTileOverlayAlpha: 0.42,
    playerMarker: 0x8cff8d,
    defeatedPlayerMarker: 0xff4f61,
    victoryPlayerMarker: 0xffc857
  }
};

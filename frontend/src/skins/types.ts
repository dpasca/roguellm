export interface SkinMapPalette {
  canvasBackground: string;
  exploredTileScale: number;
  unexploredTileScale: number;
  exploredTileStroke: number;
  unexploredTileStroke: number;
  unexploredTileOverlay: number;
  unexploredTileOverlayAlpha: number;
  playerMarker: number;
  defeatedPlayerMarker: number;
  victoryPlayerMarker: number;
}

export interface FixedSkinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FixedSkinButtonState = 'idle' | 'hover' | 'pressed' | 'disabled';

export interface FixedSkinButton {
  rect: FixedSkinRect;
  label: string;
  icon?: string;
  hideLabel?: boolean;
  states: Record<FixedSkinButtonState, string>;
}

export type FixedSkinIndicatorState = 'ready' | 'thinking' | 'error' | 'offline' | 'on' | 'off';

export interface FixedSkinIndicator {
  rect: FixedSkinRect;
  states: Partial<Record<FixedSkinIndicatorState, string>>;
}

export interface FixedSkinProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  background: string;
  regions: {
    map: FixedSkinRect;
    title: FixedSkinRect;
    latest: FixedSkinRect;
    log: FixedSkinRect;
    playerHp: FixedSkinRect;
    playerHpFill: FixedSkinRect;
    playerStats: FixedSkinRect;
    combat: FixedSkinRect;
    enemyHpFill: FixedSkinRect;
  };
  buttons: {
    attack: FixedSkinButton;
    run: FixedSkinButton;
    log: FixedSkinButton;
    moveN: FixedSkinButton;
    moveS: FixedSkinButton;
    moveE: FixedSkinButton;
    moveW: FixedSkinButton;
  };
  indicators: {
    status: FixedSkinIndicator;
    combatLed: FixedSkinIndicator;
  };
}

export interface GameSkin {
  id: string;
  name: string;
  className: string;
  tags: string[];
  mood: string[];
  map: SkinMapPalette;
  fixedProfiles?: FixedSkinProfile[];
}

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

export type FixedSkinProfileKind = 'mobilePortrait' | 'mobileCompact' | 'desktopWide';

export type FixedSkinButtonState = 'idle' | 'hover' | 'pressed' | 'disabled';

export interface FixedSkinButton {
  rect: FixedSkinRect;
  label: string;
  icon?: string;
  hideLabel?: boolean;
  states: Record<FixedSkinButtonState, string>;
}

export type FixedSkinMaterialKind = 'panel' | 'lcd' | 'button';
export type FixedSkinMaterialRenderMode = 'tinted' | 'source';

export interface FixedSkinMaterial {
  fill: string;
  frame: string;
  slice: number;
  renderMode?: FixedSkinMaterialRenderMode;
}

export interface FixedSkinRenderTheme {
  primary: number;
  primaryText: string;
  primaryDimText: string;
  secondary: number;
  secondaryText: string;
  lcdFill: number;
  panelFill: number;
  controlFrame: number;
  buttonFrame: number;
  titleText: string;
  bodyText: string;
  mutedText: string;
  combat: number;
  combatText: string;
}

export type FixedSkinStatSlotId = 'attack' | 'defense' | 'xp' | 'tile';

export interface FixedSkinRuntimeStatSlot {
  id: FixedSkinStatSlotId;
  label: string;
  labelRect: FixedSkinRect;
  valueRect: FixedSkinRect;
}

export interface FixedSkinRuntimeLayout {
  title: {
    brand?: FixedSkinRect;
    playerIcon: FixedSkinRect;
    gameTitle: FixedSkinRect;
  };
  latest: {
    label: FixedSkinRect;
    message: FixedSkinRect;
  };
  player: {
    hpLabel: FixedSkinRect;
    hpValue: FixedSkinRect;
    stats: FixedSkinRuntimeStatSlot[];
  };
  combat: {
    mode: FixedSkinRect;
    exploreText: FixedSkinRect;
    enemyIcon: FixedSkinRect;
    enemyName: FixedSkinRect;
    enemyHpValue: FixedSkinRect;
  };
  drawers: {
    log: {
      header: FixedSkinRect;
      rowLabel: FixedSkinRect;
      rowText: FixedSkinRect;
      rowHeight: number;
    };
    inventory: {
      header: FixedSkinRect;
      rowPanel: FixedSkinRect;
      rowBadge: FixedSkinRect;
      rowText: FixedSkinRect;
      rowMeta: FixedSkinRect;
      rowAction: FixedSkinRect;
      rowHeight: number;
      emptyBox: FixedSkinRect;
      emptyTitle: FixedSkinRect;
      emptyBody: FixedSkinRect;
    };
  };
}

export type FixedSkinIndicatorState = 'ready' | 'thinking' | 'error' | 'offline' | 'on' | 'off';

export interface FixedSkinIndicator {
  rect: FixedSkinRect;
  states: Partial<Record<FixedSkinIndicatorState, string>>;
}

export type FixedSkinProfileRole = 'default' | 'variant' | 'prototype' | 'legacy';

export interface FixedSkinProfileMeta {
  family: string;
  role: FixedSkinProfileRole;
  tags: string[];
  mood: string[];
  palette: string[];
  defaultPriority: number;
  generation?: string;
}

export interface FixedSkinProfile {
  id: string;
  label: string;
  meta?: FixedSkinProfileMeta;
  kind: FixedSkinProfileKind;
  width: number;
  height: number;
  background: string;
  materials: Record<FixedSkinMaterialKind, FixedSkinMaterial>;
  renderTheme?: FixedSkinRenderTheme;
  runtime?: FixedSkinRuntimeLayout;
  regions: {
    map: FixedSkinRect;
    title: FixedSkinRect;
    latest: FixedSkinRect;
    log: FixedSkinRect;
    playerHp: FixedSkinRect;
    playerHpFill: FixedSkinRect;
    playerStats: FixedSkinRect;
    combat: FixedSkinRect;
    controls?: FixedSkinRect;
    enemyHpFill: FixedSkinRect;
    endState?: FixedSkinRect;
    inventory?: FixedSkinRect;
  };
  buttons: {
    attack: FixedSkinButton;
    run: FixedSkinButton;
    log: FixedSkinButton;
    moveN: FixedSkinButton;
    moveS: FixedSkinButton;
    moveE: FixedSkinButton;
    moveW: FixedSkinButton;
    restart?: FixedSkinButton;
    inventory?: FixedSkinButton;
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

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

export interface GameSkin {
  id: string;
  name: string;
  className: string;
  tags: string[];
  mood: string[];
  map: SkinMapPalette;
}

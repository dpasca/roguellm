import Phaser from 'phaser';
import type { GameState } from '../protocol/types';
import { parseHexColor, scaleRgb } from './color';
import { IconOverlay } from './IconOverlay';
import type { SkinMapPalette } from '../skins/types';

interface MapLayout {
  originX: number;
  originY: number;
  tileSize: number;
}

export class RogueScene extends Phaser.Scene {
  private state: GameState | null = null;
  private mapGraphics?: Phaser.GameObjects.Graphics;
  private markerGraphics?: Phaser.GameObjects.Graphics;
  private labelLayer?: Phaser.GameObjects.Container;
  private iconOverlay?: IconOverlay;
  private layout: MapLayout = { originX: 24, originY: 24, tileSize: 48 };

  constructor(private readonly mapSkin: SkinMapPalette) {
    super('RogueScene');
  }

  create(): void {
    this.mapGraphics = this.add.graphics();
    this.markerGraphics = this.add.graphics();
    this.labelLayer = this.add.container(0, 0);
    const parent = document.getElementById('game-canvas');
    if (parent) {
      this.iconOverlay = new IconOverlay(parent);
    }
    this.scale.on('resize', () => this.redraw());
    this.redraw();
    this.events.emit('scene-ready');
  }

  renderGameState(state: GameState): void {
    this.state = state;
    this.redraw();
  }

  private redraw(): void {
    if (!this.state || !this.mapGraphics || !this.markerGraphics || !this.labelLayer) {
      return;
    }

    this.layout = this.calculateLayout(this.state);
    this.mapGraphics.clear();
    this.markerGraphics.clear();
    this.labelLayer.removeAll(true);

    this.drawTiles(this.state);
    this.drawPlayerMarker(this.state);
    this.iconOverlay?.render(this.state, this.layout);
  }

  private calculateLayout(state: GameState): MapLayout {
    const width = this.scale.width;
    const height = this.scale.height;
    const padding = width <= 640 ? 8 : 24;
    const maxTileWidth = Math.floor((width - padding * 2) / state.map_width);
    const maxTileHeight = Math.floor((height - padding * 2) / state.map_height);
    const tileSize = Math.max(24, Math.min(72, maxTileWidth, maxTileHeight));
    const mapWidth = tileSize * state.map_width;
    const mapHeight = tileSize * state.map_height;

    return {
      originX: Math.floor((width - mapWidth) / 2),
      originY: width <= 640 ? padding : Math.floor((height - mapHeight) / 2),
      tileSize
    };
  }

  private drawTiles(state: GameState): void {
    if (!this.mapGraphics || !this.labelLayer) {
      return;
    }

    const { originX, originY, tileSize } = this.layout;

    for (let y = 0; y < state.map_height; y += 1) {
      for (let x = 0; x < state.map_width; x += 1) {
        const cell = state.cell_types[y]?.[x];
        const explored = state.explored[y]?.[x] ?? false;
        const baseColor = parseHexColor(cell?.map_color);
        const fillColor = scaleRgb(baseColor, explored ? this.mapSkin.exploredTileScale : this.mapSkin.unexploredTileScale);
        const strokeColor = explored ? this.mapSkin.exploredTileStroke : this.mapSkin.unexploredTileStroke;
        const tileX = originX + x * tileSize;
        const tileY = originY + y * tileSize;

        this.mapGraphics.fillStyle(fillColor, 1);
        this.mapGraphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        this.mapGraphics.lineStyle(1, strokeColor, 1);
        this.mapGraphics.strokeRect(tileX + 0.5, tileY + 0.5, tileSize - 1, tileSize - 1);

        if (!explored) {
          this.mapGraphics.fillStyle(this.mapSkin.unexploredTileOverlay, this.mapSkin.unexploredTileOverlayAlpha);
          this.mapGraphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        }
      }
    }
  }

  private drawPlayerMarker(state: GameState): void {
    if (!this.markerGraphics) {
      return;
    }

    const [x, y] = state.player_pos;
    const { originX, originY, tileSize } = this.layout;
    const tileX = originX + x * tileSize;
    const tileY = originY + y * tileSize;
    const inset = Math.max(2, Math.floor(tileSize * 0.08));
    const lineWidth = Math.max(2, Math.floor(tileSize * 0.06));
    const cornerSize = Math.max(7, Math.floor(tileSize * 0.22));
    const color = state.game_over || state.player_hp <= 0
      ? this.mapSkin.defeatedPlayerMarker
      : state.game_won
        ? this.mapSkin.victoryPlayerMarker
        : this.mapSkin.playerMarker;

    this.markerGraphics.lineStyle(lineWidth, color, 0.95);
    this.markerGraphics.strokeRect(
      tileX + inset + 0.5,
      tileY + inset + 0.5,
      tileSize - inset * 2 - 1,
      tileSize - inset * 2 - 1
    );

    this.markerGraphics.fillStyle(color, 0.95);
    this.markerGraphics.fillRect(
      tileX + tileSize - inset - cornerSize,
      tileY + tileSize - inset - lineWidth,
      cornerSize,
      lineWidth
    );
    this.markerGraphics.fillRect(
      tileX + tileSize - inset - lineWidth,
      tileY + tileSize - inset - cornerSize,
      lineWidth,
      cornerSize
    );
  }
}

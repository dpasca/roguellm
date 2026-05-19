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
        const tileExtent = tileSize - 1;

        this.mapGraphics.fillStyle(scaleRgb(fillColor, explored ? 0.5 : 0.34), 1);
        this.mapGraphics.fillRect(tileX, tileY, tileExtent, tileExtent);
        this.mapGraphics.fillStyle(fillColor, explored ? 0.88 : 0.42);
        this.mapGraphics.fillRect(tileX + 2, tileY + 2, Math.max(1, tileExtent - 4), Math.max(1, tileExtent - 4));
        this.drawTileMatrix(tileX, tileY, tileSize, baseColor, explored, x, y);
        this.drawTileBevel(tileX, tileY, tileExtent, strokeColor, baseColor, explored);

        if (!explored) {
          this.mapGraphics.fillStyle(this.mapSkin.unexploredTileOverlay, this.mapSkin.unexploredTileOverlayAlpha);
          this.mapGraphics.fillRect(tileX, tileY, tileExtent, tileExtent);
        }
      }
    }
  }

  private drawTileMatrix(
    tileX: number,
    tileY: number,
    tileSize: number,
    baseColor: number,
    explored: boolean,
    mapX: number,
    mapY: number
  ): void {
    if (!this.mapGraphics) {
      return;
    }

    const inset = Math.max(4, Math.floor(tileSize * 0.12));
    const step = Math.max(5, Math.floor(tileSize * 0.13));
    const dotSize = Math.max(1, Math.floor(tileSize * 0.035));
    const dotColor = scaleRgb(baseColor, explored ? 1.55 : 0.88);
    const sparkColor = scaleRgb(baseColor, explored ? 2.1 : 1.1);
    const dotAlpha = explored ? 0.58 : 0.16;
    const sparkAlpha = explored ? 0.88 : 0.26;

    this.mapGraphics.fillStyle(dotColor, dotAlpha);
    for (let y = tileY + inset; y < tileY + tileSize - inset; y += step) {
      for (let x = tileX + inset; x < tileX + tileSize - inset; x += step) {
        this.mapGraphics.fillRect(x, y, dotSize, dotSize);
      }
    }

    this.mapGraphics.fillStyle(sparkColor, sparkAlpha);
    const sparkCount = explored ? 3 : 1;
    for (let i = 0; i < sparkCount; i += 1) {
      const offsetX = ((mapX * 17 + mapY * 7 + i * 19) % Math.max(1, tileSize - inset * 2));
      const offsetY = ((mapX * 11 + mapY * 23 + i * 13) % Math.max(1, tileSize - inset * 2));
      this.mapGraphics.fillRect(tileX + inset + offsetX, tileY + inset + offsetY, dotSize, dotSize);
    }
  }

  private drawTileBevel(
    tileX: number,
    tileY: number,
    tileExtent: number,
    strokeColor: number,
    baseColor: number,
    explored: boolean
  ): void {
    if (!this.mapGraphics) {
      return;
    }

    this.mapGraphics.lineStyle(1, strokeColor, 1);
    this.mapGraphics.strokeRect(tileX + 0.5, tileY + 0.5, tileExtent, tileExtent);
    this.mapGraphics.lineStyle(1, scaleRgb(baseColor, explored ? 1.45 : 0.72), explored ? 0.48 : 0.2);
    this.mapGraphics.strokeRect(tileX + 2.5, tileY + 2.5, Math.max(1, tileExtent - 4), Math.max(1, tileExtent - 4));
    this.mapGraphics.lineStyle(1, 0xffffff, explored ? 0.08 : 0.03);
    this.mapGraphics.lineBetween(tileX + 2, tileY + 2, tileX + tileExtent - 2, tileY + 2);
    this.mapGraphics.lineBetween(tileX + 2, tileY + 2, tileX + 2, tileY + tileExtent - 2);
    this.mapGraphics.lineStyle(1, 0x000000, 0.5);
    this.mapGraphics.lineBetween(tileX + 2, tileY + tileExtent - 2, tileX + tileExtent - 2, tileY + tileExtent - 2);
    this.mapGraphics.lineBetween(tileX + tileExtent - 2, tileY + 2, tileX + tileExtent - 2, tileY + tileExtent - 2);
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

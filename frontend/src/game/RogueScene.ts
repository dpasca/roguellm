import Phaser from 'phaser';
import type { GameState } from '../protocol/types';
import { parseHexColor, scaleRgb } from './color';
import { IconOverlay } from './IconOverlay';

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
  private player?: Phaser.GameObjects.Container;
  private playerBody?: Phaser.GameObjects.Arc;
  private iconOverlay?: IconOverlay;
  private layout: MapLayout = { originX: 24, originY: 24, tileSize: 48 };

  constructor() {
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
    this.drawPlayer(this.state);
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
        const fillColor = scaleRgb(baseColor, explored ? 0.72 : 0.32);
        const strokeColor = explored ? 0x45484f : 0x25272d;
        const tileX = originX + x * tileSize;
        const tileY = originY + y * tileSize;

        this.mapGraphics.fillStyle(fillColor, 1);
        this.mapGraphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        this.mapGraphics.lineStyle(1, strokeColor, 1);
        this.mapGraphics.strokeRect(tileX + 0.5, tileY + 0.5, tileSize - 1, tileSize - 1);

        if (!explored) {
          this.mapGraphics.fillStyle(0x11141a, 0.35);
          this.mapGraphics.fillRect(tileX, tileY, tileSize - 1, tileSize - 1);
        }
      }
    }
  }

  private drawPlayer(state: GameState): void {
    const [x, y] = state.player_pos;
    const { tileSize } = this.layout;
    const target = this.tileCenter(x, y);

    if (!this.player) {
      this.player = this.add.container(target.x, target.y).setDepth(20);
      this.playerBody = this.add.circle(0, 0, tileSize * 0.28, 0x6ee56c, 1);
      this.playerBody.setAlpha(0.28);
      this.player.add([this.playerBody]);
      return;
    }

    if (this.playerBody) {
      this.playerBody.setRadius(tileSize * 0.25);
    }

    this.tweens.killTweensOf(this.player);
    this.tweens.add({
      targets: this.player,
      x: target.x,
      y: target.y,
      duration: 160,
      ease: 'Sine.easeOut'
    });
  }

  private tileCenter(x: number, y: number): { x: number; y: number } {
    const { originX, originY, tileSize } = this.layout;
    return {
      x: originX + x * tileSize + tileSize / 2,
      y: originY + y * tileSize + tileSize / 2
    };
  }
}

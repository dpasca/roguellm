import type { GameState } from '../protocol/types';
import { normalizeFontAwesomeClass } from '../ui/icons';

export interface TileLayout {
  originX: number;
  originY: number;
  tileSize: number;
}

type IconSlot = 'cell' | 'item' | 'enemy';

export class IconOverlay {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'map-icon-overlay';
    parent.append(this.root);
  }

  render(state: GameState, layout: TileLayout): void {
    const icons: HTMLElement[] = [];

    for (let y = 0; y < state.map_height; y += 1) {
      for (let x = 0; x < state.map_width; x += 1) {
        if (!state.explored[y]?.[x]) {
          continue;
        }

        const cell = state.cell_types[y]?.[x];
        icons.push(this.createIcon(
          normalizeFontAwesomeClass(cell?.font_awesome_icon, 'fa-solid fa-square'),
          x,
          y,
          layout,
          'cell-map-icon',
          'cell'
        ));
      }
    }

    for (const item of state.item_placements ?? []) {
      if (item.is_collected || !state.explored[item.y]?.[item.x]) {
        continue;
      }

      icons.push(this.createIcon(
        normalizeFontAwesomeClass(item.font_awesome_icon, 'fa-solid fa-box'),
        item.x,
        item.y,
        layout,
        'item-map-icon',
        'item'
      ));
    }

    for (const enemy of state.enemies) {
      if (!state.explored[enemy.y]?.[enemy.x]) {
        continue;
      }

      icons.push(this.createIcon(
        normalizeFontAwesomeClass(enemy.font_awesome_icon, 'fa-solid fa-skull'),
        enemy.x,
        enemy.y,
        layout,
        enemy.is_defeated ? 'enemy-map-icon defeated' : 'enemy-map-icon',
        'enemy'
      ));
    }

    this.root.replaceChildren(...icons);
  }

  private createIcon(
    iconClass: string,
    x: number,
    y: number,
    layout: TileLayout,
    extraClass: string,
    slot: IconSlot
  ): HTMLElement {
    const icon = document.createElement('i');
    icon.className = `${iconClass} ${extraClass}`;
    const { offsetX, offsetY, scale } = iconSlotLayout(slot);
    const centerX = layout.originX + x * layout.tileSize + layout.tileSize * (0.5 + offsetX);
    const centerY = layout.originY + y * layout.tileSize + layout.tileSize * (0.5 + offsetY);

    icon.style.left = `${centerX}px`;
    icon.style.top = `${centerY}px`;
    icon.style.fontSize = `${Math.max(10, Math.floor(layout.tileSize * scale))}px`;
    icon.dataset.mapX = String(x);
    icon.dataset.mapY = String(y);
    icon.dataset.mapRole = slot;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
}

function iconSlotLayout(slot: IconSlot): { offsetX: number; offsetY: number; scale: number } {
  switch (slot) {
    case 'item':
      return { offsetX: 0.22, offsetY: 0.22, scale: 0.32 };
    case 'enemy':
      return { offsetX: 0.22, offsetY: -0.22, scale: 0.34 };
    case 'cell':
    default:
      return { offsetX: 0, offsetY: 0, scale: 0.42 };
  }
}

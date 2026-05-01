import type { Direction, GameAction, GameState, Item } from '../protocol/types';
import { normalizeFontAwesomeClass } from './icons';

type SendAction = (action: GameAction) => void;

const movementButtons: Record<Direction, string> = {
  n: 'move-n',
  s: 'move-s',
  e: 'move-e',
  w: 'move-w'
};

export class HudController {
  private logs: string[] = [];
  private currentState: GameState | null = null;

  constructor(private readonly sendAction: SendAction) {
    this.bindControls();
    this.bindKeyboard();
  }

  setConnectionStatus(status: string): void {
    this.setText('connection-status', status);
  }

  addLog(message: string): void {
    if (!message.trim()) {
      return;
    }

    this.logs.push(message);
    this.logs = this.logs.slice(-40);
    const log = this.requireElement('game-log');
    log.replaceChildren(
      ...this.logs.map((entry) => {
        const row = document.createElement('p');
        row.textContent = entry;
        return row;
      })
    );
    log.scrollTop = log.scrollHeight;
  }

  render(state: GameState): void {
    this.currentState = state;
    document.body.classList.toggle('in-combat', state.in_combat);
    this.setText('game-title', state.game_title || 'RogueLLM');
    this.requireElement('player-icon').className = normalizeFontAwesomeClass(
      state.player.font_awesome_icon,
      'fa-solid fa-user'
    );
    this.setText('player-hp', `${state.player_hp}/${state.player_max_hp}`);
    this.setText('player-attack', String(state.player_attack));
    this.setText('player-defense', String(state.player_defense));
    this.setText('player-xp', String(state.player_xp));
    this.setText('player-location', this.getCurrentLocationName(state));
    this.setMeter('player-hp-meter', state.player_hp, state.player_max_hp);
    this.renderCombat(state);
    this.renderInventory(state.inventory);
    this.updateControlState(state);
  }

  private bindControls(): void {
    for (const [direction, id] of Object.entries(movementButtons) as [Direction, string][]) {
      this.requireButton(id).addEventListener('click', () => {
        this.sendAction({ action: 'move', direction });
      });
    }

    this.requireButton('attack').addEventListener('click', () => {
      this.sendAction({ action: 'attack' });
    });

    this.requireButton('run').addEventListener('click', () => {
      this.sendAction({ action: 'run' });
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.repeat || !this.currentState || this.currentState.in_combat) {
        return;
      }

      const direction = this.directionFromKey(event.key);
      if (!direction || !this.canMove(this.currentState, direction)) {
        return;
      }

      event.preventDefault();
      this.sendAction({ action: 'move', direction });
    });
  }

  private renderCombat(state: GameState): void {
    const panel = this.requireElement('combat-panel');
    this.requireElement('movement-lock').hidden = !state.in_combat;
    panel.hidden = !state.in_combat || !state.current_enemy;

    if (!state.current_enemy) {
      return;
    }

    this.setText('enemy-name', state.current_enemy.name);
    this.setText('enemy-hp', `${state.current_enemy.hp}/${state.current_enemy.max_hp}`);
    this.setMeter('enemy-hp-meter', state.current_enemy.hp, state.current_enemy.max_hp);
  }

  private renderInventory(items: Item[]): void {
    const list = this.requireElement('inventory-list');

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Empty';
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement('div');
        row.className = item.is_equipped ? 'inventory-item equipped' : 'inventory-item';

        const content = document.createElement('div');
        const icon = document.createElement('i');
        icon.className = normalizeFontAwesomeClass(
          item.type === 'weapon' ? 'fa-solid fa-gavel' : item.type === 'armor' ? 'fa-solid fa-shield-halved' : 'fa-solid fa-flask',
          'fa-solid fa-box'
        );
        const name = document.createElement('strong');
        name.textContent = item.name;
        const desc = document.createElement('span');
        desc.textContent = item.description;
        content.append(icon, name, desc);

        const action = document.createElement('button');
        action.type = 'button';

        if (item.type === 'consumable') {
          action.textContent = 'Use';
          action.addEventListener('click', () => this.sendAction({ action: 'use_item', item_id: item.id }));
        } else if (item.type === 'weapon' || item.type === 'armor') {
          action.textContent = item.is_equipped ? 'On' : 'Equip';
          action.addEventListener('click', () => this.sendAction({ action: 'equip_item', item_id: item.id }));
        } else {
          action.textContent = item.type;
          action.disabled = true;
        }

        row.append(content, action);
        return row;
      })
    );
  }

  private updateControlState(state: GameState): void {
    for (const [direction, id] of Object.entries(movementButtons) as [Direction, string][]) {
      this.requireButton(id).disabled = state.in_combat || !this.canMove(state, direction);
    }

    this.requireButton('attack').disabled = !state.in_combat || state.game_over || state.game_won;
    this.requireButton('run').disabled = !state.in_combat || state.game_over || state.game_won;
  }

  private canMove(state: GameState, direction: Direction): boolean {
    const [x, y] = state.player_pos;
    if (state.game_over || state.game_won) {
      return false;
    }

    switch (direction) {
      case 'n':
        return y > 0;
      case 's':
        return y < state.map_height - 1;
      case 'w':
        return x > 0;
      case 'e':
        return x < state.map_width - 1;
    }
  }

  private directionFromKey(key: string): Direction | null {
    switch (key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        return 'n';
      case 'ArrowDown':
      case 's':
      case 'S':
        return 's';
      case 'ArrowLeft':
      case 'a':
      case 'A':
        return 'w';
      case 'ArrowRight':
      case 'd':
      case 'D':
        return 'e';
      default:
        return null;
    }
  }

  private getCurrentLocationName(state: GameState): string {
    const [x, y] = state.player_pos;
    return state.cell_types[y]?.[x]?.name ?? `${x}, ${y}`;
  }

  private setMeter(id: string, value: number, max: number): void {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    this.requireElement(id).style.width = `${pct}%`;
  }

  private setText(id: string, text: string): void {
    this.requireElement(id).textContent = text;
  }

  private requireButton(id: string): HTMLButtonElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Missing button #${id}`);
    }
    return element;
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element;
  }
}

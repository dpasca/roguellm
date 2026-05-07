export type Direction = 'n' | 's' | 'e' | 'w';

export interface ActionEnvelope {
  client_action_id?: number;
}

export type GameAction =
  | ({ action: 'get_initial_state' } & ActionEnvelope)
  | ({ action: 'move'; direction: Direction } & ActionEnvelope)
  | ({ action: 'attack' } & ActionEnvelope)
  | ({ action: 'run' } & ActionEnvelope)
  | ({ action: 'use_item'; item_id: string } & ActionEnvelope)
  | ({ action: 'equip_item'; item_id: string } & ActionEnvelope)
  | ({ action: 'restart' } & ActionEnvelope);

export interface CellType {
  id?: string;
  name: string;
  description?: string;
  map_color: string;
  font_awesome_icon?: string;
}

export interface Item {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'consumable' | string;
  effect: Record<string, number>;
  is_equipped: boolean;
  description: string;
}

export interface Equipment {
  weapon: Item | null;
  armor: Item | null;
}

export interface Enemy {
  id: string;
  name: string;
  hp: number;
  max_hp: number;
  attack: number;
  defense?: number;
  font_awesome_icon?: string;
  weapons?: string[];
}

export interface EnemyMarker {
  id: string;
  x: number;
  y: number;
  name: string;
  font_awesome_icon?: string;
  is_defeated: boolean;
}

export interface ItemPlacement {
  id: string;
  x: number;
  y: number;
  name: string;
  font_awesome_icon?: string;
  is_collected?: boolean;
}

export interface PlayerDef {
  name?: string;
  font_awesome_icon?: string;
}

export interface GameState {
  cell_types: CellType[][];
  map_width: number;
  map_height: number;
  player: PlayerDef;
  player_pos: [number, number];
  player_pos_prev: [number, number];
  player_hp: number;
  player_max_hp: number;
  player_attack: number;
  player_defense: number;
  player_xp: number;
  inventory: Item[];
  equipment: Equipment;
  explored: boolean[][];
  in_combat: boolean;
  current_enemy: Enemy | null;
  enemies: EnemyMarker[];
  defeated_enemies: EnemyMarker[];
  item_placements?: ItemPlacement[];
  game_over: boolean;
  game_won: boolean;
  temporary_effects: Record<string, unknown>;
  game_title: string;
  model_name?: string;
}

export type GameServerMessage =
  | { type: 'connection_established'; generator_id?: string }
  | { type: 'status'; message: string; status: 'creating' | 'ready' | 'error' | string }
  | { type: 'error'; message: string }
  | {
      type: 'update';
      state: GameState;
      description_raw?: string;
      description?: string;
      generator_id?: string;
      response_action?: GameAction['action'];
      client_action_id?: number;
    };

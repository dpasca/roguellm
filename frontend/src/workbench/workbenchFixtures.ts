import type { Direction, GameAction, GameState } from '../protocol/types';

export const WORKBENCH_LOGS = [
  'Rain beads across the deck glass as the alley grid wakes, each shrine marker blinking through the static.',
  'Your tonfa hums under the counterlight; the raincoat weave answers with a dull armored shimmer.',
  'A vendor relay coughs up a pocket stim, still warm from the vending slot and buzzing with borrowed voltage.',
  'Somewhere past the shrine gate, the Chrome Oni Enforcer drags one metal claw along the wet concrete.',
  'A low archive tone marks older entries below the rail, still readable when you open the full deck log.'
];

export function applyWorkbenchAction(state: GameState, action: GameAction): GameState {
  switch (action.action) {
    case 'attack':
      return {
        ...state,
        current_enemy: state.current_enemy
          ? {
              ...state.current_enemy,
              hp: Math.max(1, state.current_enemy.hp - 9)
            }
          : state.current_enemy
      };
    case 'run':
      return {
        ...state,
        in_combat: false,
        current_enemy: null,
        player_pos_prev: state.player_pos,
        player_pos: [5, 3]
      };
    case 'restart':
      return createWorkbenchState();
    case 'move':
      return moveWorkbenchPlayer(state, action.direction);
    case 'equip_item':
      return {
        ...state,
        inventory: state.inventory.map((item) => ({
          ...item,
          is_equipped: item.id === action.item_id ? !item.is_equipped : item.is_equipped
        }))
      };
    case 'use_item':
      return {
        ...state,
        player_hp: Math.min(state.player_max_hp, state.player_hp + 18)
      };
    case 'get_initial_state':
      return state;
  }
}

function moveWorkbenchPlayer(state: GameState, direction: Direction): GameState {
  if (state.in_combat || state.game_over || state.game_won) {
    return state;
  }

  const [x, y] = state.player_pos;
  const [nextX, nextY] = nextPosition(x, y, direction);
  if (nextX < 0 || nextX >= state.map_width || nextY < 0 || nextY >= state.map_height) {
    return state;
  }

  const explored = state.explored.map((row) => [...row]);
  explored[nextY][nextX] = true;
  return {
    ...state,
    player_pos_prev: [x, y],
    player_pos: [nextX, nextY],
    explored
  };
}

function nextPosition(x: number, y: number, direction: Direction): [number, number] {
  switch (direction) {
    case 'n':
      return [x, y - 1];
    case 's':
      return [x, y + 1];
    case 'w':
      return [x - 1, y];
    case 'e':
      return [x + 1, y];
  }
}

export function createWorkbenchState(): GameState {
  const cells = createWorkbenchCells();
  const explored = cells.map((row, y) => row.map((_, x) => y < 9 || x < 4 || (x + y) % 4 === 0));

  return {
    cell_types: cells,
    map_width: 10,
    map_height: 10,
    player: {
      name: 'Piedone a Tokyo',
      font_awesome_icon: 'fa-solid fa-user-secret'
    },
    player_pos: [4, 3],
    player_pos_prev: [3, 3],
    player_hp: 37,
    player_max_hp: 100,
    player_attack: 14,
    player_defense: 7,
    player_xp: 125,
    inventory: [
      {
        id: 'bench-tonfa',
        name: 'Neon Tonfa',
        type: 'weapon',
        effect: { attack: 4 },
        is_equipped: true,
        description: '+4 attack, charged baton'
      },
      {
        id: 'bench-coat',
        name: 'Kevlar Raincoat',
        type: 'armor',
        effect: { defense: 3 },
        is_equipped: true,
        description: '+3 defense, rainproof weave'
      },
      {
        id: 'bench-noodle',
        name: 'Pocket Ramen Stim',
        type: 'consumable',
        effect: { hp: 18 },
        is_equipped: false,
        description: 'Heals 18 HP, vending-slot heat'
      }
    ],
    equipment: {
      weapon: null,
      armor: null
    },
    explored,
    in_combat: true,
    current_enemy: {
      id: 'bench-oni',
      name: 'Chrome Oni Enforcer',
      hp: 46,
      max_hp: 82,
      attack: 15,
      defense: 5,
      font_awesome_icon: 'fa-solid fa-mask'
    },
    enemies: [
      {
        id: 'bench-oni',
        x: 4,
        y: 3,
        name: 'Chrome Oni Enforcer',
        font_awesome_icon: 'fa-solid fa-mask',
        is_defeated: false
      },
      {
        id: 'bench-drone',
        x: 7,
        y: 2,
        name: 'Courier Drone',
        font_awesome_icon: 'fa-solid fa-helicopter',
        is_defeated: false
      },
      {
        id: 'bench-brawler',
        x: 2,
        y: 5,
        name: 'Defeated Brawler',
        font_awesome_icon: 'fa-solid fa-skull',
        is_defeated: true
      }
    ],
    defeated_enemies: [
      {
        id: 'bench-brawler',
        x: 2,
        y: 5,
        name: 'Defeated Brawler',
        font_awesome_icon: 'fa-solid fa-skull',
        is_defeated: true
      }
    ],
    item_placements: [
      {
        id: 'bench-medkit',
        x: 1,
        y: 1,
        name: 'Med-Kit',
        font_awesome_icon: 'fa-solid fa-briefcase-medical',
        is_collected: false
      },
      {
        id: 'bench-coin',
        x: 6,
        y: 6,
        name: 'Lucky Coin',
        font_awesome_icon: 'fa-solid fa-coins',
        is_collected: false
      },
      {
        id: 'bench-chip',
        x: 8,
        y: 8,
        name: 'Memory Chip',
        font_awesome_icon: 'fa-solid fa-microchip',
        is_collected: false
      }
    ],
    game_over: false,
    game_won: false,
    temporary_effects: {},
    game_title: 'Neon Shrine Blues',
    model_name: 'workbench'
  };
}

function createWorkbenchCells() {
  const tileSet = [
    { name: 'Neon Arcade Gate', map_color: '#d9421e', font_awesome_icon: 'fa-solid fa-building-columns' },
    { name: 'Rain Alley', map_color: '#123b5d', font_awesome_icon: 'fa-solid fa-cloud-rain' },
    { name: 'Ramen Signal Bar', map_color: '#3b1a13', font_awesome_icon: 'fa-solid fa-bowl-food' },
    { name: 'Zen Circuit Garden', map_color: '#164418', font_awesome_icon: 'fa-solid fa-seedling' },
    { name: 'Signal Blackout', map_color: '#252b31', font_awesome_icon: 'fa-solid fa-tower-broadcast' },
    { name: 'Amber Rail Yard', map_color: '#6d5b00', font_awesome_icon: 'fa-solid fa-train-subway' },
    { name: 'Oni Market', map_color: '#5a1020', font_awesome_icon: 'fa-solid fa-store' },
    { name: 'Glass Hotel', map_color: '#1b4660', font_awesome_icon: 'fa-solid fa-hotel' },
    { name: 'Backroom Shrine', map_color: '#453017', font_awesome_icon: 'fa-solid fa-torii-gate' },
    { name: 'Data Pier', map_color: '#14343c', font_awesome_icon: 'fa-solid fa-satellite-dish' }
  ];

  return Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 10 }, (_, x) => ({
      ...tileSet[(x * 3 + y * 5) % tileSet.length],
      id: `bench-${x}-${y}`
    }))
  );
}

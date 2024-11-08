from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Union

class Enemy(BaseModel):
    name: str
    hp: int
    max_hp: int
    attack: int

class Item(BaseModel):
    id: str
    name: str
    type: str  # 'weapon', 'armor', 'potion'
    effect: Dict[str, int]
    is_equipped: bool = False
    description: str

class Equipment(BaseModel):
    weapon: Optional[Item] = None
    armor: Optional[Item] = None

class GameState(BaseModel):
    cell_types: List[List[dict]] = []
    map_width: int
    map_height: int
    player_pos: tuple = (0, 0)
    player_hp: int
    player_max_hp: int
    player_attack: int
    player_defense: int
    player_xp: int = 0
    inventory: List[Item] = []
    equipment: Equipment = Field(default_factory=Equipment)
    explored: List[List[bool]] = Field(default_factory=list)  # Changed this line
    in_combat: bool = False
    current_enemy: Optional[Enemy] = None
    game_over: bool = False
    temporary_effects: Dict[str, Dict[str, Union[int, int]]] = {}
    game_title: str = "Unknown Game"

    @classmethod
    def from_config(cls, config):
        instance = cls(
            map_width=config['map_size']['width'],
            map_height=config['map_size']['height'],
            player_hp=config['player']['base_hp'],
            player_max_hp=config['player']['max_hp'],
            player_attack=config['player']['base_attack'],
            player_defense=config['player']['base_defense'],
            player_xp=0,
        )
        # Initialize explored array with proper dimensions
        instance.explored = [[False for _ in range(instance.map_width)] 
                           for _ in range(instance.map_height)]
        return instance
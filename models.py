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
    map_width: int
    map_height: int
    player_pos: tuple = (0, 0)
    player_hp: int
    player_max_hp: int
    player_attack: int
    player_defense: int
    inventory: List[Item] = []
    equipment: Equipment = Field(default_factory=Equipment)
    explored: list = []
    in_combat: bool = False
    current_enemy: Optional[Enemy] = None
    game_over: bool = False
    temporary_effects: Dict[str, Dict[str, Union[int, int]]] = {}  # For temporary potion

    @classmethod
    def from_config(cls, config):
        return cls(
            map_width=config['map_size']['width'],
            map_height=config['map_size']['height'],
            player_hp=config['player']['base_hp'],
            player_max_hp=config['player']['max_hp'],
            player_attack=config['player']['base_attack'],
            player_defense=config['player']['base_defense']
        )
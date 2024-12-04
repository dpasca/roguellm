import logging
from typing import List, Dict
from tools.fa_runtime import fa_runtime

logger = logging.getLogger()

class EntityPlacementManager:
    def __init__(self, random_instance, definitions, gen_ai):
        self.random = random_instance
        self.definitions = definitions
        self.gen_ai = gen_ai
        self.enemy_sequence_cnt = 0
        self.item_sequence_cnt = 0
        
        # Default icons
        self.default_enemy_icon = "fa-solid fa-skull"
        self.default_item_icon = "fa-solid fa-box"

    def get_enemy_icon(self, enemy_def: Dict) -> str:
        """Get enemy icon with fallback to default."""
        icon = enemy_def.get('font_awesome_icon', self.default_enemy_icon)
        return fa_runtime.get_valid_icon(icon, "enemy") or self.default_enemy_icon

    def get_item_icon(self, item_def: Dict) -> str:
        """Get item icon with fallback to default."""
        icon = item_def.get('font_awesome_icon', self.default_item_icon)
        return fa_runtime.get_valid_icon(icon, "item") or self.default_item_icon

    def generate_placements(self, cell_types: List[List[Dict]], map_width: int, map_height: int):
        """Generate entity placements for both enemies and items."""
        self.entity_placements = self.gen_ai.gen_entity_placements(
            cell_types,
            self.definitions.enemy_defs,
            self.definitions.item_defs,
            map_width,
            map_height
        )
        logger.info(f"Generated entity placements: {self.entity_placements}")
        return self.entity_placements

    def process_placements(self, game_state):
        """Process the generated entity placements and update the game state."""
        game_state.enemies = []
        game_state.defeated_enemies = []
        game_state.item_placements = []

        for placement in self.entity_placements:
            if placement['type'] == 'enemy':
                enemy_def = next(
                    (e for e in self.definitions.enemy_defs if e['enemy_id'] == placement['entity_id']),
                    None
                )
                if enemy_def:
                    self.enemy_sequence_cnt += 1
                    enemy_id = f"{enemy_def['enemy_id']}_{self.enemy_sequence_cnt}"
                    icon = self.get_enemy_icon(enemy_def)

                    # Check if this enemy was previously defeated (by position)
                    was_defeated = any(
                        de['x'] == placement['x'] and de['y'] == placement['y']
                        for de in game_state.defeated_enemies
                    )

                    # Add to enemies list with proper defeated state
                    enemy = {
                        'x': placement['x'],
                        'y': placement['y'],
                        'name': enemy_def['name'],
                        'id': enemy_id,
                        'font_awesome_icon': icon,
                        'is_defeated': was_defeated
                    }
                    game_state.enemies.append(enemy)

                    # If it was defeated, add to defeated_enemies if not already there
                    if was_defeated and not any(de['id'] == enemy_id for de in game_state.defeated_enemies):
                        game_state.defeated_enemies.append(enemy.copy())
            elif placement['type'] == 'item':
                item_def = next(
                    (i for i in self.definitions.item_defs if i['id'] == placement['entity_id']),
                    None
                )
                if item_def:
                    self.item_sequence_cnt += 1
                    item = {
                        'x': placement['x'],
                        'y': placement['y'],
                        'id': f"{item_def['id']}_{self.item_sequence_cnt}",
                        'name': item_def['name'],
                        'font_awesome_icon': self.get_item_icon(item_def),
                        'is_collected': False
                    }
                    game_state.item_placements.append(item)

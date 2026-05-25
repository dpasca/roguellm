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

    async def generate_placements(self, cell_types: List[List[Dict]], map_width: int, map_height: int):
        """Generate entity placements for both enemies and items."""
        self.entity_placements = await self.gen_ai.gen_entity_placements(
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
        self.entity_placements = self._sanitize_placements(game_state)
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

    def _sanitize_placements(self, game_state) -> List[Dict]:
        """Keep generated placements playable and valid for the current level."""
        sanitized = []
        occupied = set()

        for placement in getattr(self, 'entity_placements', []):
            placement_type = placement.get('type')
            entity_id = placement.get('entity_id')
            x = placement.get('x')
            y = placement.get('y')

            if placement_type not in {'enemy', 'item'} or entity_id is None:
                logger.warning(f"Skipping invalid placement: {placement}")
                continue

            if not isinstance(x, int) or not isinstance(y, int):
                logger.warning(f"Skipping placement with invalid coordinates: {placement}")
                continue

            avoid_start_zone = placement_type == 'enemy'
            needs_relocation = (
                not self._is_inside_map(x, y, game_state)
                or (x, y) in occupied
                or (avoid_start_zone and self._is_in_start_zone(x, y, game_state))
            )

            if needs_relocation:
                replacement = self._find_nearest_open_tile(
                    preferred_x=x,
                    preferred_y=y,
                    game_state=game_state,
                    occupied=occupied,
                    avoid_start_zone=avoid_start_zone
                )
                if replacement is None:
                    logger.warning(f"Skipping placement because no valid tile was found: {placement}")
                    continue
                x, y = replacement

            occupied.add((x, y))
            sanitized.append({
                'type': placement_type,
                'entity_id': entity_id,
                'x': x,
                'y': y
            })

        return sanitized

    def _find_nearest_open_tile(
            self,
            preferred_x: int,
            preferred_y: int,
            game_state,
            occupied: set,
            avoid_start_zone: bool
    ):
        candidates = []

        for y in range(game_state.map_height):
            for x in range(game_state.map_width):
                if (x, y) in occupied:
                    continue
                if avoid_start_zone and self._is_in_start_zone(x, y, game_state):
                    continue

                distance = abs(x - preferred_x) + abs(y - preferred_y)
                start_distance = abs(x - game_state.player_pos[0]) + abs(y - game_state.player_pos[1])
                candidates.append((distance, -start_distance, y, x))

        if not candidates:
            return None

        _, _, y, x = min(candidates)
        return x, y

    def _is_inside_map(self, x: int, y: int, game_state) -> bool:
        return 0 <= x < game_state.map_width and 0 <= y < game_state.map_height

    def _is_in_start_zone(self, x: int, y: int, game_state) -> bool:
        start_x, start_y = game_state.player_pos
        return abs(x - start_x) <= 1 and abs(y - start_y) <= 1

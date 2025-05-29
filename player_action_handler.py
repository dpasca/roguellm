import logging
from typing import Dict, Optional
from models import Item, Enemy
from combat_manager import CombatManager

logger = logging.getLogger()


class PlayerActionHandler:
    """Handles all player actions including movement, item usage, and equipment management."""

    def __init__(self, game_state_manager, combat_manager: CombatManager):
        self.game_state_manager = game_state_manager
        self.combat_manager = combat_manager

    async def handle_move(self, direction: str) -> dict:
        """Handle player movement."""
        if not direction:
            return await self.game_state_manager.create_message("No direction specified!")

        if self.game_state_manager.state.game_won or self.game_state_manager.state.game_over:
            return await self.game_state_manager.create_message("Game is over! Press Restart to play again.")

        # Save previous position
        self.game_state_manager.state.player_pos_prev = self.game_state_manager.state.player_pos
        # Get current position
        x, y = self.game_state_manager.state.player_pos
        moved = True

        if direction == 'n' and y > 0:
            y -= 1
        elif direction == 's' and y < self.game_state_manager.state.map_height - 1:
            y += 1
        elif direction == 'w' and x > 0:
            x -= 1
        elif direction == 'e' and x < self.game_state_manager.state.map_width - 1:
            x += 1
        else:
            moved = False

        if moved:
            self.game_state_manager.state.player_pos = (x, y)
            # Mark the NEW position as explored after moving
            self.game_state_manager.state.explored[y][x] = True
            encounter_result = await self._check_encounters()

            # Process temporary effects
            effects_log = await self._process_temporary_effects()
            if effects_log:
                encounter_result['description_raw'] = effects_log + "\n" + encounter_result['description_raw']

            return encounter_result
        else:
            return await self.game_state_manager.create_message("You can't move in that direction.")

    async def handle_use_item(self, item_id: str) -> dict:
        """Handle using an item from inventory."""
        if not item_id:
            return await self.game_state_manager.create_message("No item specified!")

        # Find the item in inventory
        item = next((item for item in self.game_state_manager.state.inventory if item.id == item_id), None)
        if not item:
            return await self.game_state_manager.create_message("Item not found in inventory!")

        if item.type == 'consumable':
            # Remove the consumable immediately as it will be consumed
            self.game_state_manager.state.inventory = [i for i in self.game_state_manager.state.inventory if i.id != item_id]

            if 'health' in item.effect:
                heal_amount = item.effect['health']
                old_hp = self.game_state_manager.state.player_hp
                self.game_state_manager.state.player_hp = min(self.game_state_manager.state.player_max_hp,
                                        self.game_state_manager.state.player_hp + heal_amount)
                actual_heal = self.game_state_manager.state.player_hp - old_hp
                return await self.game_state_manager.create_message(f"Used {item.name} and restored {actual_heal} HP!")
            elif 'attack' in item.effect:
                attack_boost = item.effect['attack']
                duration = item.effect.get('duration', 3)  # Default to 3 turns if not specified

                # Store the temporary effect
                self.game_state_manager.state.temporary_effects['strength'] = {
                    'type': 'attack',
                    'amount': attack_boost,
                    'turns_remaining': duration
                }

                # Apply the boost
                self.game_state_manager.state.player_attack += attack_boost
                return await self.game_state_manager.create_message(f"Used {item.name}! Attack increased by {attack_boost} for {duration} turns!")
            elif 'defense' in item.effect:
                defense_boost = item.effect['defense']
                duration = item.effect.get('duration', 3)  # Default to 3 turns if not specified

                # Store the temporary effect
                self.game_state_manager.state.temporary_effects['protection'] = {
                    'type': 'defense',
                    'amount': defense_boost,
                    'turns_remaining': duration
                }

                # Apply the boost
                self.game_state_manager.state.player_defense += defense_boost
                return await self.game_state_manager.create_message(f"Used {item.name}! Defense increased by {defense_boost} for {duration} turns!")

        return await self.game_state_manager.create_message(f"Cannot use this type of item!")

    async def handle_equip_item(self, item_id: str) -> dict:
        """Handle equipping an item."""
        if not item_id:
            return await self.game_state_manager.create_message("No item specified!")

        # Find the item in inventory
        item = next((item for item in self.game_state_manager.state.inventory if item.id == item_id), None)
        if not item:
            return await self.game_state_manager.create_message("Item not found in inventory!")

        if item.type in ['weapon', 'armor']:
            if item.is_equipped:
                return await self.game_state_manager.create_message("") # Empty message if already equipped

            # Unequip current item of same type if any
            if item.type == 'weapon':
                if self.game_state_manager.state.equipment.weapon:
                    old_item = self.game_state_manager.state.equipment.weapon
                    old_item.is_equipped = False
                    self.game_state_manager.state.player_attack -= old_item.effect.get('attack', 0)
                self.game_state_manager.state.equipment.weapon = item
                self.game_state_manager.state.player_attack += item.effect.get('attack', 0)
            else:  # armor
                if self.game_state_manager.state.equipment.armor:
                    old_item = self.game_state_manager.state.equipment.armor
                    old_item.is_equipped = False
                    self.game_state_manager.state.player_defense -= old_item.effect.get('defense', 0)
                self.game_state_manager.state.equipment.armor = item
                self.game_state_manager.state.player_defense += item.effect.get('defense', 0)

            item.is_equipped = True
            return await self.game_state_manager.create_message(f"Equipped {item.name}!")

        return await self.game_state_manager.create_message(f"This item cannot be equipped!")

    async def handle_combat_action(self, action: str) -> dict:
        """Handle combat actions by delegating to combat manager."""
        result = await self.combat_manager.handle_combat_action(self.game_state_manager.state, action)
        return await self.game_state_manager.create_message(result)

    async def _process_temporary_effects(self) -> str:
        """Process temporary effects and return a log of what happened."""
        effects_log = []
        effects_to_remove = []

        for effect_name, effect in self.game_state_manager.state.temporary_effects.items():
            effect['turns_remaining'] -= 1

            if effect['turns_remaining'] <= 0:
                effects_to_remove.append(effect_name)
                if effect['type'] == 'attack':
                    self.game_state_manager.state.player_attack -= effect['amount']
                    effects_log.append(f"The {effect_name} effect has worn off")
                elif effect['type'] == 'defense':
                    self.game_state_manager.state.player_defense -= effect['amount']
                    effects_log.append(f"The {effect_name} effect has worn off")

        # Remove expired effects
        for effect_name in effects_to_remove:
            del self.game_state_manager.state.temporary_effects[effect_name]

        return "\n".join(effects_log)

    async def _check_encounters(self) -> dict:
        """Check for encounters at the current position."""
        x, y = self.game_state_manager.state.player_pos

        # Check if there's a pre-placed enemy at this location
        enemy_here = next(
            (p for p in self.game_state_manager.entity_placements if p['x'] == x and p['y'] == y and p['type'] == 'enemy'),
            None
        )

        if enemy_here:
            # Find the enemy definition
            enemy_def = next(
                (e for e in self.game_state_manager.definitions.enemy_defs if e['enemy_id'] == enemy_here['entity_id']),
                None
            )
            if enemy_def:
                # Generate the enemy from the definition
                enemy = self._generate_enemy_from_def(enemy_def)
                self.game_state_manager.state.current_enemy = enemy
                self.game_state_manager.state.in_combat = True

                # Check if this enemy was previously defeated
                was_defeated = any(
                    de['x'] == x and de['y'] == y
                    for de in self.game_state_manager.state.defeated_enemies
                )

                # Add enemy to state.enemies list
                existing_enemy = next((e for e in self.game_state_manager.state.enemies if e['x'] == x and e['y'] == y), None)
                if existing_enemy:
                    existing_enemy['id'] = enemy.id
                    existing_enemy['name'] = enemy.name
                    existing_enemy['font_awesome_icon'] = enemy.font_awesome_icon
                    existing_enemy['is_defeated'] = was_defeated
                else:
                    self.game_state_manager.state.enemies.append({
                        'id': enemy.id,
                        'x': x,
                        'y': y,
                        'name': enemy.name,
                        'font_awesome_icon': enemy.font_awesome_icon,
                        'is_defeated': was_defeated
                    })

                # If it was defeated, add to defeated_enemies if not already there
                if was_defeated and not any(de['id'] == enemy.id for de in self.game_state_manager.state.defeated_enemies):
                    self.game_state_manager.state.defeated_enemies.append({
                        'x': x,
                        'y': y,
                        'name': enemy.name,
                        'id': enemy.id,
                        'font_awesome_icon': enemy.font_awesome_icon,
                        'is_defeated': True
                    })

                # Don't enter combat if the enemy was already defeated
                if was_defeated:
                    self.game_state_manager.state.current_enemy = None
                    self.game_state_manager.state.in_combat = False

                # Only remove enemy placement if it was defeated
                if was_defeated:
                    self.game_state_manager.entity_placements = [
                        p for p in self.game_state_manager.entity_placements
                        if not (p['x'] == x and p['y'] == y and p['type'] == 'enemy')
                    ]

                if was_defeated:
                    return await self.game_state_manager.create_message(
                        f"You see a defeated {enemy.name} here."
                    )
                else:
                    return await self.game_state_manager.create_message(
                        f"A {enemy.name} appears! (HP: {enemy.hp}, Attack: {enemy.attack})"
                    )

        # Check if there's a pre-placed item at this location
        item_here = next(
            (p for p in self.game_state_manager.entity_placements if p['x'] == x and p['y'] == y and p['type'] == 'item'),
            None
        )

        if item_here:
            # Find the item definition
            item_def = next(
                (i for i in self.game_state_manager.definitions.item_defs if i['id'] == item_here['entity_id']),
                None
            )
            if item_def:
                # Generate the item from the definition
                item = self._generate_item_from_def(item_def)

                # Check for duplicates if item is not consumable
                if item.type in ['weapon', 'armor']:
                    existing_item = next(
                        (i for i in self.game_state_manager.state.inventory if i.name == item.name),
                        None
                    )
                    if existing_item:
                        # Remove this item placement since we found it
                        self.game_state_manager.entity_placements = [
                            p for p in self.game_state_manager.entity_placements
                            if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                        ]
                        return await self.game_state_manager.create_message(
                            f"You found another {item.name}, but you already have one."
                        )

                # Add item to inventory and remove from placements
                self.game_state_manager.state.inventory.append(item)
                self.game_state_manager.entity_placements = [
                    p for p in self.game_state_manager.entity_placements
                    if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                ]
                return await self.game_state_manager.create_message(
                    f"You found a {item.name}! {item.description}"
                )

        # Only get room description if we're in a new cell type or don't have a previous description
        px = self.game_state_manager.state.player_pos[0]
        py = self.game_state_manager.state.player_pos[1]
        cur_ct = self.game_state_manager.state.cell_types[py][px]
        if self.game_state_manager.last_described_ct != cur_ct:
            self.game_state_manager.last_described_ct = cur_ct
            return await self.game_state_manager.create_message_room()
        else:
            # Return empty description if in same room type
            return await self.game_state_manager.create_message('')

    def _generate_enemy_from_def(self, enemy_def: dict) -> Enemy:
        """Generate an enemy from a definition."""
        return self.combat_manager.generate_enemy_from_def(enemy_def)

    def _generate_item_from_def(self, item_def: dict) -> Item:
        """Generate an item from a specific item definition."""
        self.game_state_manager.item_sequence_cnt += 1
        return Item(
            id=f"{item_def['id']}_{self.game_state_manager.item_sequence_cnt}",
            is_equipped=False,
            name=item_def['name'],
            type=item_def['type'],
            effect=item_def['effect'],
            description=item_def['description']
        )
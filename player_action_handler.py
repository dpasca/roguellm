import logging
from typing import Dict, Optional
from models import Item, Enemy
from combat_manager import CombatManager
from game_messages import msg

logger = logging.getLogger()


class PlayerActionHandler:
    """Handles all player actions including movement, item usage, and equipment management."""

    def __init__(self, game_state_manager, combat_manager: CombatManager):
        self.game_state_manager = game_state_manager
        self.combat_manager = combat_manager

    def msg(self, key: str, **params) -> str:
        return msg(getattr(self.game_state_manager, "language", "en"), key, **params)

    async def handle_move(self, direction: str) -> dict:
        """Handle player movement."""
        if not direction:
            return await self.game_state_manager.create_message(self.msg("action.no_direction"))

        if self.game_state_manager.state.game_won or self.game_state_manager.state.game_over:
            return await self.game_state_manager.create_message(self.msg("action.game_over"))

        if self.game_state_manager.state.current_story:
            return await self.game_state_manager.create_message(self.msg("story.choose_first"))

        # Save previous position
        self.game_state_manager.state.player_pos_prev = self.game_state_manager.state.player_pos
        # Get current position
        x, y = self.game_state_manager.state.player_pos
        # Set the current position as explored
        self.game_state_manager.state.explored[y][x] = True
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
            was_new_tile = not self.game_state_manager.state.explored[y][x]
            self.game_state_manager.state.player_pos = (x, y)
            self.game_state_manager.state.explored[y][x] = True
            encounter_result = await self._check_encounters(was_new_tile=was_new_tile)

            # Process temporary effects
            effects_log = await self._process_temporary_effects()
            if effects_log:
                encounter_result['description_raw'] = effects_log + "\n" + encounter_result['description_raw']

            return encounter_result
        else:
            return await self.game_state_manager.create_message(self.msg("action.cant_move"))

    async def handle_use_item(self, item_id: str) -> dict:
        """Handle using an item from inventory."""
        if not item_id:
            return await self.game_state_manager.create_message(self.msg("item.no_item"))

        # Find the item in inventory
        item = next((item for item in self.game_state_manager.state.inventory if item.id == item_id), None)
        if not item:
            return await self.game_state_manager.create_message(self.msg("item.not_found"))

        if item.type == 'consumable':
            # Remove the consumable immediately as it will be consumed
            self.game_state_manager.state.inventory = [i for i in self.game_state_manager.state.inventory if i.id != item_id]

            if 'health' in item.effect:
                heal_amount = item.effect['health']
                old_hp = self.game_state_manager.state.player_hp
                self.game_state_manager.state.player_hp = min(self.game_state_manager.state.player_max_hp,
                                        self.game_state_manager.state.player_hp + heal_amount)
                actual_heal = self.game_state_manager.state.player_hp - old_hp
                return await self.game_state_manager.create_message(
                    self.msg("item.used_health", item=item.name, amount=actual_heal)
                )
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
                return await self.game_state_manager.create_message(
                    self.msg(
                        "item.used_attack",
                        item=item.name,
                        amount=attack_boost,
                        duration=duration,
                    )
                )
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
                return await self.game_state_manager.create_message(
                    self.msg(
                        "item.used_defense",
                        item=item.name,
                        amount=defense_boost,
                        duration=duration,
                    )
                )

        return await self.game_state_manager.create_message(self.msg("item.cannot_use"))

    async def handle_equip_item(self, item_id: str) -> dict:
        """Handle equipping an item."""
        if not item_id:
            return await self.game_state_manager.create_message(self.msg("item.no_item"))

        # Find the item in inventory
        item = next((item for item in self.game_state_manager.state.inventory if item.id == item_id), None)
        if not item:
            return await self.game_state_manager.create_message(self.msg("item.not_found"))

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
            return await self.game_state_manager.create_message(self.msg("item.equipped", item=item.name))

        return await self.game_state_manager.create_message(self.msg("item.cannot_equip"))

    async def handle_combat_action(self, action: str) -> dict:
        """Handle combat actions by delegating to combat manager."""
        result = await self.combat_manager.handle_combat_action(
            self.game_state_manager.state,
            action,
            language=getattr(self.game_state_manager, "language", "en"),
        )
        if self._all_enemy_placements_defeated():
            self.game_state_manager.state.game_won = True
            result += f"\n{self.msg('run.all_enemies_defeated')}"
        self._update_objective_progress()
        return await self.game_state_manager.create_message(result)

    async def handle_story_choice(self, choice_id: str) -> dict:
        """Resolve one structured choice from the active story encounter."""
        story = self.game_state_manager.state.current_story
        if not story:
            return await self.game_state_manager.create_message(self.msg("story.no_active"))

        choice = next(
            (
                candidate
                for candidate in story.get("choices", [])
                if candidate.get("id") == choice_id
            ),
            None,
        )
        if not choice:
            return await self.game_state_manager.create_message(self.msg("story.invalid_choice"))

        result_text = choice.get("result") or story.get("description") or story.get("title", "")
        result_parts = [result_text]
        story_outcome = {
            "title": story.get("title", ""),
            "icon": story.get("font_awesome_icon") or "fa-solid fa-diamond",
            "choice_id": choice_id,
            "choice_label": choice.get("label", ""),
            "result": result_text,
            "effects": [],
            "combat_started": False,
            "enemy_name": "",
        }
        effect = choice.get("effect") if isinstance(choice.get("effect"), dict) else {}

        health_change = effect.get("health", 0)
        if isinstance(health_change, int) and not isinstance(health_change, bool) and health_change:
            old_hp = self.game_state_manager.state.player_hp
            self.game_state_manager.state.player_hp = max(
                0,
                min(
                    self.game_state_manager.state.player_max_hp,
                    old_hp + health_change,
                ),
            )
            actual_change = self.game_state_manager.state.player_hp - old_hp
            if actual_change > 0:
                effect_label = self.msg("story.health_gain", amount=actual_change)
                result_parts.append(effect_label)
                story_outcome["effects"].append({
                    "type": "health",
                    "amount": actual_change,
                    "label": effect_label,
                })
            elif actual_change < 0:
                effect_label = self.msg("story.health_loss", amount=abs(actual_change))
                result_parts.append(effect_label)
                story_outcome["effects"].append({
                    "type": "health",
                    "amount": actual_change,
                    "label": effect_label,
                })

        xp_change = effect.get("xp", 0)
        if isinstance(xp_change, int) and not isinstance(xp_change, bool) and xp_change > 0:
            self.game_state_manager.state.player_xp += xp_change
            effect_label = self.msg("story.xp_gain", amount=xp_change)
            result_parts.append(effect_label)
            story_outcome["effects"].append({
                "type": "xp",
                "amount": xp_change,
                "label": effect_label,
            })

        item_id = effect.get("item_id")
        if isinstance(item_id, str):
            item_def = next(
                (
                    item
                    for item in self.game_state_manager.definitions.item_defs
                    if item.get("id") == item_id
                ),
                None,
            )
            if item_def:
                item = self._generate_item_from_def(item_def)
                self.game_state_manager.state.inventory.append(item)
                effect_label = self.msg("story.item_gain", item=item.name)
                result_parts.append(effect_label)
                story_outcome["effects"].append({
                    "type": "item",
                    "item_name": item.name,
                    "label": effect_label,
                })

        instance_id = story.get("instance_id")
        if isinstance(instance_id, str):
            for placement in self.game_state_manager.state.story_placements:
                if placement.get("instance_id") == instance_id:
                    placement["status"] = "resolved"
                    placement["chosen_choice_id"] = choice_id
                    break
            if instance_id not in self.game_state_manager.state.resolved_story_ids:
                self.game_state_manager.state.resolved_story_ids.append(instance_id)

        self._mark_story_tile_resolved(story)
        self.game_state_manager.state.current_story = None

        if self.game_state_manager.state.player_hp <= 0:
            self.game_state_manager.state.game_over = True
            effect_label = self.msg("story.player_defeated")
            result_parts.append(effect_label)
            story_outcome["effects"].append({
                "type": "defeat",
                "label": effect_label,
            })
        else:
            combat_enemy_id = effect.get("combat_enemy_id")
            if isinstance(combat_enemy_id, str):
                enemy_def = next(
                    (
                        enemy
                        for enemy in self.game_state_manager.definitions.enemy_defs
                        if enemy.get("enemy_id") == combat_enemy_id
                    ),
                    None,
                )
                if enemy_def:
                    enemy = self._generate_enemy_from_def(enemy_def)
                    self.game_state_manager.state.current_enemy = enemy
                    self.game_state_manager.state.in_combat = True
                    self.game_state_manager.state.combat_source = "story"
                    effect_label = self.msg(
                        "encounter.enemy_appears",
                        enemy=enemy.name,
                        hp=enemy.hp,
                        attack=enemy.attack,
                    )
                    result_parts.append(effect_label)
                    story_outcome["effects"].append({
                        "type": "combat",
                        "enemy_name": enemy.name,
                        "label": effect_label,
                    })
                    story_outcome["combat_started"] = True
                    story_outcome["enemy_name"] = enemy.name

        self._update_objective_progress()
        response = await self.game_state_manager.create_message(
            "\n".join(part for part in result_parts if part)
        )
        response["story_outcome"] = story_outcome
        return response

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
                    effect_label = self.msg(f"effect.{effect_name}")
                    effects_log.append(self.msg("effect.expired", effect=effect_label))
                elif effect['type'] == 'defense':
                    self.game_state_manager.state.player_defense -= effect['amount']
                    effect_label = self.msg(f"effect.{effect_name}")
                    effects_log.append(self.msg("effect.expired", effect=effect_label))

        # Remove expired effects
        for effect_name in effects_to_remove:
            del self.game_state_manager.state.temporary_effects[effect_name]

        return "\n".join(effects_log)

    async def _check_encounters(self, was_new_tile: bool = True) -> dict:
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
                self.game_state_manager.state.combat_source = "map"

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
                    self.game_state_manager.state.combat_source = ""

                # Only remove enemy placement if it was defeated
                if was_defeated:
                    self.game_state_manager.entity_placements = [
                        p for p in self.game_state_manager.entity_placements
                        if not (p['x'] == x and p['y'] == y and p['type'] == 'enemy')
                    ]

                if was_defeated:
                    self._mark_enemy_tile_defeated(x, y, enemy.name)
                    return await self.game_state_manager.create_message(
                        self.msg("encounter.defeated_enemy", enemy=enemy.name)
                    )
                else:
                    return await self.game_state_manager.create_message(
                        self.msg(
                            "encounter.enemy_appears",
                            enemy=enemy.name,
                            hp=enemy.hp,
                            attack=enemy.attack,
                        )
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
                        self._mark_item_tile_collected(x, y, item.name)
                        return await self.game_state_manager.create_message(
                            self.msg("item.found_duplicate", item=item.name)
                        )

                # Add item to inventory and remove from placements
                self.game_state_manager.state.inventory.append(item)
                self.game_state_manager.entity_placements = [
                    p for p in self.game_state_manager.entity_placements
                    if not (p['x'] == x and p['y'] == y and p['type'] == 'item')
                ]
                self._mark_item_tile_collected(x, y, item.name)
                return await self.game_state_manager.create_message(
                    self.msg("item.found", item=item.name, description=item.description)
                )

        story_here = next(
            (
                story
                for story in self.game_state_manager.state.story_placements
                if story.get("x") == x
                and story.get("y") == y
                and story.get("status") == "available"
            ),
            None,
        )
        if story_here:
            self.game_state_manager.state.current_story = dict(story_here)
            description = "\n".join(
                part
                for part in [story_here.get("title"), story_here.get("description")]
                if part
            )
            return await self.game_state_manager.create_message(description)

        if was_new_tile:
            return await self.game_state_manager.create_message_room()

        return await self.game_state_manager.create_message('')

    def _mark_item_tile_collected(self, x: int, y: int, item_name: str) -> None:
        for item in self.game_state_manager.state.item_placements:
            if item.get('x') == x and item.get('y') == y:
                item['is_collected'] = True
                break

        get_tile_info = getattr(self.game_state_manager, 'get_tile_info', None)
        tile_info = get_tile_info(x, y) if callable(get_tile_info) else None
        if tile_info:
            label = tile_info.get('label') or tile_info.get('terrain_name') or self.msg('tile.area')
            tile_info.update({
                'danger_level': 'safe',
                'hint': self.msg('tile.collected', entity=item_name),
                'entity_status': 'collected',
                'quick_desc': self.msg('tile.item_collected_quick', terrain=label, item=item_name),
                'inspect_desc': self.msg('tile.item_collected_inspect', item=item_name),
                'tags': ['collected'],
            })

    def _mark_enemy_tile_defeated(self, x: int, y: int, enemy_name: str) -> None:
        get_tile_info = getattr(self.game_state_manager, 'get_tile_info', None)
        tile_info = get_tile_info(x, y) if callable(get_tile_info) else None
        if tile_info:
            label = tile_info.get('label') or tile_info.get('terrain_name') or self.msg('tile.area')
            tile_info.update({
                'danger_level': 'safe',
                'hint': self.msg('tile.defeated', entity=enemy_name),
                'entity_status': 'defeated',
                'quick_desc': self.msg('tile.enemy_defeated_quick', terrain=label, enemy=enemy_name),
                'inspect_desc': self.msg('tile.enemy_defeated_inspect', enemy=enemy_name),
                'tags': ['defeated'],
            })

    def _mark_story_tile_resolved(self, story: dict) -> None:
        x = story.get("x")
        y = story.get("y")
        if not isinstance(x, int) or not isinstance(y, int):
            return

        get_tile_info = getattr(self.game_state_manager, 'get_tile_info', None)
        tile_info = get_tile_info(x, y) if callable(get_tile_info) else None
        if not tile_info:
            return

        title = story.get("title") or tile_info.get("label") or self.msg("tile.area")
        terrain = tile_info.get("terrain_name") or tile_info.get("label") or self.msg("tile.area")
        tile_info.update({
            "danger_level": "safe",
            "hint": self.msg("story.resolved", title=title),
            "entity_status": "resolved",
            "quick_desc": self.msg("story.resolved_quick", terrain=terrain, title=title),
            "inspect_desc": story.get("resolved_description") or self.msg(
                "story.resolved_inspect",
                title=title,
            ),
            "tags": ["story", "resolved"],
        })

    def _update_objective_progress(self) -> None:
        updater = getattr(self.game_state_manager, "update_objective_progress", None)
        if callable(updater):
            updater()

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

    def _all_enemy_placements_defeated(self) -> bool:
        enemy_positions = {
            (placement['x'], placement['y'])
            for placement in self.game_state_manager.entity_placements
            if placement.get('type') == 'enemy'
        }
        if not enemy_positions:
            return False

        defeated_positions = {
            (enemy['x'], enemy['y'])
            for enemy in self.game_state_manager.state.defeated_enemies
        }
        return enemy_positions.issubset(defeated_positions)

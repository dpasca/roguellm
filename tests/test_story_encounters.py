import random
from types import SimpleNamespace
import unittest

from combat_manager import CombatManager
from game_state_manager import GameStateManager
from models import GameState
from player_action_handler import PlayerActionHandler
from websocket_schemas import ActionType, validate_websocket_message


class ScriptedRandom:
    def __init__(self, values):
        self.values = list(values)

    def randint(self, start, end):
        if not self.values:
            raise AssertionError(f"Unexpected randint({start}, {end})")
        value = self.values.pop(0)
        if value < start or value > end:
            raise AssertionError(f"Scripted randint {value} outside {start}..{end}")
        return value


def story_template():
    return {
        "id": "signal_box",
        "title": "The Silent Signal Box",
        "description": "A signal lamp blinks a deliberate warning.",
        "resolved_description": "The signal box is dark now.",
        "font_awesome_icon": "fa-solid fa-lightbulb",
        "choices": [
            {
                "id": "decode",
                "label": "Decode the signal",
                "result": "The warning reveals a safer route.",
                "effect": {"xp": 7},
            },
            {
                "id": "open_box",
                "label": "Open the box",
                "result": "The mechanism bites before yielding its secret.",
                "effect": {"health": -5, "item_id": "key"},
            },
        ],
    }


def make_state(width=4, height=3):
    cell = {
        "id": "platform",
        "name": "Night Platform",
        "description": "An empty platform under weak lamps.",
        "map_color": "#334455",
        "font_awesome_icon": "fa-solid fa-train",
    }
    return GameState(
        map_width=width,
        map_height=height,
        cell_types=[[dict(cell) for _ in range(width)] for _ in range(height)],
        explored=[[False for _ in range(width)] for _ in range(height)],
        player_pos=(0, 0),
        player_pos_prev=(0, 0),
        player_hp=50,
        player_max_hp=100,
        player_attack=15,
        player_defense=0,
        game_title="Story Test",
        player={
            "name": "Conductor",
            "objective": {
                "title": "Stop the night train",
                "description": "Defeat every guard along the line.",
            },
        },
    )


class DummyManager:
    def __init__(self, state, definitions, placements=None):
        self.state = state
        self.definitions = definitions
        self.entity_placements = list(placements or [])
        self.item_sequence_cnt = 0
        self.language = "en"

    async def create_message(self, description_raw="", description=""):
        return {
            "type": "update",
            "state": self.state.model_dump(mode="json"),
            "description_raw": description_raw,
            "description": description or description_raw,
        }

    def get_tile_info(self, x, y):
        return self.state.tile_info[y][x]

    def update_objective_progress(self):
        return None


class StoryEncounterTests(unittest.IsolatedAsyncioTestCase):
    def make_manager(self):
        manager = GameStateManager.__new__(GameStateManager)
        manager.random = random.Random(4)
        manager.language = "en"
        manager.state = make_state()
        manager.definitions = SimpleNamespace(
            player_defs=[manager.state.player],
            item_defs=[{
                "id": "key",
                "name": "Signal Key",
                "type": "consumable",
                "effect": {"health": 10},
                "description": "A key cut for railway machinery.",
            }],
            enemy_defs=[{
                "enemy_id": "guard",
                "name": "Night Guard",
                "font_awesome_icon": "fa-solid fa-user-shield",
                "hp": {"min": 1, "max": 1},
                "attack": {"min": 1, "max": 1},
                "defense": {"min": 0, "max": 0},
                "xp": 3,
                "weapons": [],
            }],
            celltype_defs=[{
                **manager.state.cell_types[0][0],
                "encounters": [story_template()],
            }],
        )
        manager.entity_placements = [
            {"type": "enemy", "entity_id": "guard", "x": 3, "y": 2},
        ]
        return manager

    def test_places_story_near_start_and_exposes_it_in_tile_info(self):
        manager = self.make_manager()

        manager.initialize_story_placements()
        manager.initialize_objective()
        manager.state.tile_info = manager._normalize_tile_info([])

        self.assertEqual(len(manager.state.story_placements), 1)
        story = manager.state.story_placements[0]
        self.assertEqual(abs(story["x"]) + abs(story["y"]), 1)
        self.assertEqual(story["status"], "available")
        self.assertNotEqual((story["x"], story["y"]), (3, 2))

        tile = manager.get_tile_info(story["x"], story["y"])
        self.assertEqual(tile["entity_type"], "story")
        self.assertEqual(tile["entity_status"], "available")
        self.assertEqual(tile["danger_level"], "story")
        self.assertIn("Silent Signal Box", tile["hint"])

        self.assertEqual(manager.state.objective["title"], "Stop the night train")
        self.assertEqual(manager.state.objective["target"], 1)

    def test_worlds_without_story_data_receive_structured_fallback_choices(self):
        manager = self.make_manager()
        manager.definitions.celltype_defs[0].pop("encounters")

        templates = manager._story_templates()

        self.assertEqual(len(templates), 1)
        self.assertIn("Night Platform", templates[0]["title"])
        self.assertEqual(len(templates[0]["choices"]), 2)
        self.assertEqual(templates[0]["choices"][0]["effect"], {"xp": 4})
        self.assertEqual(templates[0]["choices"][1]["effect"], {"health": -5, "xp": 9})

    async def test_choice_applies_item_and_health_then_marks_story_resolved(self):
        state = make_state(width=1, height=1)
        active_story = {
            **story_template(),
            "type": "story",
            "instance_id": "signal_box:0:0",
            "x": 0,
            "y": 0,
            "status": "available",
        }
        state.story_placements = [dict(active_story)]
        state.current_story = dict(active_story)
        state.tile_info = [[{
            "label": "Signal Box",
            "terrain_name": "Night Platform",
            "entity_type": "story",
            "entity_status": "available",
        }]]
        definitions = SimpleNamespace(
            item_defs=[{
                "id": "key",
                "name": "Signal Key",
                "type": "consumable",
                "effect": {"health": 10},
                "description": "A key cut for railway machinery.",
            }],
            enemy_defs=[],
        )
        manager = DummyManager(state, definitions)
        handler = PlayerActionHandler(manager, CombatManager(random.Random(0), definitions))

        response = await handler.handle_story_choice("open_box")

        self.assertEqual(state.player_hp, 45)
        self.assertEqual(state.inventory[0].name, "Signal Key")
        self.assertIsNone(state.current_story)
        self.assertEqual(state.story_placements[0]["status"], "resolved")
        self.assertEqual(state.resolved_story_ids, ["signal_box:0:0"])
        self.assertEqual(state.tile_info[0][0]["entity_status"], "resolved")
        self.assertIn("Lost 5 HP", response["description_raw"])
        self.assertIn("Received Signal Key", response["description_raw"])
        self.assertEqual(response["story_outcome"]["title"], "The Silent Signal Box")
        self.assertEqual(response["story_outcome"]["choice_label"], "Open the box")
        self.assertEqual(
            [effect["type"] for effect in response["story_outcome"]["effects"]],
            ["health", "item"],
        )
        self.assertEqual(response["story_outcome"]["effects"][0]["amount"], -5)
        self.assertEqual(response["story_outcome"]["effects"][1]["item_name"], "Signal Key")

    async def test_story_combat_does_not_count_as_map_enemy_or_overwrite_story_tile(self):
        state = make_state(width=1, height=1)
        combat_story = {
            "id": "guarded_box",
            "title": "Guarded Box",
            "description": "A guard steps out of the dark.",
            "resolved_description": "The opened box is empty.",
            "font_awesome_icon": "fa-solid fa-box",
            "choices": [{
                "id": "confront",
                "label": "Confront the guard",
                "result": "The guard accepts the challenge.",
                "effect": {"combat_enemy_id": "guard"},
            }, {
                "id": "leave",
                "label": "Leave it",
                "result": "You leave the box alone.",
                "effect": {},
            }],
            "type": "story",
            "instance_id": "guarded_box:0:0",
            "x": 0,
            "y": 0,
            "status": "available",
        }
        state.story_placements = [dict(combat_story)]
        state.current_story = dict(combat_story)
        state.tile_info = [[{
            "label": "Guarded Box",
            "terrain_name": "Night Platform",
            "entity_type": "story",
            "entity_status": "available",
        }]]
        definitions = SimpleNamespace(
            item_defs=[],
            enemy_defs=[{
                "enemy_id": "guard",
                "name": "Night Guard",
                "font_awesome_icon": "fa-solid fa-user-shield",
                "hp": {"min": 1, "max": 1},
                "attack": {"min": 1, "max": 1},
                "defense": {"min": 0, "max": 0},
                "xp": 3,
                "weapons": [],
            }],
        )
        manager = DummyManager(state, definitions)
        combat = CombatManager(ScriptedRandom([1, 1, 0, 15]), definitions)
        handler = PlayerActionHandler(manager, combat)

        response = await handler.handle_story_choice("confront")
        self.assertTrue(state.in_combat)
        self.assertEqual(state.combat_source, "story")
        self.assertTrue(response["story_outcome"]["combat_started"])
        self.assertEqual(response["story_outcome"]["enemy_name"], "Night Guard")
        self.assertEqual(response["story_outcome"]["effects"][0]["type"], "combat")

        await handler.handle_combat_action("attack")
        self.assertFalse(state.in_combat)
        self.assertEqual(state.combat_source, "")
        self.assertEqual(state.defeated_enemies, [])
        self.assertEqual(state.tile_info[0][0]["entity_status"], "resolved")
        self.assertFalse(state.game_won)

    def test_choose_story_websocket_message_is_structured(self):
        message = validate_websocket_message({
            "action": "choose_story",
            "choice_id": "decode",
        })

        self.assertEqual(message.action, ActionType.CHOOSE_STORY)
        self.assertEqual(message.choice_id, "decode")


if __name__ == "__main__":
    unittest.main()

import unittest

from gen_ai import GenAI


class WorldTranslationTests(unittest.TestCase):
    def test_normalizes_translation_to_preserve_gameplay_fields(self):
        gen_ai = GenAI.__new__(GenAI)
        source = {
            "theme_desc_better": "Clockwork Library\nA quieter second line",
            "player_defs": [
                {
                    "name": "Diver",
                    "class": "archivist",
                    "font_awesome_icon": "fa-solid fa-user",
                }
            ],
            "item_defs": [
                {
                    "id": "key",
                    "name": "Brass Key",
                    "type": "consumable",
                    "effect": {"health": 20},
                    "description": "A key that hums softly.",
                }
            ],
            "enemy_defs": [
                {
                    "enemy_id": "eel",
                    "name": "Archive Eel",
                    "font_awesome_icon": "fa-solid fa-bolt",
                    "hp": {"min": 10, "max": 20},
                    "attack": {"min": 3, "max": 5},
                    "defense": {"min": 1, "max": 2},
                    "xp": 7,
                    "weapons": ["Static Bite"],
                }
            ],
            "celltype_defs": {
                "reef": {
                    "name": "Reef",
                    "description": "A quiet reef.",
                    "map_color": "#123456",
                    "font_awesome_icon": "fa-solid fa-water",
                }
            },
        }
        translated = {
            "theme_desc_better": "時計仕掛けの図書館\n静かな二行目",
            "player_defs": [
                {
                    "name": "潜水士",
                    "class": "記録係",
                    "font_awesome_icon": "translated-icon",
                }
            ],
            "item_defs": [
                {
                    "id": "translated-key",
                    "name": "真鍮の鍵",
                    "type": "translated-consumable",
                    "effect": {"translated_health": 99},
                    "description": "かすかに唸る鍵。",
                }
            ],
            "enemy_defs": [
                {
                    "enemy_id": "translated-eel",
                    "name": "書庫ウナギ",
                    "font_awesome_icon": "translated-icon",
                    "hp": {"min": 99, "max": 99},
                    "attack": {"min": 99, "max": 99},
                    "defense": {"min": 99, "max": 99},
                    "xp": 99,
                    "weapons": ["静電噛みつき"],
                }
            ],
            "celltype_defs": {
                "reef": {
                    "name": "サンゴ礁",
                    "description": "静かなサンゴ礁。",
                    "map_color": "#999999",
                    "font_awesome_icon": "translated-icon",
                }
            },
        }

        normalized = gen_ai._normalize_translated_world_definition(source, translated)

        self.assertEqual(normalized["theme_desc_better"], translated["theme_desc_better"])
        self.assertEqual(normalized["player_defs"][0]["name"], "潜水士")
        self.assertEqual(normalized["player_defs"][0]["font_awesome_icon"], "fa-solid fa-user")
        self.assertEqual(normalized["item_defs"][0]["id"], "key")
        self.assertEqual(normalized["item_defs"][0]["type"], "consumable")
        self.assertEqual(normalized["item_defs"][0]["effect"], {"health": 20})
        self.assertEqual(normalized["item_defs"][0]["description"], "かすかに唸る鍵。")
        self.assertEqual(normalized["enemy_defs"][0]["enemy_id"], "eel")
        self.assertEqual(normalized["enemy_defs"][0]["hp"], {"min": 10, "max": 20})
        self.assertEqual(normalized["enemy_defs"][0]["weapons"], ["静電噛みつき"])
        self.assertEqual(normalized["celltype_defs"]["reef"]["name"], "サンゴ礁")
        self.assertEqual(normalized["celltype_defs"]["reef"]["map_color"], "#123456")


if __name__ == "__main__":
    unittest.main()

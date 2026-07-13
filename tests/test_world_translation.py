import unittest

from gen_ai import GenAI
from gen_ai_prompts import SYS_TRANSLATE_WORLD_JSON_MSG


class WorldTranslationTests(unittest.TestCase):
    def test_translation_prompt_preserves_proper_names(self):
        self.assertIn("Proper names", SYS_TRANSLATE_WORLD_JSON_MSG)
        self.assertIn("Do not translate or transliterate", SYS_TRANSLATE_WORLD_JSON_MSG)
        self.assertIn('preserve "Piedone" exactly as "Piedone"', SYS_TRANSLATE_WORLD_JSON_MSG)

    def test_normalizes_translation_to_preserve_gameplay_fields(self):
        gen_ai = GenAI.__new__(GenAI)
        source = {
            "theme_desc_better": "Piedone a Tokyo\nA quieter second line",
            "player_defs": [
                {
                    "name": "Piedone",
                    "class": "archivist",
                    "font_awesome_icon": "fa-solid fa-user",
                    "objective": {
                        "title": "Break the archive lock",
                        "description": "Defeat every guardian in the archive.",
                    },
                }
            ],
            "item_defs": [
                {
                    "id": "key",
                    "name": "Piedone's Brass Key",
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
                    "encounters": [{
                        "id": "singing_shell",
                        "title": "The Singing Shell",
                        "description": "A shell repeats a warning.",
                        "font_awesome_icon": "fa-solid fa-music",
                        "choices": [{
                            "id": "listen",
                            "label": "Listen closely",
                            "result": "You learn the safe rhythm.",
                            "effect": {"xp": 7},
                        }, {
                            "id": "break",
                            "label": "Break it",
                            "result": "The sound stops painfully.",
                            "effect": {"health": -3},
                        }],
                    }],
                }
            },
        }
        translated = {
            "theme_desc_better": "ピエドーネ in 東京\n静かな二行目",
            "player_defs": [
                {
                    "name": "ピエドーネ",
                    "class": "記録係",
                    "font_awesome_icon": "translated-icon",
                    "objective": {
                        "title": "書庫の鍵を破れ",
                        "description": "書庫の守護者をすべて倒せ。",
                    },
                }
            ],
            "item_defs": [
                {
                    "id": "translated-key",
                    "name": "ピエドーネの真鍮の鍵",
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
                    "encounters": [{
                        "id": "translated-shell",
                        "title": "歌う貝殻",
                        "description": "貝殻が警告を繰り返す。",
                        "font_awesome_icon": "translated-icon",
                        "choices": [{
                            "id": "translated-listen",
                            "label": "よく聞く",
                            "result": "安全なリズムを学んだ。",
                            "effect": {"xp": 99},
                        }, {
                            "id": "translated-break",
                            "label": "壊す",
                            "result": "痛みとともに音が止まった。",
                            "effect": {"health": -99},
                        }],
                    }],
                }
            },
        }

        normalized = gen_ai._normalize_translated_world_definition(source, translated)

        self.assertTrue(normalized["theme_desc_better"].startswith("Piedone a Tokyo\n"))
        self.assertEqual(normalized["player_defs"][0]["name"], "Piedone")
        self.assertEqual(normalized["player_defs"][0]["font_awesome_icon"], "fa-solid fa-user")
        self.assertEqual(normalized["player_defs"][0]["objective"]["title"], "書庫の鍵を破れ")
        self.assertEqual(normalized["item_defs"][0]["id"], "key")
        self.assertEqual(normalized["item_defs"][0]["name"], "Piedone's Brass Key")
        self.assertEqual(normalized["item_defs"][0]["type"], "consumable")
        self.assertEqual(normalized["item_defs"][0]["effect"], {"health": 20})
        self.assertEqual(normalized["item_defs"][0]["description"], "かすかに唸る鍵。")
        self.assertEqual(normalized["enemy_defs"][0]["enemy_id"], "eel")
        self.assertEqual(normalized["enemy_defs"][0]["hp"], {"min": 10, "max": 20})
        self.assertEqual(normalized["enemy_defs"][0]["weapons"], ["静電噛みつき"])
        self.assertEqual(normalized["celltype_defs"]["reef"]["name"], "サンゴ礁")
        self.assertEqual(normalized["celltype_defs"]["reef"]["map_color"], "#123456")
        encounter = normalized["celltype_defs"]["reef"]["encounters"][0]
        self.assertEqual(encounter["id"], "singing_shell")
        self.assertEqual(encounter["title"], "歌う貝殻")
        self.assertEqual(encounter["choices"][0]["id"], "listen")
        self.assertEqual(encounter["choices"][0]["label"], "よく聞く")
        self.assertEqual(encounter["choices"][0]["effect"], {"xp": 7})


if __name__ == "__main__":
    unittest.main()

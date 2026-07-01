import json
import string
import unittest
from pathlib import Path

from game_messages import SUPPORTED_LOCALES, TRANSLATIONS_DIR, msg


REPO_ROOT = Path(__file__).resolve().parents[1]


def load_gameplay_log(locale):
    with (TRANSLATIONS_DIR / f"{locale}.json").open("r", encoding="utf-8") as locale_file:
        return json.load(locale_file).get("gameplayLog", {})


def placeholders(template):
    formatter = string.Formatter()
    return {
        field_name
        for _, field_name, _, _ in formatter.parse(template)
        if field_name
    }


class GameplayLogLocalizationTests(unittest.TestCase):
    def test_supported_locales_match_translation_files(self):
        locale_files = {
            path.stem
            for path in TRANSLATIONS_DIR.glob("*.json")
        }

        self.assertEqual(locale_files, set(SUPPORTED_LOCALES))

    def test_update_script_uses_backend_supported_locales(self):
        script = (REPO_ROOT / "tools" / "run_update_locales.sh").read_text(encoding="utf-8")

        self.assertIn("from game_messages import SUPPORTED_LOCALES", script)
        self.assertIn('if locale != "en"', script)

    def test_game_i18n_keeps_chinese_locale_order_stable(self):
        game_js = (REPO_ROOT / "static" / "js" / "createApp.js").read_text(encoding="utf-8")

        self.assertIn(
            "const [enResponse, itResponse, jaResponse, esResponse, zhHansResponse, zhHantResponse]",
            game_js,
        )
        self.assertLess(
            game_js.index("fetch('/static/translations/zh-Hans.json')"),
            game_js.index("fetch('/static/translations/zh-Hant.json')"),
        )
        self.assertLess(
            game_js.index("zhHansResponse.json()"),
            game_js.index("zhHantResponse.json()"),
        )

    def test_supported_locale_files_have_complete_gameplay_log_keys(self):
        english_log = load_gameplay_log("en")
        self.assertTrue(english_log)

        english_keys = set(english_log)
        for locale in SUPPORTED_LOCALES:
            with self.subTest(locale=locale):
                locale_log = load_gameplay_log(locale)
                self.assertEqual(set(locale_log), english_keys)

    def test_supported_locale_gameplay_log_placeholders_match_english(self):
        english_log = load_gameplay_log("en")

        for locale in SUPPORTED_LOCALES:
            locale_log = load_gameplay_log(locale)
            for key, english_template in english_log.items():
                with self.subTest(locale=locale, key=key):
                    self.assertEqual(
                        placeholders(locale_log[key]),
                        placeholders(english_template),
                    )

    def test_message_helper_uses_locale_files(self):
        message = msg("es", "combat.player_hit", damage=7, enemy="Robot")

        self.assertIn("Robot", message)
        self.assertIn("7", message)
        self.assertIn("Infliges", message)


if __name__ == "__main__":
    unittest.main()

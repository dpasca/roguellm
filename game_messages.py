"""Fast deterministic gameplay messages loaded from locale files."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


TRANSLATIONS_DIR = Path(__file__).resolve().parent / "static" / "translations"
SUPPORTED_LOCALES = ("en", "es", "it", "ja", "zh-Hans", "zh-Hant")


def normalize_language(language: str | None) -> str:
    if not language:
        return "en"

    if language in SUPPORTED_LOCALES:
        return language

    base_language = language.split("-")[0]
    if base_language in SUPPORTED_LOCALES:
        return base_language

    return "en"


@lru_cache(maxsize=None)
def load_gameplay_log(language: str) -> dict[str, str]:
    locale_path = TRANSLATIONS_DIR / f"{language}.json"
    with locale_path.open("r", encoding="utf-8") as locale_file:
        translations = json.load(locale_file)

    gameplay_log = translations.get("gameplayLog", {})
    if not isinstance(gameplay_log, dict):
        return {}

    return {
        key: value
        for key, value in gameplay_log.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def msg(language: str | None, key: str, **params: Any) -> str:
    language_key = normalize_language(language)
    locale_messages = load_gameplay_log(language_key)
    english_messages = load_gameplay_log("en")
    template = locale_messages.get(key, english_messages.get(key, key))
    return template.format(**params)

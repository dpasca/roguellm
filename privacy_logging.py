import os
from typing import Any


ENABLED_VALUES = {"1", "true", "yes", "on"}


def is_sensitive_content_logging_enabled() -> bool:
    return (
        os.getenv("ENABLE_LLM_CONTENT_LOGGING", "")
        .strip()
        .lower()
        in ENABLED_VALUES
    )


def describe_text(value: Any) -> str:
    text = "" if value is None else str(value)
    line_count = text.count("\n") + 1 if text else 0
    return f"{len(text)} chars, {line_count} lines"


def describe_collection(value: Any) -> str:
    if value is None:
        return "none"
    if isinstance(value, dict):
        return f"{len(value)} keys"
    if isinstance(value, (list, tuple, set)):
        return f"{len(value)} items"
    return describe_text(value)

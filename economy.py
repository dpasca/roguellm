"""Product-facing credit configuration.

The ledger itself lives in ``db.py``. Keeping prices and rollout switches here
lets the web and WebSocket paths share one policy without teaching persistence
code about deployment configuration.
"""

import logging
import os


DEFAULT_WORLD_FORGE_CREDIT_COST = 10
DEFAULT_WELCOME_CREDITS = 30
DEFAULT_COMPLETION_REWARD_CREDITS = 1
DEFAULT_COMPLETION_REWARD_DAILY_CAP = 5


def _non_negative_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        return max(0, int(raw_value))
    except ValueError:
        logging.warning("Invalid %s=%r; using %s", name, raw_value, default)
        return default


def is_world_credits_enabled() -> bool:
    """Keep charging off until the code and product rollout are both ready."""
    return os.getenv("ENABLE_WORLD_CREDITS", "0").strip().lower() not in {
        "0", "false", "no", "off", "",
    }


def get_world_forge_credit_cost() -> int:
    return _non_negative_int(
        "WORLD_FORGE_CREDIT_COST", DEFAULT_WORLD_FORGE_CREDIT_COST
    )


def get_welcome_credits() -> int:
    return _non_negative_int("WELCOME_CREDITS", DEFAULT_WELCOME_CREDITS)


def get_completion_reward_credits() -> int:
    return _non_negative_int(
        "COMPLETION_REWARD_CREDITS", DEFAULT_COMPLETION_REWARD_CREDITS
    )


def get_completion_reward_daily_cap() -> int:
    return _non_negative_int(
        "COMPLETION_REWARD_DAILY_CAP", DEFAULT_COMPLETION_REWARD_DAILY_CAP
    )

import os
from typing import Optional

DEV_FIXTURE_SCHEMA_VERSION = 1
DEV_FIXTURE_DIR = os.path.join("_data", "dev_fixtures")


def sanitize_generator_id(generator_id: str) -> Optional[str]:
    safe_id = "".join(
        char for char in generator_id
        if char.isalnum() or char in {"-", "_"}
    )
    return safe_id or None


def get_dev_fixture_path(generator_id: str) -> Optional[str]:
    safe_id = sanitize_generator_id(generator_id)
    if not safe_id:
        return None
    return os.path.join(DEV_FIXTURE_DIR, f"{safe_id}.json")


def dev_fixture_exists(generator_id: str) -> bool:
    path = get_dev_fixture_path(generator_id)
    return bool(path and os.path.exists(path))

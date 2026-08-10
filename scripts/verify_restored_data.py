#!/usr/bin/env python3
"""Verify a restored RogueLLM data directory and its generated asset links."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit


ASSET_URL_PREFIX = "/assets/worlds/"
JSON_COLUMNS = {
    "generators": ("player_defs", "item_defs", "enemy_defs", "celltype_defs"),
    "generator_worlds": ("visual_manifest",),
    "generator_translations": (
        "player_defs",
        "item_defs",
        "enemy_defs",
        "celltype_defs",
    ),
}


def iter_asset_urls(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for nested in value.values():
            yield from iter_asset_urls(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_asset_urls(nested)
    elif isinstance(value, str) and value.startswith(ASSET_URL_PREFIX):
        yield value


def available_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    return {str(row[1]) for row in rows}


def collect_asset_urls(connection: sqlite3.Connection) -> list[str]:
    tables = {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    urls: list[str] = []

    for table, expected_columns in JSON_COLUMNS.items():
        if table not in tables:
            continue
        columns = [
            column for column in expected_columns
            if column in available_columns(connection, table)
        ]
        if not columns:
            continue

        select_columns = ", ".join(f'"{column}"' for column in columns)
        for row in connection.execute(f'SELECT {select_columns} FROM "{table}"'):
            for raw_value in row:
                if not raw_value:
                    continue
                try:
                    value = json.loads(raw_value)
                except (json.JSONDecodeError, TypeError) as error:
                    raise ValueError(
                        f"Invalid JSON in {table}: {error}"
                    ) from error
                urls.extend(iter_asset_urls(value))

    return urls


def asset_path_for_url(assets_dir: Path, url: str) -> Path:
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith(ASSET_URL_PREFIX):
        raise ValueError(f"Unsupported generated asset URL: {url}")

    relative_text = unquote(parsed.path[len(ASSET_URL_PREFIX):])
    relative_path = Path(relative_text)
    if (
        not relative_text
        or relative_path.is_absolute()
        or any(part in ("", ".", "..") for part in relative_path.parts)
    ):
        raise ValueError(f"Unsafe generated asset URL: {url}")

    resolved_assets_dir = assets_dir.resolve()
    resolved_path = (assets_dir / relative_path).resolve()
    if os.path.commonpath((resolved_assets_dir, resolved_path)) != str(resolved_assets_dir):
        raise ValueError(f"Generated asset URL escapes the asset directory: {url}")
    return resolved_path


def verify_data_directory(data_dir: Path) -> dict[str, int | str]:
    database_path = data_dir / "rllm_game_data.db"
    assets_dir = data_dir / "assets"
    if not database_path.is_file():
        raise ValueError(f"Restored database is missing: {database_path}")
    if not assets_dir.is_dir():
        raise ValueError(f"Restored asset directory is missing: {assets_dir}")

    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        if integrity != "ok":
            raise ValueError(f"Restored database integrity check failed: {integrity}")
        table_count = int(connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"
        ).fetchone()[0])
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        world_count = 0
        if "generators" in tables:
            world_count = int(connection.execute(
                "SELECT COUNT(*) FROM generators"
            ).fetchone()[0])
        asset_urls = collect_asset_urls(connection)
    finally:
        connection.close()

    missing_urls = []
    for url in sorted(set(asset_urls)):
        asset_path = asset_path_for_url(assets_dir, url)
        if not asset_path.is_file() or asset_path.stat().st_size <= 0:
            missing_urls.append(url)
    if missing_urls:
        preview = ", ".join(missing_urls[:5])
        raise ValueError(
            f"Restored data is missing {len(missing_urls)} referenced assets: {preview}"
        )

    asset_files = [path for path in assets_dir.rglob("*") if path.is_file()]
    return {
        "asset_bytes": sum(path.stat().st_size for path in asset_files),
        "asset_file_count": len(asset_files),
        "asset_reference_count": len(asset_urls),
        "database_integrity": integrity,
        "table_count": table_count,
        "unique_asset_reference_count": len(set(asset_urls)),
        "world_count": world_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    args = parser.parse_args()

    try:
        result = verify_data_directory(args.data_dir)
    except (OSError, sqlite3.DatabaseError, ValueError) as error:
        parser.exit(1, f"RESTORE_DATA_UNHEALTHY: {error}\n")

    print(f"RESTORE_DATA_HEALTHY {json.dumps(result, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

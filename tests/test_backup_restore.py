import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify_restored_data.py"


class RestoredDataVerificationTests(unittest.TestCase):
    def create_data_directory(self, root: Path, asset_url: str) -> Path:
        data_dir = root / "_data"
        assets_dir = data_dir / "assets"
        assets_dir.mkdir(parents=True)

        connection = sqlite3.connect(data_dir / "rllm_game_data.db")
        try:
            connection.execute(
                "CREATE TABLE generators ("
                "id TEXT PRIMARY KEY, player_defs TEXT, item_defs TEXT, "
                "enemy_defs TEXT, celltype_defs TEXT)"
            )
            connection.execute(
                "CREATE TABLE generator_worlds ("
                "generator_id TEXT PRIMARY KEY, visual_manifest TEXT)"
            )
            connection.execute(
                "INSERT INTO generators VALUES (?, ?, ?, ?, ?)",
                (
                    "world-1",
                    json.dumps([{"sprite_url": asset_url}]),
                    "[]",
                    "[]",
                    "[]",
                ),
            )
            connection.execute(
                "INSERT INTO generator_worlds VALUES (?, ?)",
                ("world-1", json.dumps({"cover": asset_url})),
            )
            connection.commit()
        finally:
            connection.close()
        return data_dir

    def run_verifier(self, data_dir: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VERIFY_SCRIPT), str(data_dir)],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_accepts_an_intact_database_and_referenced_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = self.create_data_directory(
                Path(temporary),
                "/assets/worlds/world-1/hero.webp",
            )
            asset = data_dir / "assets" / "world-1" / "hero.webp"
            asset.parent.mkdir()
            asset.write_bytes(b"RIFF-test-WEBP")

            result = self.run_verifier(data_dir)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("RESTORE_DATA_HEALTHY", result.stdout)
            self.assertIn('"asset_file_count": 1', result.stdout)
            self.assertIn('"asset_reference_count": 2', result.stdout)
            self.assertIn('"unique_asset_reference_count": 1', result.stdout)

    def test_rejects_a_missing_referenced_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = self.create_data_directory(
                Path(temporary),
                "/assets/worlds/world-1/missing.webp",
            )

            result = self.run_verifier(data_dir)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing 1 referenced assets", result.stderr)

    def test_rejects_an_asset_url_that_escapes_the_assets_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = self.create_data_directory(
                Path(temporary),
                "/assets/worlds/%2e%2e/secret.webp",
            )

            result = self.run_verifier(data_dir)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Unsafe generated asset URL", result.stderr)


if __name__ == "__main__":
    unittest.main()

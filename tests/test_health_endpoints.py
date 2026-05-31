import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager


class BrokenDatabase:
    storage_enabled = False

    def init_db(self):
        pass

    def shutdown(self):
        pass

    def get_connection(self):
        raise RuntimeError("database unavailable")


class HealthEndpointTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "health.db")
        return manager

    def test_health_endpoint_reports_process_status(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)

            with patch("main.db", manager):
                with TestClient(main.app) as client:
                    response = client.get("/health")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(payload["service"], "roguellm")
            self.assertIn("env", payload)
            self.assertIn("uptime_seconds", payload)

    def test_database_health_endpoint_reports_ok(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)

            with patch("main.db", manager):
                with TestClient(main.app) as client:
                    response = client.get("/health/db")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(payload["database"], "sqlite")
            self.assertFalse(payload["storage_enabled"])
            self.assertIn("latency_ms", payload)

    def test_database_health_endpoint_reports_failure(self):
        with patch("main.db", BrokenDatabase()):
            with TestClient(main.app) as client:
                response = client.get("/health/db")

        self.assertEqual(response.status_code, 503)
        payload = response.json()
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["database"], "sqlite")
        self.assertEqual(payload["error"], "database health check failed")


if __name__ == "__main__":
    unittest.main()

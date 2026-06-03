import os
import unittest
from unittest.mock import patch

import main


class ProductionConfigTests(unittest.TestCase):
    def test_production_requires_session_secret(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            with self.assertRaisesRegex(ValueError, "SESSION_SECRET_KEY"):
                main.get_session_secret_key()

    def test_production_rejects_placeholder_session_secret(self):
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "SESSION_SECRET_KEY": "your_secure_random_session_key_here",
        }, clear=True):
            with self.assertRaisesRegex(ValueError, "SESSION_SECRET_KEY"):
                main.get_session_secret_key()

    def test_production_rejects_short_session_secret(self):
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "SESSION_SECRET_KEY": "short-secret",
        }, clear=True):
            with self.assertRaisesRegex(ValueError, "SESSION_SECRET_KEY"):
                main.get_session_secret_key()

    def test_development_allows_fallback_session_secret(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            self.assertGreaterEqual(len(main.get_session_secret_key()), 32)

    def test_session_cookie_defaults_are_publish_safe(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            self.assertTrue(main.is_production_env())
            self.assertEqual(main.get_session_cookie_same_site(), "lax")
            self.assertEqual(
                main.get_session_cookie_max_age_seconds(),
                main.SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS,
            )

    def test_default_new_world_visibility_is_private(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(main.get_default_new_world_visibility(), "private")

    def test_production_keeps_new_world_visibility_private(self):
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "DEFAULT_NEW_WORLD_VISIBILITY": "public",
        }, clear=True):
            self.assertEqual(main.get_default_new_world_visibility(), "private")

    def test_login_required_to_create_world_defaults_to_production_only(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            self.assertTrue(main.is_login_required_to_create_world())

        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            self.assertFalse(main.is_login_required_to_create_world())

    def test_login_required_to_create_world_can_be_overridden(self):
        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "REQUIRE_LOGIN_TO_CREATE_WORLD": "0",
        }, clear=True):
            self.assertFalse(main.is_login_required_to_create_world())

        with patch.dict(os.environ, {
            "APP_ENV": "development",
            "REQUIRE_LOGIN_TO_CREATE_WORLD": "1",
        }, clear=True):
            self.assertTrue(main.is_login_required_to_create_world())


if __name__ == "__main__":
    unittest.main()

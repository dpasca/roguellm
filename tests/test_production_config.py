import os
import unittest
from unittest.mock import patch

import main


TEST_FIREBASE_ENV = {
    "ANALYTICS_ENABLED": "1",
    "FIREBASE_API_KEY": "test-api-key",
    "FIREBASE_AUTH_DOMAIN": "roguellm.test.firebaseapp.com",
    "FIREBASE_PROJECT_ID": "roguellm-test",
    "FIREBASE_STORAGE_BUCKET": "roguellm-test.firebasestorage.app",
    "FIREBASE_MESSAGING_SENDER_ID": "123456789",
    "FIREBASE_APP_ID": "1:123456789:web:test",
    "FIREBASE_MEASUREMENT_ID": "G-TEST123",
}


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

    def test_abuse_protection_defaults_match_publish_template(self):
        self.assertEqual(main.AUTH_LOGIN_DEFAULT_MAX_ATTEMPTS, 5)
        self.assertEqual(main.AUTH_LOGIN_DEFAULT_WINDOW_SECONDS, 60)
        self.assertEqual(main.AUTH_SIGNUP_DEFAULT_MAX_ATTEMPTS, 5)
        self.assertEqual(main.AUTH_SIGNUP_DEFAULT_WINDOW_SECONDS, 3600)
        self.assertEqual(main.WORLD_CREATION_DEFAULT_MAX_ATTEMPTS, 10)
        self.assertEqual(main.WORLD_CREATION_DEFAULT_WINDOW_SECONDS, 3600)
        self.assertEqual(main.WORLD_PUBLIC_REVIEW_DEFAULT_DELAY_SECONDS, 0)
        self.assertEqual(main.WORLD_PUBLIC_REVIEW_DEFAULT_IMMEDIATE_MAX_PENDING, 10)

    def test_admin_usernames_default_to_disabled(self):
        with patch.dict(os.environ, {
            "ADMIN_USERNAMES": "",
            "ADMIN_USERNAME": "",
        }):
            self.assertEqual(main.get_admin_usernames(), set())

    def test_admin_usernames_accept_comma_list(self):
        with patch.dict(os.environ, {
            "ADMIN_USERNAMES": "davide, Admin",
            "ADMIN_USERNAME": "",
        }):
            self.assertEqual(main.get_admin_usernames(), {"davide", "admin"})

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

    def test_public_review_worker_defaults_to_production_only(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            self.assertTrue(main.is_world_public_review_worker_enabled())

        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            self.assertFalse(main.is_world_public_review_worker_enabled())

    def test_analytics_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(main.is_analytics_enabled())
            main.validate_analytics_config()
            auth_head = main.inject_analytics_head(
                main.ANALYTICS_HEAD_PLACEHOLDER
            )

        self.assertIn('"analyticsEnabled":false', auth_head)
        self.assertIn('"legacyPasswordEnabled":true', auth_head)
        self.assertNotIn("firebaseRuntime.js", auth_head)

    def test_enabled_analytics_requires_complete_firebase_config(self):
        with patch.dict(os.environ, {"ANALYTICS_ENABLED": "1"}, clear=True):
            with self.assertRaisesRegex(ValueError, "FIREBASE_API_KEY"):
                main.validate_analytics_config()

    def test_enabled_analytics_renders_shared_initializer(self):
        with patch.dict(os.environ, TEST_FIREBASE_ENV, clear=True):
            main.validate_analytics_config()
            analytics_head = main.get_analytics_head_html()

        self.assertIn('/static/js/firebaseRuntime.js', analytics_head)
        self.assertIn('"analyticsEnabled":true', analytics_head)
        self.assertIn('"measurementId":"G-TEST123"', analytics_head)
        self.assertNotIn(main.ANALYTICS_HEAD_PLACEHOLDER, analytics_head)

    def test_production_defaults_to_social_only_auth(self):
        environment = {
            "APP_ENV": "production",
            "FIREBASE_API_KEY": "test-api-key",
            "FIREBASE_AUTH_DOMAIN": "roguellm.test.firebaseapp.com",
            "FIREBASE_PROJECT_ID": "roguellm-test",
            "FIREBASE_APP_ID": "1:123456789:web:test",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertTrue(main.is_social_auth_enabled())
            self.assertFalse(main.is_legacy_password_auth_enabled())
            auth_head = main.get_analytics_head_html()

        self.assertIn('"socialEnabled":true', auth_head)
        self.assertIn('"legacyPasswordEnabled":false', auth_head)
        self.assertIn('/static/js/firebaseRuntime.js', auth_head)


if __name__ == "__main__":
    unittest.main()

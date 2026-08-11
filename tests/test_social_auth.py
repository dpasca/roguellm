import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import firebase_auth
from firebase_auth import (
    FirebaseAuthError,
    FirebaseIdentity,
    delete_firebase_account,
    verify_firebase_id_token,
)
import main
from db import DatabaseManager


FIREBASE_ENV = {
    "APP_ENV": "production",
    "SESSION_SECRET_KEY": "test-session-secret-that-is-long-enough-12345",
    "ENABLE_SOCIAL_AUTH": "1",
    "ENABLE_LEGACY_PASSWORD_AUTH": "0",
    "AUTH_RATE_LIMIT_ENABLED": "0",
    "WORLD_PUBLIC_REVIEW_WORKER_ENABLED": "0",
    "FIREBASE_API_KEY": "test-api-key",
    "FIREBASE_AUTH_DOMAIN": "roguellm-test.firebaseapp.com",
    "FIREBASE_PROJECT_ID": "roguellm-test",
    "FIREBASE_APP_ID": "1:123:web:test",
}
TEST_ISSUER = "https://securetoken.google.com/roguellm-test"


def make_identity(subject="firebase-user-1", provider="google"):
    return FirebaseIdentity(
        issuer=TEST_ISSUER,
        subject=subject,
        provider=provider,
        email="player@example.com",
        display_name="World Player",
        auth_time=1_700_000_000,
    )


class FirebaseAuthHelperTests(unittest.TestCase):
    def test_verified_token_returns_allowed_identity(self):
        claims = {
            "iss": TEST_ISSUER,
            "sub": "firebase-user-1",
            "auth_time": 1_700_000_000,
            "email": " player@example.com ",
            "name": "  World   Player ",
            "firebase": {"sign_in_provider": "google.com"},
        }
        with patch.dict(os.environ, {
            "FIREBASE_PROJECT_ID": "roguellm-test",
        }, clear=True), patch.object(
            firebase_auth.google_id_token,
            "verify_firebase_token",
            return_value=claims,
        ):
            identity = verify_firebase_id_token(
                "signed-firebase-token",
                recent_auth_seconds=300,
                now=1_700_000_100,
            )

        self.assertEqual(identity.subject, "firebase-user-1")
        self.assertEqual(identity.provider, "google")
        self.assertEqual(identity.email, "player@example.com")
        self.assertEqual(identity.display_name, "World Player")

    def test_token_rejects_unsupported_provider_and_stale_auth(self):
        claims = {
            "iss": TEST_ISSUER,
            "sub": "firebase-user-1",
            "auth_time": 1_700_000_000,
            "firebase": {"sign_in_provider": "password"},
        }
        with patch.dict(os.environ, {
            "FIREBASE_PROJECT_ID": "roguellm-test",
        }, clear=True), patch.object(
            firebase_auth.google_id_token,
            "verify_firebase_token",
            return_value=claims,
        ):
            with self.assertRaisesRegex(FirebaseAuthError, "Unsupported"):
                verify_firebase_id_token("signed-firebase-token")

            claims["firebase"]["sign_in_provider"] = "apple.com"
            with self.assertRaisesRegex(FirebaseAuthError, "Recent sign-in"):
                verify_firebase_id_token(
                    "signed-firebase-token",
                    recent_auth_seconds=300,
                    now=1_700_000_301,
                )

    def test_token_rejects_non_mapping_claims(self):
        with patch.dict(os.environ, {
            "FIREBASE_PROJECT_ID": "roguellm-test",
        }, clear=True), patch.object(
            firebase_auth.google_id_token,
            "verify_firebase_token",
            return_value=None,
        ):
            with self.assertRaisesRegex(FirebaseAuthError, "Invalid"):
                verify_firebase_id_token("signed-firebase-token")

    def test_already_deleted_firebase_user_is_recoverable(self):
        response = Mock(ok=False)
        response.json.return_value = {
            "error": {"message": "USER_NOT_FOUND"},
        }
        with patch.dict(os.environ, {
            "FIREBASE_API_KEY": "test-api-key",
        }, clear=True), patch.object(
            firebase_auth.requests,
            "post",
            return_value=response,
        ):
            delete_firebase_account("signed-firebase-token")


class SocialAuthIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            self.database = DatabaseManager()
        self.database.db_path = os.path.join(
            self.directory.name,
            "social_auth.db",
        )
        self.database.init_db()
        main.social_auth_rate_limiter.failures.clear()

    def tearDown(self):
        self.database.shutdown()
        self.directory.cleanup()

    def test_social_identity_is_stable_and_username_collisions_are_safe(self):
        self.database.create_user("World Player", "Secret123!")
        first = self.database.get_or_create_social_user(
            issuer=TEST_ISSUER,
            subject="firebase-user-1",
            provider="google",
            email="player@example.com",
            display_name="World Player",
        )
        repeat = self.database.get_or_create_social_user(
            issuer=TEST_ISSUER,
            subject="firebase-user-1",
            provider="google",
            email="new-address@example.com",
            display_name="World Player",
        )
        second_identity = self.database.get_or_create_social_user(
            issuer=TEST_ISSUER,
            subject="firebase-user-2",
            provider="google",
            display_name="World Player",
        )

        self.assertEqual(first["id"], repeat["id"])
        self.assertNotEqual(first["id"], second_identity["id"])
        self.assertNotEqual(first["username"].lower(), "world player")
        self.assertNotEqual(
            first["username"].lower(),
            second_identity["username"].lower(),
        )
        identities = self.database.get_user_auth_identities(first["id"])
        self.assertEqual(identities[0]["provider"], "google")

    def test_web_and_mobile_exchange_use_verified_identity(self):
        identity = make_identity()
        with patch.dict(os.environ, FIREBASE_ENV, clear=True), \
                patch("main.db", self.database), \
                patch("main.verify_firebase_id_token", return_value=identity):
            with TestClient(main.app) as client:
                web = client.post("/api/auth/firebase", json={
                    "id_token": "web-firebase-token",
                })
                me = client.get("/api/me")
                legacy = client.post("/api/signup", json={
                    "username": "legacy-user",
                    "password": "LegacyPass123!",
                })
                mobile = client.post(
                    "/api/auth/firebase",
                    headers={"X-RogueLLM-Mobile": "1"},
                    json={
                        "id_token": "mobile-firebase-token",
                        "platform": "ios",
                    },
                )

        self.assertEqual(web.status_code, 200)
        self.assertEqual(web.json()["auth_providers"], ["google"])
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["username"], web.json()["username"])
        self.assertEqual(legacy.status_code, 403)
        self.assertEqual(legacy.json()["code"], "legacy_auth_disabled")
        self.assertEqual(mobile.status_code, 200)
        self.assertTrue(mobile.json()["access_token"])
        self.assertTrue(mobile.json()["refresh_token"])
        self.assertEqual(
            mobile.json()["user"]["username"],
            web.json()["username"],
        )

    def test_account_deletion_removes_private_data_and_anonymizes_public_world(self):
        identity = make_identity()
        user = self.database.get_or_create_social_user(
            issuer=identity.issuer,
            subject=identity.subject,
            provider=identity.provider,
            email=identity.email,
            display_name=identity.display_name,
        )
        private_world = self.database.save_generator(
            theme_desc="A private castle",
            theme_desc_better="Private Castle",
            language="en",
            player_defs=[],
            item_defs=[],
            enemy_defs=[],
            celltype_defs={},
            owner_id=user["id"],
            visibility="private",
        )
        public_world = self.database.save_generator(
            theme_desc="A public castle",
            theme_desc_better="Public Castle",
            language="en",
            player_defs=[],
            item_defs=[],
            enemy_defs=[],
            celltype_defs={},
            owner_id=user["id"],
            visibility="public",
        )
        self.database.record_verified_store_purchase(
            user_id=user["id"],
            provider="apple",
            external_transaction_id="account-delete-purchase",
            product_id="credits_40",
            credits=40,
            environment="sandbox",
            provider_metadata={"receipt": "sensitive"},
        )

        with patch.dict(os.environ, FIREBASE_ENV, clear=True), \
                patch("main.db", self.database), \
                patch("main.verify_firebase_id_token", return_value=identity), \
                patch("main.delete_firebase_account") as delete_firebase, \
                patch("main.delete_world_assets") as delete_assets:
            with TestClient(main.app) as client:
                sign_in = client.post("/api/auth/firebase", json={
                    "id_token": "initial-firebase-token",
                })
                self.assertEqual(sign_in.status_code, 200)
                deleted = client.request(
                    "DELETE",
                    "/api/account",
                    json={"id_token": "recent-firebase-token"},
                )
                me = client.get("/api/me")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["deleted_worlds"], 1)
        self.assertEqual(deleted.json()["anonymized_public_worlds"], 1)
        self.assertEqual(me.status_code, 401)
        delete_firebase.assert_called_once_with("recent-firebase-token")
        delete_assets.assert_called_once_with([private_world])
        self.assertIsNone(self.database.get_user_by_id(user["id"]))
        self.assertIsNone(self.database.get_generator(private_world))
        remaining_public = self.database.get_generator(public_world)
        self.assertIsNotNone(remaining_public)
        self.assertIsNone(remaining_public["owner_id"])

        with self.database.get_connection() as conn:
            purchase = conn.execute("""
                SELECT user_id, provider_metadata
                FROM store_purchases
                WHERE external_transaction_id = ?
            """, ("account-delete-purchase",)).fetchone()
            credit_rows = conn.execute(
                "SELECT COUNT(*) FROM credit_ledger WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0]
        self.assertTrue(purchase[0].startswith("deleted:"))
        self.assertIsNone(purchase[1])
        self.assertEqual(credit_rows, 0)

    def test_account_deletion_rejects_a_different_social_identity(self):
        identity = make_identity()
        other_identity = make_identity(subject="firebase-user-2")
        self.database.get_or_create_social_user(
            issuer=identity.issuer,
            subject=identity.subject,
            provider=identity.provider,
        )

        with patch.dict(os.environ, FIREBASE_ENV, clear=True), \
                patch("main.db", self.database), \
                patch(
                    "main.verify_firebase_id_token",
                    side_effect=[identity, other_identity],
                ), \
                patch("main.delete_firebase_account") as delete_firebase:
            with TestClient(main.app) as client:
                client.post("/api/auth/firebase", json={
                    "id_token": "initial-firebase-token",
                })
                response = client.request(
                    "DELETE",
                    "/api/account",
                    json={"id_token": "wrong-user-token"},
                )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "identity_mismatch")
        delete_firebase.assert_not_called()


if __name__ == "__main__":
    unittest.main()

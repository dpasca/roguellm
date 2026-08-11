import hashlib
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager
from store_purchases import (
    StorePurchaseVerifier,
    VerifiedStorePurchase,
)


class MobileFoundationTests(unittest.TestCase):
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
            "mobile_foundation.db",
        )
        self.database.init_db()
        self.user = self.database.create_user("mobile-player", "Secret123!")

    def tearDown(self):
        self.database.shutdown()
        self.directory.cleanup()

    def test_mobile_tokens_are_hashed_rotated_and_revocable(self):
        auth_session = self.database.create_mobile_auth_session(
            self.user["id"],
            access_ttl_seconds=300,
            refresh_ttl_seconds=3600,
            platform="ios",
            device_name="Test iPhone",
            now=1000,
        )

        self.assertEqual(
            self.database.get_mobile_access_token_user_id(
                auth_session["access_token"],
                now=1100,
            ),
            self.user["id"],
        )
        with self.database.get_connection() as conn:
            stored = conn.execute("""
                SELECT access_token_hash, refresh_token_hash
                FROM mobile_auth_sessions
                WHERE id = ?
            """, (auth_session["session_id"],)).fetchone()
        self.assertEqual(
            stored[0],
            hashlib.sha256(
                auth_session["access_token"].encode("utf-8")
            ).hexdigest(),
        )
        self.assertNotEqual(stored[0], auth_session["access_token"])
        self.assertNotEqual(stored[1], auth_session["refresh_token"])

        refreshed = self.database.refresh_mobile_auth_session(
            auth_session["refresh_token"],
            access_ttl_seconds=300,
            refresh_ttl_seconds=3600,
            now=1200,
        )
        self.assertIsNotNone(refreshed)
        self.assertIsNone(
            self.database.get_mobile_access_token_user_id(
                auth_session["access_token"],
                now=1201,
            )
        )
        self.assertIsNone(self.database.refresh_mobile_auth_session(
            auth_session["refresh_token"],
            access_ttl_seconds=300,
            refresh_ttl_seconds=3600,
            now=1201,
        ))
        self.assertTrue(
            self.database.revoke_mobile_auth_session(refreshed["access_token"])
        )
        self.assertIsNone(
            self.database.get_mobile_access_token_user_id(
                refreshed["access_token"],
                now=1202,
            )
        )

    def test_verified_store_purchase_is_paid_and_idempotent(self):
        other_user = self.database.create_user("other-player", "Secret123!")
        first = self.database.record_verified_store_purchase(
            user_id=self.user["id"],
            provider="apple",
            external_transaction_id="apple-transaction-1",
            product_id="credits_40",
            credits=40,
            environment="sandbox",
        )
        duplicate = self.database.record_verified_store_purchase(
            user_id=self.user["id"],
            provider="apple",
            external_transaction_id="apple-transaction-1",
            product_id="credits_40",
            credits=40,
            environment="sandbox",
        )
        claimed_by_other = self.database.record_verified_store_purchase(
            user_id=other_user["id"],
            provider="apple",
            external_transaction_id="apple-transaction-1",
            product_id="credits_40",
            credits=40,
            environment="sandbox",
        )

        self.assertTrue(first["applied"])
        self.assertFalse(duplicate["applied"])
        self.assertFalse(duplicate["conflict"])
        self.assertTrue(claimed_by_other["conflict"])
        self.assertEqual(
            self.database.get_credit_balance(self.user["id"]),
            {"promo": 0, "paid": 40, "total": 40},
        )
        self.assertEqual(
            self.database.get_credit_balance(other_user["id"])["total"],
            0,
        )

    def test_mobile_auth_works_for_api_and_binds_game_session(self):
        environment = {
            "AUTH_RATE_LIMIT_ENABLED": "0",
            "ENABLE_WORLD_CREDITS": "0",
            "REQUIRE_LOGIN_TO_CREATE_WORLD": "0",
            "WORLD_PUBLIC_REVIEW_WORKER_ENABLED": "0",
        }
        with patch.dict(os.environ, environment), patch("main.db", self.database):
            main.game_session_manager.sessions.clear()
            with TestClient(main.app) as client:
                login_response = client.post("/api/mobile/auth/login", json={
                    "username": self.user["username"],
                    "password": "Secret123!",
                    "platform": "ios",
                })
                self.assertEqual(login_response.status_code, 200)
                login = login_response.json()
                headers = {"Authorization": f"Bearer {login['access_token']}"}

                me_response = client.get("/api/me", headers=headers)
                self.assertEqual(me_response.status_code, 200)
                self.assertEqual(me_response.json()["username"], self.user["username"])

                session_response = client.post(
                    "/api/create_game_session",
                    headers=headers,
                    json={"theme": "A mobile test world", "language": "en"},
                )
                self.assertEqual(session_response.status_code, 200)
                session_id = session_response.json()["session_id"]
                self.assertEqual(
                    main.game_session_manager.sessions[session_id]["requester_user_id"],
                    self.user["id"],
                )

                refresh_response = client.post("/api/mobile/auth/refresh", json={
                    "refresh_token": login["refresh_token"],
                })
                self.assertEqual(refresh_response.status_code, 200)
                refreshed = refresh_response.json()
                self.assertEqual(client.get("/api/me", headers=headers).status_code, 401)

                refreshed_headers = {
                    "Authorization": f"Bearer {refreshed['access_token']}"
                }
                logout_response = client.post(
                    "/api/mobile/auth/logout",
                    headers=refreshed_headers,
                )
                self.assertEqual(logout_response.status_code, 200)
                self.assertEqual(
                    client.get("/api/me", headers=refreshed_headers).status_code,
                    401,
                )

    def test_purchase_endpoint_uses_verified_catalog_result(self):
        environment = {
            "AUTH_RATE_LIMIT_ENABLED": "0",
            "ENABLE_MOBILE_STORE": "1",
            "WORLD_PUBLIC_REVIEW_WORKER_ENABLED": "0",
        }
        verified = VerifiedStorePurchase(
            provider="google",
            external_transaction_id="google-token-1",
            product_id="credits_120",
            credits=120,
            environment="test",
            metadata={"order_id": "GPA.test"},
        )
        with patch.dict(os.environ, environment), \
                patch("main.db", self.database), \
                patch.object(
                    main.store_purchase_verifier,
                    "verify",
                    return_value=verified,
                ) as verify_purchase:
            with TestClient(main.app) as client:
                login = client.post("/api/mobile/auth/login", json={
                    "username": self.user["username"],
                    "password": "Secret123!",
                    "platform": "android",
                }).json()
                headers = {"Authorization": f"Bearer {login['access_token']}"}

                request_body = {
                    "provider": "google",
                    "purchase_token": "device-supplied-token",
                }
                first = client.post(
                    "/api/mobile/purchases/verify",
                    headers=headers,
                    json=request_body,
                )
                duplicate = client.post(
                    "/api/mobile/purchases/verify",
                    headers=headers,
                    json=request_body,
                )

        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()["verified"])
        self.assertTrue(first.json()["applied"])
        self.assertEqual(first.json()["credits"], 120)
        self.assertFalse(duplicate.json()["applied"])
        self.assertEqual(
            self.database.get_credit_balance(self.user["id"]),
            {"promo": 30, "paid": 120, "total": 150},
        )
        verify_purchase.assert_called_with(
            provider="google",
            user_id=self.user["id"],
            transaction_id=None,
            purchase_token="device-supplied-token",
            environment=None,
        )

    def test_apple_verification_uses_signed_server_transaction(self):
        from appstoreserverlibrary.models.Type import Type

        verifier = StorePurchaseVerifier()
        transaction = SimpleNamespace(
            transactionId="apple-transaction-2",
            productId="credits_40",
            type=Type.CONSUMABLE,
            revocationDate=None,
            quantity=1,
            appAccountToken=self.user["id"],
            purchaseDate=123456789,
            storefront="USA",
        )
        response = SimpleNamespace(signedTransactionInfo="signed-transaction")
        environment = {
            "APP_ENV": "development",
            "APPLE_BUNDLE_ID": "com.newtypekk.roguellm",
            "APPLE_IAP_KEY_ID": "test-key",
            "APPLE_IAP_ISSUER_ID": "test-issuer",
            "APPLE_IAP_ALLOW_SANDBOX": "1",
        }
        with patch.dict(os.environ, environment), \
                patch.object(
                    verifier,
                    "_read_apple_private_key",
                    return_value=b"private-key",
                ), \
                patch.object(
                    verifier,
                    "_read_apple_root_certificates",
                    return_value=[b"root-certificate"],
                ), \
                patch(
                    "appstoreserverlibrary.api_client.AppStoreServerAPIClient"
                ) as api_client, \
                patch(
                    "appstoreserverlibrary.signed_data_verifier.SignedDataVerifier"
                ) as signed_data_verifier:
            api_client.return_value.get_transaction_info.return_value = response
            signed_data_verifier.return_value \
                .verify_and_decode_signed_transaction.return_value = transaction

            verified = verifier.verify(
                provider="apple",
                user_id=self.user["id"],
                transaction_id="apple-transaction-2",
                environment="sandbox",
            )

        self.assertEqual(verified.product_id, "credits_40")
        self.assertEqual(verified.credits, 40)
        self.assertEqual(verified.environment, "sandbox")
        api_client.return_value.get_transaction_info.assert_called_once_with(
            "apple-transaction-2"
        )
        signed_data_verifier.return_value \
            .verify_and_decode_signed_transaction.assert_called_once_with(
                "signed-transaction"
            )

    def test_apple_verification_falls_back_to_allowed_sandbox(self):
        from appstoreserverlibrary.api_client import APIException
        from appstoreserverlibrary.models.Environment import Environment
        from appstoreserverlibrary.models.Type import Type

        transaction = SimpleNamespace(
            transactionId="apple-sandbox-transaction",
            productId="credits_120",
            type=Type.CONSUMABLE,
            revocationDate=None,
            quantity=1,
            appAccountToken=self.user["id"],
            purchaseDate=123456789,
            storefront="JPN",
        )
        response = SimpleNamespace(signedTransactionInfo="signed-transaction")
        environment = {
            "APP_ENV": "production",
            "APPLE_APP_ID": "6800248025",
            "APPLE_BUNDLE_ID": "com.newtypekk.roguellm",
            "APPLE_IAP_KEY_ID": "test-key",
            "APPLE_IAP_ISSUER_ID": "test-issuer",
            "APPLE_IAP_ALLOW_SANDBOX": "1",
        }
        production_errors = (
            APIException(401),
            APIException(404, 4040010, "Transaction ID not found."),
        )

        for production_error in production_errors:
            with self.subTest(production_error=str(production_error)):
                verifier = StorePurchaseVerifier()
                production_client = Mock()
                production_client.get_transaction_info.side_effect = (
                    production_error
                )
                sandbox_client = Mock()
                sandbox_client.get_transaction_info.return_value = response

                with patch.dict(os.environ, environment), \
                        patch.object(
                            verifier,
                            "_read_apple_private_key",
                            return_value=b"private-key",
                        ), \
                        patch.object(
                            verifier,
                            "_read_apple_root_certificates",
                            return_value=[b"root-certificate"],
                        ), \
                        patch(
                            "appstoreserverlibrary.api_client."
                            "AppStoreServerAPIClient",
                            side_effect=[production_client, sandbox_client],
                        ) as api_client, \
                        patch(
                            "appstoreserverlibrary.signed_data_verifier."
                            "SignedDataVerifier"
                        ) as signed_data_verifier:
                    signed_data_verifier.return_value \
                        .verify_and_decode_signed_transaction.return_value = (
                            transaction
                        )

                    verified = verifier.verify(
                        provider="apple",
                        user_id=self.user["id"],
                        transaction_id="apple-sandbox-transaction",
                        environment="production",
                    )

                self.assertEqual(verified.product_id, "credits_120")
                self.assertEqual(verified.environment, "sandbox")
                self.assertEqual(api_client.call_count, 2)
                self.assertEqual(
                    api_client.call_args_list[0].args[-1],
                    Environment.PRODUCTION,
                )
                self.assertEqual(
                    api_client.call_args_list[1].args[-1],
                    Environment.SANDBOX,
                )
                production_client.get_transaction_info \
                    .assert_called_once_with("apple-sandbox-transaction")
                sandbox_client.get_transaction_info \
                    .assert_called_once_with("apple-sandbox-transaction")

    def test_google_verification_uses_product_v2_authority(self):
        verifier = StorePurchaseVerifier()
        credentials = Mock(token="service-account-token")
        response = Mock()
        response.json.return_value = {
            "purchaseStateContext": {"purchaseState": "PURCHASED"},
            "productLineItem": [{
                "productId": "credits_300",
                "productOfferDetails": {
                    "quantity": 1,
                    "refundableQuantity": 1,
                    "consumptionState": "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
                },
            }],
            "obfuscatedExternalAccountId": self.user["id"],
            "orderId": "GPA.test-order",
            "purchaseCompletionTime": "2026-08-11T00:00:00Z",
            "regionCode": "JP",
        }
        environment = {
            "APP_ENV": "development",
            "GOOGLE_PLAY_PACKAGE_NAME": "com.newtypekk.roguellm",
        }
        with patch.dict(os.environ, environment), \
                patch.object(
                    verifier,
                    "_google_credentials",
                    return_value=credentials,
                ), \
                patch("requests.get", return_value=response) as get_purchase:
            verified = verifier.verify(
                provider="google",
                user_id=self.user["id"],
                purchase_token="google/token+2",
            )

        self.assertEqual(verified.product_id, "credits_300")
        self.assertEqual(verified.credits, 300)
        self.assertEqual(verified.environment, "production")
        credentials.refresh.assert_called_once()
        response.raise_for_status.assert_called_once()
        get_purchase.assert_called_once_with(
            "https://androidpublisher.googleapis.com/androidpublisher/v3/"
            "applications/com.newtypekk.roguellm/purchases/productsv2/"
            "tokens/google%2Ftoken%2B2",
            headers={"Authorization": "Bearer service-account-token"},
            timeout=15,
        )


if __name__ == "__main__":
    unittest.main()

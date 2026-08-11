import base64
import binascii
import json
import logging
import os
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import quote


MOBILE_APP_ID = "com.newtypekk.roguellm"
ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
GOOGLE_PURCHASE_URL = (
    "https://androidpublisher.googleapis.com/androidpublisher/v3/"
    "applications/{package_name}/purchases/productsv2/tokens/{purchase_token}"
)

CREDIT_PRODUCTS = {
    "credits_40": 40,
    "credits_120": 120,
    "credits_300": 300,
}


class StorePurchaseVerificationError(Exception):
    def __init__(self, message: str, code: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class VerifiedStorePurchase:
    provider: str
    external_transaction_id: str
    product_id: str
    credits: int
    environment: str
    metadata: Dict


def get_credit_product_catalog() -> list:
    return [
        {"product_id": product_id, "credits": credits}
        for product_id, credits in CREDIT_PRODUCTS.items()
    ]


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _is_production() -> bool:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "development").strip().lower() in {
        "production",
        "prod",
    }


def _require_product(product_id: Optional[str]) -> int:
    credits = CREDIT_PRODUCTS.get(product_id or "")
    if not credits:
        raise StorePurchaseVerificationError(
            "The store product is not recognized.",
            "unknown_product",
        )
    return credits


class StorePurchaseVerifier:
    """Verify consumable purchases against the platform authority.

    Callers must grant from the returned catalog amount, never a value from
    the device. Native transaction finishing happens only after the database
    has recorded the returned purchase idempotently.
    """

    def verify(
            self,
            provider: str,
            user_id: str,
            transaction_id: Optional[str] = None,
            purchase_token: Optional[str] = None,
            environment: Optional[str] = None,
    ) -> VerifiedStorePurchase:
        normalized_provider = (provider or "").strip().lower()
        if normalized_provider == "apple":
            return self._verify_apple(
                user_id=user_id,
                transaction_id=transaction_id,
                environment=environment,
            )
        if normalized_provider == "google":
            return self._verify_google(
                user_id=user_id,
                purchase_token=purchase_token,
            )
        raise StorePurchaseVerificationError(
            "The store provider is not supported.",
            "unsupported_provider",
        )

    @staticmethod
    def _read_apple_private_key() -> bytes:
        inline_key = os.getenv("APPLE_IAP_PRIVATE_KEY")
        if inline_key:
            return inline_key.replace("\\n", "\n").encode("utf-8")

        key_path = (os.getenv("APPLE_IAP_PRIVATE_KEY_PATH") or "").strip()
        if not key_path:
            raise StorePurchaseVerificationError(
                "Apple purchase verification is not configured.",
                "store_not_configured",
                503,
            )
        try:
            with open(key_path, "rb") as key_file:
                return key_file.read()
        except OSError as error:
            logging.error("Unable to read the configured Apple IAP private key: %s", error)
            raise StorePurchaseVerificationError(
                "Apple purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error

    @staticmethod
    def _read_apple_root_certificates() -> list:
        raw_certificates = os.getenv("APPLE_IAP_ROOT_CA_BASE64") or ""
        encoded_certificates = [
            certificate.strip()
            for certificate in raw_certificates.split(",")
            if certificate.strip()
        ]
        if encoded_certificates:
            try:
                return [
                    base64.b64decode(certificate, validate=True)
                    for certificate in encoded_certificates
                ]
            except (binascii.Error, ValueError) as error:
                logging.error("A configured Apple root certificate is not valid base64")
                raise StorePurchaseVerificationError(
                    "Apple purchase verification is unavailable.",
                    "store_unavailable",
                    503,
                ) from error

        raw_paths = os.getenv("APPLE_IAP_ROOT_CA_PATHS") or ""
        paths = [path.strip() for path in raw_paths.split(",") if path.strip()]
        if not paths:
            raise StorePurchaseVerificationError(
                "Apple purchase verification is not configured.",
                "store_not_configured",
                503,
            )

        certificates = []
        try:
            for path in paths:
                with open(path, "rb") as certificate_file:
                    certificates.append(certificate_file.read())
        except OSError as error:
            logging.error("Unable to read a configured Apple root certificate: %s", error)
            raise StorePurchaseVerificationError(
                "Apple purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error
        return certificates

    def _verify_apple(
            self,
            user_id: str,
            transaction_id: Optional[str],
            environment: Optional[str],
    ) -> VerifiedStorePurchase:
        if not transaction_id:
            raise StorePurchaseVerificationError(
                "An Apple transaction identifier is required.",
                "missing_transaction",
            )

        normalized_environment = (environment or "production").strip().lower()
        if normalized_environment not in {"production", "sandbox"}:
            raise StorePurchaseVerificationError(
                "The Apple store environment is invalid.",
                "invalid_environment",
            )
        allow_sandbox = _env_bool("APPLE_IAP_ALLOW_SANDBOX", not _is_production())
        if normalized_environment == "sandbox" and not allow_sandbox:
            raise StorePurchaseVerificationError(
                "Sandbox purchases are not accepted by this server.",
                "sandbox_not_allowed",
                403,
            )

        key_id = (os.getenv("APPLE_IAP_KEY_ID") or "").strip()
        issuer_id = (os.getenv("APPLE_IAP_ISSUER_ID") or "").strip()
        bundle_id = (os.getenv("APPLE_BUNDLE_ID") or MOBILE_APP_ID).strip()
        raw_apple_id = (os.getenv("APPLE_APP_ID") or "").strip()
        if not key_id or not issuer_id or not bundle_id:
            raise StorePurchaseVerificationError(
                "Apple purchase verification is not configured.",
                "store_not_configured",
                503,
            )

        try:
            from appstoreserverlibrary.api_client import AppStoreServerAPIClient
            from appstoreserverlibrary.models.Environment import Environment
            from appstoreserverlibrary.models.Type import Type
            from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier
        except ImportError as error:
            raise StorePurchaseVerificationError(
                "Apple purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error

        apple_environment = (
            Environment.PRODUCTION
            if normalized_environment == "production"
            else Environment.SANDBOX
        )
        app_apple_id = None
        if apple_environment == Environment.PRODUCTION:
            try:
                app_apple_id = int(raw_apple_id)
            except ValueError as error:
                raise StorePurchaseVerificationError(
                    "Apple purchase verification is not configured.",
                    "store_not_configured",
                    503,
                ) from error

        try:
            client = AppStoreServerAPIClient(
                self._read_apple_private_key(),
                key_id,
                issuer_id,
                bundle_id,
                apple_environment,
            )
            verifier = SignedDataVerifier(
                self._read_apple_root_certificates(),
                True,
                apple_environment,
                bundle_id,
                app_apple_id,
            )
            response = client.get_transaction_info(transaction_id)
            signed_transaction = response.signedTransactionInfo
            if not signed_transaction:
                raise StorePurchaseVerificationError(
                    "Apple did not return a signed transaction.",
                    "invalid_transaction",
                )
            transaction = verifier.verify_and_decode_signed_transaction(
                signed_transaction
            )
        except StorePurchaseVerificationError:
            raise
        except Exception as error:
            logging.warning(
                "Apple rejected or could not verify transaction %s: %s",
                transaction_id,
                type(error).__name__,
            )
            raise StorePurchaseVerificationError(
                "Apple could not verify this purchase.",
                "invalid_transaction",
            ) from error

        if transaction.transactionId != transaction_id:
            raise StorePurchaseVerificationError(
                "The Apple transaction identifier did not match.",
                "transaction_mismatch",
            )
        credits = _require_product(transaction.productId)
        if transaction.type != Type.CONSUMABLE:
            raise StorePurchaseVerificationError(
                "The Apple product is not a consumable credit pack.",
                "invalid_product_type",
            )
        if transaction.revocationDate is not None:
            raise StorePurchaseVerificationError(
                "This Apple purchase has been revoked.",
                "purchase_revoked",
            )
        if int(transaction.quantity or 1) != 1:
            raise StorePurchaseVerificationError(
                "Credit packs must be purchased one at a time.",
                "invalid_quantity",
            )
        if transaction.appAccountToken != user_id:
            raise StorePurchaseVerificationError(
                "This Apple purchase belongs to a different RogueLLM account.",
                "account_mismatch",
                409,
            )

        return VerifiedStorePurchase(
            provider="apple",
            external_transaction_id=transaction_id,
            product_id=transaction.productId,
            credits=credits,
            environment=normalized_environment,
            metadata={
                "purchase_date": transaction.purchaseDate,
                "storefront": transaction.storefront,
                "quantity": int(transaction.quantity or 1),
            },
        )

    @staticmethod
    def _google_credentials() -> object:
        try:
            from google.oauth2 import service_account
        except ImportError as error:
            raise StorePurchaseVerificationError(
                "Google Play purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error

        inline_json = os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")
        credential_path = (
            os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_PATH")
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            or ""
        ).strip()
        try:
            if inline_json:
                credential_info = json.loads(inline_json)
                return service_account.Credentials.from_service_account_info(
                    credential_info,
                    scopes=[ANDROID_PUBLISHER_SCOPE],
                )
            if credential_path:
                return service_account.Credentials.from_service_account_file(
                    credential_path,
                    scopes=[ANDROID_PUBLISHER_SCOPE],
                )
        except (OSError, ValueError, TypeError) as error:
            logging.error(
                "Unable to load the configured Google Play service account: %s",
                type(error).__name__,
            )
            raise StorePurchaseVerificationError(
                "Google Play purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error

        raise StorePurchaseVerificationError(
            "Google Play purchase verification is not configured.",
            "store_not_configured",
            503,
        )

    def _verify_google(
            self,
            user_id: str,
            purchase_token: Optional[str],
    ) -> VerifiedStorePurchase:
        if not purchase_token:
            raise StorePurchaseVerificationError(
                "A Google Play purchase token is required.",
                "missing_transaction",
            )

        try:
            import requests
            from google.auth.transport.requests import Request as GoogleAuthRequest
        except ImportError as error:
            raise StorePurchaseVerificationError(
                "Google Play purchase verification is unavailable.",
                "store_unavailable",
                503,
            ) from error

        package_name = (
            os.getenv("GOOGLE_PLAY_PACKAGE_NAME") or MOBILE_APP_ID
        ).strip()
        credentials = self._google_credentials()
        try:
            credentials.refresh(GoogleAuthRequest())
            url = GOOGLE_PURCHASE_URL.format(
                package_name=quote(package_name, safe=""),
                purchase_token=quote(purchase_token, safe=""),
            )
            response = requests.get(
                url,
                headers={"Authorization": f"Bearer {credentials.token}"},
                timeout=15,
            )
            response.raise_for_status()
            purchase = response.json()
        except Exception as error:
            logging.warning(
                "Google Play rejected or could not verify a purchase: %s",
                type(error).__name__,
            )
            raise StorePurchaseVerificationError(
                "Google Play could not verify this purchase.",
                "invalid_transaction",
            ) from error

        purchase_state = (
            purchase.get("purchaseStateContext", {}).get("purchaseState")
        )
        if purchase_state != "PURCHASED":
            raise StorePurchaseVerificationError(
                "The Google Play purchase is not complete.",
                "purchase_not_complete",
                409,
            )

        line_items = purchase.get("productLineItem") or []
        if len(line_items) != 1:
            raise StorePurchaseVerificationError(
                "A credit purchase must contain exactly one product.",
                "invalid_product_count",
            )
        line_item = line_items[0]
        product_id = line_item.get("productId")
        credits = _require_product(product_id)
        offer_details = line_item.get("productOfferDetails") or {}
        quantity = int(offer_details.get("quantity") or 1)
        refundable_quantity = int(
            offer_details.get("refundableQuantity")
            if offer_details.get("refundableQuantity") is not None
            else quantity
        )
        if quantity != 1 or refundable_quantity < 1:
            raise StorePurchaseVerificationError(
                "Credit packs must be purchased one at a time and not refunded.",
                "invalid_quantity",
            )

        account_id = purchase.get("obfuscatedExternalAccountId")
        if account_id != user_id:
            raise StorePurchaseVerificationError(
                "This Google Play purchase belongs to a different RogueLLM account.",
                "account_mismatch",
                409,
            )

        is_test_purchase = purchase.get("testPurchaseContext") is not None
        allow_test_purchases = _env_bool(
            "GOOGLE_PLAY_ALLOW_TEST_PURCHASES",
            not _is_production(),
        )
        if is_test_purchase and not allow_test_purchases:
            raise StorePurchaseVerificationError(
                "Google Play test purchases are not accepted by this server.",
                "test_purchase_not_allowed",
                403,
            )

        return VerifiedStorePurchase(
            provider="google",
            external_transaction_id=purchase_token,
            product_id=product_id,
            credits=credits,
            environment="test" if is_test_purchase else "production",
            metadata={
                "order_id": purchase.get("orderId"),
                "purchase_completion_time": purchase.get("purchaseCompletionTime"),
                "region_code": purchase.get("regionCode"),
                "quantity": quantity,
                "consumption_state": offer_details.get("consumptionState"),
            },
        )

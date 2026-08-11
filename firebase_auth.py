"""Firebase Authentication token verification and account deletion helpers."""

from dataclasses import dataclass
import os
import time
from typing import Optional

from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
import requests


ALLOWED_FIREBASE_PROVIDERS = {
    "apple.com": "apple",
    "google.com": "google",
}
FIREBASE_DELETE_ACCOUNT_URL = (
    "https://identitytoolkit.googleapis.com/v1/accounts:delete"
)
FIREBASE_TOKEN_MAX_LENGTH = 16_384


class FirebaseAuthError(ValueError):
    """Raised when a Firebase credential cannot be trusted."""


class FirebaseAccountDeletionError(RuntimeError):
    """Raised when Firebase refuses or cannot complete account deletion."""


@dataclass(frozen=True)
class FirebaseIdentity:
    issuer: str
    subject: str
    provider: str
    email: Optional[str]
    display_name: Optional[str]
    auth_time: int


_google_request = google_requests.Request()


def _required_firebase_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise FirebaseAuthError(f"{name} is required for Firebase Authentication")
    return value


def verify_firebase_id_token(
        raw_token: str,
        recent_auth_seconds: Optional[int] = None,
        now: Optional[int] = None,
) -> FirebaseIdentity:
    """Verify a Firebase ID token and return the allowed social identity."""
    token = (raw_token or "").strip()
    if not token or len(token) > FIREBASE_TOKEN_MAX_LENGTH:
        raise FirebaseAuthError("Invalid Firebase ID token")

    project_id = _required_firebase_env("FIREBASE_PROJECT_ID")
    try:
        claims = google_id_token.verify_firebase_token(
            token,
            _google_request,
            audience=project_id,
        )
    except (GoogleAuthError, ValueError, TypeError) as error:
        raise FirebaseAuthError("Invalid Firebase ID token") from error

    if not isinstance(claims, dict):
        raise FirebaseAuthError("Invalid Firebase ID token")

    issuer = claims.get("iss")
    expected_issuer = f"https://securetoken.google.com/{project_id}"
    if issuer != expected_issuer:
        raise FirebaseAuthError("Invalid Firebase token issuer")

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject or len(subject) > 128:
        raise FirebaseAuthError("Invalid Firebase token subject")

    firebase_claims = claims.get("firebase")
    provider_id = (
        firebase_claims.get("sign_in_provider")
        if isinstance(firebase_claims, dict)
        else None
    )
    provider = ALLOWED_FIREBASE_PROVIDERS.get(provider_id)
    if provider is None:
        raise FirebaseAuthError("Unsupported Firebase sign-in provider")

    try:
        auth_time = int(claims["auth_time"])
    except (KeyError, TypeError, ValueError) as error:
        raise FirebaseAuthError("Firebase token is missing authentication time") from error

    current_time = int(time.time() if now is None else now)
    if auth_time > current_time + 60:
        raise FirebaseAuthError("Firebase authentication time is in the future")
    if recent_auth_seconds is not None:
        if recent_auth_seconds <= 0:
            raise ValueError("recent_auth_seconds must be positive")
        if current_time - auth_time > recent_auth_seconds:
            raise FirebaseAuthError("Recent sign-in is required")

    email = claims.get("email")
    if not isinstance(email, str) or not email.strip():
        email = None
    else:
        email = email.strip()[:320]

    display_name = claims.get("name")
    if not isinstance(display_name, str) or not display_name.strip():
        display_name = None
    else:
        display_name = " ".join(display_name.split())[:120]

    return FirebaseIdentity(
        issuer=issuer,
        subject=subject,
        provider=provider,
        email=email,
        display_name=display_name,
        auth_time=auth_time,
    )


def delete_firebase_account(raw_token: str) -> None:
    """Delete the Firebase user represented by a recently verified ID token."""
    api_key = _required_firebase_env("FIREBASE_API_KEY")
    try:
        response = requests.post(
            FIREBASE_DELETE_ACCOUNT_URL,
            params={"key": api_key},
            json={"idToken": raw_token},
            timeout=10,
        )
    except requests.RequestException as error:
        raise FirebaseAccountDeletionError(
            "Firebase account deletion is temporarily unavailable"
        ) from error

    if response.ok:
        return

    error_code = ""
    try:
        payload = response.json()
        error_data = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error_data, dict):
            error_code = str(error_data.get("message") or "")
    except ValueError:
        pass

    # A previous deletion attempt may have removed Firebase first and crashed
    # before the local transaction completed. Treat that recovery case as a
    # successful remote deletion so the user can finish removing local data.
    if error_code == "USER_NOT_FOUND":
        return

    if error_code in {"INVALID_ID_TOKEN", "TOKEN_EXPIRED"}:
        message = "Please sign in again before deleting your account"
    else:
        message = "Firebase account deletion is temporarily unavailable"
    raise FirebaseAccountDeletionError(message)

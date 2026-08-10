import sys
# Logging before everything else
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.websockets import WebSocketDisconnect
from pydantic import BaseModel
from typing import Dict, List, Optional
import json
import time
import os
import math
from dotenv import load_dotenv
import uuid
import zlib
import base64
import secrets
from social_crawler import get_prerendered_content
from gen_image import (
    get_world_assets_dir,
    is_world_art_enabled,
    register_world_asset_media_types,
)
import asyncio
import aiofiles

from starlette.middleware.sessions import SessionMiddleware
from game import Game
from db import db
from world_moderation import (
    get_world_public_review_model_name,
    process_due_public_world_reviews,
    process_public_world_review,
)

load_dotenv()

#==================================================================
# Game Session Management
#==================================================================
class GameSessionManager:
    """Manages in-memory game sessions."""

    def __init__(self):
        self.sessions: Dict[str, dict] = {}  # Changed to store session data directly

    def create_session(self, game_instance: Game) -> str:
        """Create a new game session and return session ID."""
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            'created_at': time.time(),
            'last_accessed': time.time(),
            'game_instance': game_instance,
            'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None,
            'status': 'ready'
        }
        logging.info(f"Created new game session: {session_id}")
        return session_id

    def get_session(self, session_id: str) -> Optional[Game]:
        """Get a game session by ID."""
        if session_id in self.sessions:
            session_data = self.sessions[session_id]
            session_data['last_accessed'] = time.time()

            # Handle both new and old session structures
            if isinstance(session_data, dict) and 'game_instance' in session_data:
                return session_data['game_instance']
            else:
                # Old structure - session_data is the game instance directly
                return session_data
        return None

    def remove_session(self, session_id: str):
        """Remove a game session."""
        if session_id in self.sessions:
            del self.sessions[session_id]
            logging.info(f"Removed game session: {session_id}")

    def cleanup_expired_sessions(self, max_age_hours: int = 24):
        """Remove sessions older than max_age_hours."""
        current_time = time.time()
        expired_sessions = []

        for session_id, session_data in self.sessions.items():
            if current_time - session_data['last_accessed'] > max_age_hours * 3600:
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            self.remove_session(session_id)

        if expired_sessions:
            logging.info(f"Cleaned up {len(expired_sessions)} expired sessions")

    def get_session_count(self) -> int:
        """Get the number of active sessions."""
        return len(self.sessions)

# Global session manager
game_session_manager = GameSessionManager()

#==================================================================
# Models
#==================================================================
class CreateGameRequest(BaseModel):
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = True
    generator_id: Optional[str] = None

class CreateGameSessionRequest(BaseModel):
    generator_id: Optional[str] = None
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = True

class GameCreationRequest(BaseModel):
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = True
    generator_id: Optional[str] = None
    debug_seed: Optional[int] = None

class AdminPasswordResetRequest(BaseModel):
    password_reset_required: bool

def get_world_creation_timeout_seconds() -> float:
    """How long a forge may take before it is abandoned.

    A text-only forge finishes well inside a minute, but generating art adds
    roughly a dozen image calls at 10-25s each, so the old flat 60s ceiling
    would have failed every art-enabled forge. Scales with the feature rather
    than being one number that has to suit both.
    """
    override = os.getenv("WORLD_CREATION_TIMEOUT_SECONDS")
    if override:
        try:
            return max(30.0, float(override))
        except ValueError:
            logging.warning("Invalid WORLD_CREATION_TIMEOUT_SECONDS: %s", override)

    return 600.0 if is_world_art_enabled() else 60.0


def is_local_dev_request(request: Request) -> bool:
    client_host = request.client.host if request.client else ""
    return client_host in {"127.0.0.1", "::1", "localhost"}

def is_world_library_allowed(request: Request) -> bool:
    return (
        is_local_dev_request(request)
        or os.getenv("ENABLE_WORLD_LIBRARY") == "1"
    )

def is_debug_seed_allowed(request: Request) -> bool:
    return (
        is_local_dev_request(request)
        or os.getenv("ENABLE_DEBUG_SEED") == "1"
    )

def get_request_user_id(request: Request) -> Optional[str]:
    return request.session.get("user_id")


def serialize_user(user: Dict) -> Dict:
    return {"username": user["username"]}


def get_admin_usernames() -> set:
    admin_usernames = set()
    for raw_value in (
            os.getenv("ADMIN_USERNAMES", ""),
            os.getenv("ADMIN_USERNAME", ""),
    ):
        for username in raw_value.split(","):
            normalized_username = username.strip().lower()
            if normalized_username:
                admin_usernames.add(normalized_username)

    return admin_usernames


def get_request_user(request: Request) -> Optional[Dict]:
    user_id = get_request_user_id(request)
    if not user_id:
        return None

    return db.get_user_by_id(user_id)


def is_admin_user(user: Optional[Dict]) -> bool:
    if not user:
        return False

    admin_usernames = get_admin_usernames()
    if not admin_usernames:
        return False

    return user["username"].strip().lower() in admin_usernames


def require_admin_user(request: Request) -> Dict:
    user = get_request_user(request)
    if not is_admin_user(user):
        raise HTTPException(status_code=404, detail="Not Found")

    return user


def can_manage_world(world: Dict, requester_user_id: Optional[str]) -> bool:
    owner_id = world.get("owner_id")
    return bool(owner_id and requester_user_id and owner_id == requester_user_id)


def serialize_world_summary(world: Dict, requester_user_id: Optional[str]) -> Dict:
    return {
        "id": world["id"],
        "title": world["title"],
        "theme": world["theme"],
        "language": world.get("language"),
        "player_count": world.get("player_count", 0),
        "item_count": world.get("item_count", 0),
        "enemy_count": world.get("enemy_count", 0),
        "terrain_count": world.get("terrain_count", 0),
        "created_at": world.get("created_at"),
        "updated_at": world.get("updated_at"),
        "visibility": world.get("visibility", "unlisted"),
        "moderation_status": world.get("moderation_status", "not_requested"),
        "moderation_reason": world.get("moderation_reason"),
        "moderation_confidence": world.get("moderation_confidence"),
        "moderation_categories": world.get("moderation_categories", []),
        "public_requested_at": world.get("public_requested_at"),
        "public_review_after": world.get("public_review_after"),
        "public_reviewed_at": world.get("public_reviewed_at"),
        "cover_url": world.get("cover_url"),
        "can_manage": can_manage_world(world, requester_user_id),
    }


def serialize_generator_metadata(
        world_id: str,
        generator_data: Dict,
        requester_user_id: Optional[str],
) -> Dict:
    theme_desc = generator_data.get('theme_desc') or ""
    theme_desc_better = generator_data.get('theme_desc_better') or theme_desc
    title_source = theme_desc_better.strip() or theme_desc.strip()
    title = title_source.splitlines()[0][:120] if title_source else world_id

    return {
        "id": world_id,
        "title": title,
        "theme": theme_desc,
        "language": generator_data.get('language'),
        "player_count": len(generator_data.get('player_defs', [])),
        "item_count": len(generator_data.get('item_defs', [])),
        "enemy_count": len(generator_data.get('enemy_defs', [])),
        "terrain_count": len(generator_data.get('celltype_defs', {})),
        "visibility": generator_data.get('visibility', 'unlisted'),
        "moderation_status": generator_data.get('moderation_status', 'not_requested'),
        "moderation_reason": generator_data.get('moderation_reason'),
        "moderation_confidence": generator_data.get('moderation_confidence'),
        "moderation_categories": generator_data.get('moderation_categories', []),
        "public_requested_at": generator_data.get('public_requested_at'),
        "public_review_after": generator_data.get('public_review_after'),
        "public_reviewed_at": generator_data.get('public_reviewed_at'),
        "can_manage": can_manage_world(generator_data, requester_user_id),
    }

#==================================================================
# Security Configuration
#==================================================================

PRODUCTION_ENV_NAMES = {"production", "prod"}
SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
PLACEHOLDER_SESSION_SECRETS = {
    "changeme",
    "change_me",
    "replace_me",
    "replace-with-a-secure-secret",
    "your_secure_random_session_key_here",
    "your_secure_random_string_here",
}

VALID_WORLD_VISIBILITIES = {"private", "unlisted", "public"}
TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}
FALSY_ENV_VALUES = {"0", "false", "no", "off"}
LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE = "Sign in or create an account to generate a new World."
LOGIN_RATE_LIMIT_MESSAGE = "Too many login attempts. Try again later."
SIGNUP_RATE_LIMIT_MESSAGE = "Too many signup attempts. Try again later."
WORLD_CREATION_RATE_LIMIT_MESSAGE = "Too many new World creation attempts. Try again later."
PUBLIC_REVIEW_QUEUED_MESSAGE = "Public review is queued. The World will remain private or unlisted until approved."
PUBLIC_REVIEW_ALREADY_PUBLIC_MESSAGE = "World is already public."
PUBLIC_REVIEW_COMPLETED_MESSAGE = "Public review completed."
PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 10 characters, use at least 3 character types "
    "(lowercase, uppercase, number, symbol), and not include your username."
)
AUTH_LOGIN_DEFAULT_MAX_ATTEMPTS = 5
AUTH_LOGIN_DEFAULT_WINDOW_SECONDS = 60
AUTH_SIGNUP_DEFAULT_MAX_ATTEMPTS = 5
AUTH_SIGNUP_DEFAULT_WINDOW_SECONDS = 60 * 60
WORLD_CREATION_DEFAULT_MAX_ATTEMPTS = 10
WORLD_CREATION_DEFAULT_WINDOW_SECONDS = 60 * 60
WORLD_PUBLIC_REVIEW_DEFAULT_DELAY_SECONDS = 0
WORLD_PUBLIC_REVIEW_DEFAULT_POLL_SECONDS = 30
WORLD_PUBLIC_REVIEW_DEFAULT_MAX_PER_POLL = 3
WORLD_PUBLIC_REVIEW_DEFAULT_IMMEDIATE_MAX_PENDING = 10
ANALYTICS_HEAD_PLACEHOLDER = "{{ analytics_head | safe }}"
FIREBASE_CONFIG_ENV_VARS = {
    "apiKey": "FIREBASE_API_KEY",
    "authDomain": "FIREBASE_AUTH_DOMAIN",
    "projectId": "FIREBASE_PROJECT_ID",
    "storageBucket": "FIREBASE_STORAGE_BUCKET",
    "messagingSenderId": "FIREBASE_MESSAGING_SENDER_ID",
    "appId": "FIREBASE_APP_ID",
    "measurementId": "FIREBASE_MEASUREMENT_ID",
}


def password_character_type_count(password: str) -> int:
    return sum([
        any(character.islower() for character in password),
        any(character.isupper() for character in password),
        any(character.isdigit() for character in password),
        any(not character.isalnum() for character in password),
    ])


def validate_signup_password(username: str, password: str) -> Optional[str]:
    if len(password) < 10:
        return PASSWORD_POLICY_MESSAGE
    if len(set(password)) < 5:
        return "Password is too repetitive. Choose a less predictable password."
    if password_character_type_count(password) < 3:
        return PASSWORD_POLICY_MESSAGE

    normalized_username = username.strip().lower()
    if normalized_username and normalized_username in password.lower():
        return "Password must not include your username."

    return None


class AuthRateLimiter:
    def __init__(
            self,
            max_attempts: int = 5,
            window_seconds: int = 60,
            clock=time.time,
    ):
        self.max_attempts = max(1, max_attempts)
        self.window_seconds = max(1, window_seconds)
        self.clock = clock
        self.failures: Dict[str, List[float]] = {}

    def make_key(self, request: Request, username: str = "", scope: str = "auth") -> str:
        client_host = request.client.host if request.client else "unknown"
        normalized_username = (username or "").strip().lower()
        return f"{scope}:{client_host}:{normalized_username}"

    def _recent_failures(self, key: str) -> List[float]:
        now = self.clock()
        recent = [
            timestamp
            for timestamp in self.failures.get(key, [])
            if now - timestamp < self.window_seconds
        ]
        if recent:
            self.failures[key] = recent
        else:
            self.failures.pop(key, None)
        return recent

    def is_limited(self, key: str) -> bool:
        return len(self._recent_failures(key)) >= self.max_attempts

    def record_failure(self, key: str):
        recent = self._recent_failures(key)
        recent.append(self.clock())
        self.failures[key] = recent

    def record_attempt(self, key: str):
        self.record_failure(key)

    def retry_after_seconds(self, key: str) -> int:
        recent = self._recent_failures(key)
        if not recent:
            return 0

        oldest_failure = min(recent)
        remaining_seconds = self.window_seconds - (self.clock() - oldest_failure)
        return max(1, math.ceil(remaining_seconds))

    def clear(self, key: str):
        self.failures.pop(key, None)


def get_app_env() -> str:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "development").strip().lower()


def is_production_env() -> bool:
    return get_app_env() in PRODUCTION_ENV_NAMES


def get_env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    normalized_value = raw_value.strip().lower()
    if normalized_value in TRUTHY_ENV_VALUES:
        return True
    if normalized_value in FALSY_ENV_VALUES:
        return False

    logging.warning("Invalid %s=%r; using %s.", name, raw_value, default)
    return default


def get_env_int(name: str, default: int, minimum: int = 1) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value.strip())
    except ValueError:
        logging.warning("Invalid %s=%r; using %s.", name, raw_value, default)
        return default

    if value < minimum:
        logging.warning("%s must be at least %s; using %s.", name, minimum, default)
        return default

    return value


def is_analytics_enabled() -> bool:
    return get_env_bool("ANALYTICS_ENABLED", False)


def get_firebase_config() -> Dict[str, str]:
    return {
        config_key: (os.getenv(env_name) or "").strip()
        for config_key, env_name in FIREBASE_CONFIG_ENV_VARS.items()
    }


def validate_analytics_config() -> None:
    if not is_analytics_enabled():
        return

    firebase_config = get_firebase_config()
    missing_env_vars = [
        env_name
        for config_key, env_name in FIREBASE_CONFIG_ENV_VARS.items()
        if not firebase_config[config_key]
    ]
    if missing_env_vars:
        raise ValueError(
            "ANALYTICS_ENABLED=1 requires Firebase configuration: "
            + ", ".join(missing_env_vars)
        )


def get_analytics_head_html() -> str:
    if not is_analytics_enabled():
        return ""

    validate_analytics_config()
    firebase_config_json = json.dumps(
        get_firebase_config(),
        separators=(",", ":"),
    ).replace("<", "\\u003c")
    return "\n".join([
        '<script defer src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>',
        '<script defer src="https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics-compat.js"></script>',
        f"<script>window.ROGUELLM_FIREBASE_CONFIG = {firebase_config_json};</script>",
        '<script defer src="/static/js/analytics.js"></script>',
    ])


def inject_analytics_head(html_content: str) -> str:
    return html_content.replace(
        ANALYTICS_HEAD_PLACEHOLDER,
        get_analytics_head_html(),
    )


def make_rate_limiter(
        env_prefix: str,
        default_max_attempts: int,
        default_window_seconds: int,
) -> AuthRateLimiter:
    return AuthRateLimiter(
        max_attempts=get_env_int(f"{env_prefix}_MAX_ATTEMPTS", default_max_attempts),
        window_seconds=get_env_int(f"{env_prefix}_WINDOW_SECONDS", default_window_seconds),
    )


def is_rate_limiting_enabled() -> bool:
    return get_env_bool("AUTH_RATE_LIMIT_ENABLED", True)


def rate_limit_response(message: str, retry_after_seconds: int) -> JSONResponse:
    headers = {}
    if retry_after_seconds > 0:
        headers["Retry-After"] = str(retry_after_seconds)
    return JSONResponse({"error": message}, status_code=429, headers=headers)


def consume_rate_limit_attempt(
        limiter: AuthRateLimiter,
        key: str,
        message: str,
) -> Optional[JSONResponse]:
    if not is_rate_limiting_enabled():
        return None

    if limiter.is_limited(key):
        return rate_limit_response(message, limiter.retry_after_seconds(key))

    limiter.record_attempt(key)
    return None


auth_rate_limiter = make_rate_limiter(
    "AUTH_LOGIN",
    AUTH_LOGIN_DEFAULT_MAX_ATTEMPTS,
    AUTH_LOGIN_DEFAULT_WINDOW_SECONDS,
)
signup_rate_limiter = make_rate_limiter(
    "AUTH_SIGNUP",
    AUTH_SIGNUP_DEFAULT_MAX_ATTEMPTS,
    AUTH_SIGNUP_DEFAULT_WINDOW_SECONDS,
)
world_creation_rate_limiter = make_rate_limiter(
    "WORLD_CREATION",
    WORLD_CREATION_DEFAULT_MAX_ATTEMPTS,
    WORLD_CREATION_DEFAULT_WINDOW_SECONDS,
)


def is_login_required_to_create_world() -> bool:
    return get_env_bool("REQUIRE_LOGIN_TO_CREATE_WORLD", is_production_env())


def require_login_to_create_world_response(request: Request) -> Optional[JSONResponse]:
    if is_login_required_to_create_world() and not get_request_user_id(request):
        return JSONResponse(
            {"error": LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE},
            status_code=401,
        )

    return None


def is_placeholder_session_secret(session_secret: str) -> bool:
    normalized_secret = session_secret.strip().lower()
    return (
        normalized_secret in PLACEHOLDER_SESSION_SECRETS
        or normalized_secret.startswith("your_")
        or "placeholder" in normalized_secret
    )


def get_session_secret_key() -> str:
    """
    Get or generate a secure session secret key.

    Returns:
        str: A secure session secret key

    Raises:
        ValueError: If no session secret is configured and fallback is disabled
    """
    raw_session_secret = os.getenv("SESSION_SECRET_KEY")
    session_secret = raw_session_secret.strip() if raw_session_secret else ""

    if session_secret:
        if is_production_env() and (
            len(session_secret) < 32
            or is_placeholder_session_secret(session_secret)
        ):
            raise ValueError(
                "SESSION_SECRET_KEY must be a real random secret of at least "
                "32 characters when APP_ENV=production."
            )

        if len(session_secret) < 32:
            logging.warning(
                "SESSION_SECRET_KEY is shorter than recommended (32+ characters). "
                "Consider using a longer, more secure key."
            )
        return session_secret

    if is_production_env():
        raise ValueError(
            "SESSION_SECRET_KEY must be set when APP_ENV=production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

    # Generate a secure fallback key
    fallback_key = secrets.token_urlsafe(32)
    logging.warning(
        "⚠️  SESSION_SECRET_KEY not found in environment variables!\n"
        "   Using a randomly generated key for this session.\n"
        "   This means user sessions will not persist across server restarts.\n"
        "   \n"
        "   To fix this:\n"
        "   1. Add SESSION_SECRET_KEY to your .env file\n"
        "   2. Use a secure random string (32+ characters)\n"
        "   3. Example: SESSION_SECRET_KEY=your_secure_random_string_here\n"
        "   \n"
        "   You can generate a secure key with:\n"
        "   python -c \"import secrets; print(secrets.token_urlsafe(32))\""
    )

    return fallback_key


def get_session_cookie_same_site() -> str:
    same_site = os.getenv("SESSION_COOKIE_SAMESITE", "lax").strip().lower()
    if same_site not in {"lax", "strict", "none"}:
        logging.warning(
            "Invalid SESSION_COOKIE_SAMESITE=%r; using 'lax'.",
            same_site,
        )
        return "lax"
    return same_site


def get_session_cookie_max_age_seconds() -> int:
    raw_max_age = os.getenv(
        "SESSION_COOKIE_MAX_AGE_SECONDS",
        str(SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS),
    )
    try:
        max_age = int(raw_max_age)
    except ValueError:
        logging.warning(
            "Invalid SESSION_COOKIE_MAX_AGE_SECONDS=%r; using %s.",
            raw_max_age,
            SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS,
        )
        return SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS

    if max_age <= 0:
        logging.warning(
            "SESSION_COOKIE_MAX_AGE_SECONDS must be positive; using %s.",
            SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS,
        )
        return SESSION_COOKIE_DEFAULT_MAX_AGE_SECONDS

    return max_age


def get_default_new_world_visibility() -> str:
    visibility = os.getenv("DEFAULT_NEW_WORLD_VISIBILITY", "private").strip().lower()
    if visibility not in VALID_WORLD_VISIBILITIES:
        logging.warning(
            "Invalid DEFAULT_NEW_WORLD_VISIBILITY=%r; using 'private'.",
            visibility,
        )
        return "private"

    if is_production_env() and visibility != "private":
        logging.warning(
            "Ignoring DEFAULT_NEW_WORLD_VISIBILITY=%r in production; new Worlds stay private.",
            visibility,
        )
        return "private"

    return visibility


def get_world_public_review_delay_seconds() -> int:
    return get_env_int(
        "WORLD_PUBLIC_REVIEW_DELAY_SECONDS",
        WORLD_PUBLIC_REVIEW_DEFAULT_DELAY_SECONDS,
        minimum=0,
    )


def get_world_public_review_poll_seconds() -> int:
    return get_env_int(
        "WORLD_PUBLIC_REVIEW_POLL_SECONDS",
        WORLD_PUBLIC_REVIEW_DEFAULT_POLL_SECONDS,
    )


def get_world_public_review_max_per_poll() -> int:
    return get_env_int(
        "WORLD_PUBLIC_REVIEW_MAX_PER_POLL",
        WORLD_PUBLIC_REVIEW_DEFAULT_MAX_PER_POLL,
    )


def is_world_public_review_immediate_enabled() -> bool:
    return get_env_bool("WORLD_PUBLIC_REVIEW_IMMEDIATE_ENABLED", True)


def get_world_public_review_immediate_max_pending() -> int:
    return get_env_int(
        "WORLD_PUBLIC_REVIEW_IMMEDIATE_MAX_PENDING",
        WORLD_PUBLIC_REVIEW_DEFAULT_IMMEDIATE_MAX_PENDING,
        minimum=0,
    )


def is_public_review_queue_overwhelmed() -> bool:
    if not hasattr(db, "count_pending_public_reviews"):
        return True

    return db.count_pending_public_reviews() >= get_world_public_review_immediate_max_pending()


def is_world_public_review_worker_enabled() -> bool:
    return get_env_bool("WORLD_PUBLIC_REVIEW_WORKER_ENABLED", is_production_env())

#==================================================================
# FastAPI
#==================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.start_time = time.time()
    validate_analytics_config()
    # Initialize database
    db.init_db()

    # Start session cleanup task
    async def cleanup_task():
        while True:
            await asyncio.sleep(3600)  # Run every hour
            game_session_manager.cleanup_expired_sessions()

    cleanup_task_handle = asyncio.create_task(cleanup_task())
    public_review_task_handle = None

    async def public_review_task():
        while True:
            try:
                processed_count = await process_due_public_world_reviews(
                    db,
                    limit=get_world_public_review_max_per_poll(),
                )
                if processed_count:
                    logging.info("Processed %s public World review(s).", processed_count)
            except Exception as e:
                logging.error(f"Error in public World review worker: {e}")

            await asyncio.sleep(get_world_public_review_poll_seconds())

    if is_world_public_review_worker_enabled() and hasattr(db, "list_due_public_reviews"):
        public_review_task_handle = asyncio.create_task(public_review_task())

    yield

    # Shutdown - ensure database uploads are completed
    logging.info("Shutting down database manager...")
    cleanup_task_handle.cancel()
    if public_review_task_handle is not None:
        public_review_task_handle.cancel()
    db.shutdown()

app = FastAPI(lifespan=lifespan)

# Session middleware with secure secret key
app.add_middleware(
    SessionMiddleware,
    secret_key=get_session_secret_key(),
    https_only=is_production_env(),
    same_site=get_session_cookie_same_site(),
    max_age=get_session_cookie_max_age_seconds(),
)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Generated World art lives in the data volume, not in the repo, so it needs its
# own mount. Created on demand because a fresh deployment has no art yet and
# StaticFiles refuses to mount a missing directory.
register_world_asset_media_types()
_world_assets_dir = get_world_assets_dir()
os.makedirs(_world_assets_dir, exist_ok=True)
app.mount("/assets/worlds", StaticFiles(directory=_world_assets_dir), name="world_assets")

# Create custom middleware for headers
class AddHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Add cache control headers
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

# Add the middleware to your FastAPI app
app.add_middleware(AddHeadersMiddleware)

@app.get("/health")
async def get_health():
    """Lightweight process health check for load balancers and deploy scripts."""
    start_time = getattr(app.state, "start_time", None)
    uptime_seconds = time.time() - start_time if start_time else 0
    return JSONResponse({
        "status": "ok",
        "service": "roguellm",
        "env": get_app_env(),
        "version": os.getenv("APP_VERSION", "dev"),
        "analytics_enabled": is_analytics_enabled(),
        "uptime_seconds": round(uptime_seconds, 3),
    })


@app.get("/health/db")
async def get_database_health():
    """Check that the configured database can accept a simple query."""
    started_at = time.perf_counter()
    try:
        with db.get_connection() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        logging.exception("Database health check failed")
        return JSONResponse({
            "status": "error",
            "database": "sqlite",
            "error": "database health check failed",
        }, status_code=503)

    return JSONResponse({
        "status": "ok",
        "database": "sqlite",
        "storage_enabled": bool(getattr(db, "storage_enabled", False)),
        "latency_ms": round((time.perf_counter() - started_at) * 1000, 3),
    })

@app.get("/admin")
async def read_admin(request: Request):
    require_admin_user(request)

    try:
        async with aiofiles.open("static/admin.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        return HTMLResponse(content=html_content)
    except FileNotFoundError:
        logging.exception("Admin page template is missing")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception:
        logging.exception("Error reading admin page")
        raise HTTPException(status_code=500, detail="Internal server error")

# Landing page
@app.get("/")
async def read_landing(request: Request):
    try:
        # Create new session
        request.session["game_session"] = str(uuid.uuid4())

        # Check if there's a generator ID in the query params
        generator_id = request.query_params.get("generator")
        if generator_id:
            # Validate generator ID
            generator_data = db.get_visible_generator(
                generator_id,
                requester_owner_id=get_request_user_id(request)
            )
            if generator_data:
                # Store in session and redirect to game page
                request.session["generator_id"] = generator_id
                lang = request.query_params.get("lang")
                lang_query = f"&lang={lang}" if lang else ""
                return RedirectResponse(url=f"/game?game_id={generator_id}{lang_query}")
            else:
                # If invalid generator ID, redirect to landing with error
                return RedirectResponse(url=f"/?error=invalid_generator")

        # Read and pre-render the HTML content using async file operations
        async with aiofiles.open("static/index.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        # Pre-render content for social media crawlers
        html_content = await get_prerendered_content(request, html_content)

        html_content = inject_analytics_head(html_content)

        return HTMLResponse(content=html_content)
    except Exception as e:
        logging.error(f"Error reading landing page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Game page - handles both generator sharing and direct session access
@app.get("/game")
async def read_game(request: Request):
    try:
        # Check if valid session exists
        if "game_session" not in request.session:
            # Create new session
            request.session["game_session"] = str(uuid.uuid4())

        # Check for generator_id/game_id in query parameters (for sharing)
        generator_id = request.query_params.get("generator_id")
        if not generator_id:
            generator_id = request.query_params.get("game_id")

        if generator_id:
            # Validate generator ID
            generator_data = db.get_visible_generator(
                generator_id,
                requester_owner_id=get_request_user_id(request)
            )
            if not generator_data:
                # If invalid generator ID, redirect to landing with error
                return RedirectResponse(url=f"/?error=invalid_generator")

            language = request.query_params.get("lang") or generator_data['language']

            # Check if user already has a session for this generator
            session_key = f"game_session_{generator_id}_{language}"
            existing_session_id = request.session.get(session_key)
            if existing_session_id and game_session_manager.get_session(existing_session_id):
                # Redirect to existing session
                return RedirectResponse(url=f"/game/{existing_session_id}")

            # Create new game session for this generator
            try:
                game_instance = await Game.create(
                    seed=int(time.time()),
                    theme_desc=generator_data['theme_desc'],
                    language=language,
                    do_web_search=False,  # Don't re-do web search for shared generators
                    generator_id=generator_id
                )

                session_id = game_session_manager.create_session(game_instance)
                request.session[session_key] = session_id

                # Redirect to the new session
                return RedirectResponse(url=f"/game/{session_id}?lang={language}")

            except Exception:
                logging.exception("Error creating game session for generator %s", generator_id)
                return RedirectResponse(url=f"/?error=failed_to_create_game")

        # No generator ID provided - redirect to landing page
        return RedirectResponse(url="/")

    except Exception as e:
        logging.error(f"Error reading game page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Game session page - serves the actual game for a specific session
@app.get("/game/{session_id}")
async def read_game_session(session_id: str, request: Request):
    try:
        # Validate session exists (check directly in sessions dict)
        if session_id not in game_session_manager.sessions:
            # Session not found, redirect to landing
            return RedirectResponse(url="/?error=session_not_found")

        # Read and serve the game HTML
        async with aiofiles.open("static/game.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        # Pre-render content for social media crawlers
        html_content = await get_prerendered_content(request, html_content)
        html_content = inject_analytics_head(html_content)
        return HTMLResponse(content=html_content)

    except Exception as e:
        logging.error(f"Error reading game session page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# API endpoint for creating a new game session (replaces the old create_game)
@app.post("/api/create_game_session")
async def create_game_session(creation_request: GameCreationRequest, req: Request):
    """Create a new game session and return session ID immediately"""
    requester_user_id = get_request_user_id(req)

    if creation_request.debug_seed is not None and not is_debug_seed_allowed(req):
        return JSONResponse({
            "error": "debug_seed is only available in local development"
        }, status_code=403)

    if creation_request.generator_id:
        generator_data = db.get_visible_generator(
            creation_request.generator_id,
            requester_owner_id=requester_user_id
        )
        if not generator_data:
            return JSONResponse({
                "error": "World not found"
            }, status_code=404)
    else:
        login_required_response = require_login_to_create_world_response(req)
        if login_required_response is not None:
            return login_required_response

        rate_limit_key = world_creation_rate_limiter.make_key(
            req,
            requester_user_id or "anonymous",
            "create_world",
        )
        rate_limited_response = consume_rate_limit_attempt(
            world_creation_rate_limiter,
            rate_limit_key,
            WORLD_CREATION_RATE_LIMIT_MESSAGE,
        )
        if rate_limited_response is not None:
            return rate_limited_response

        # Web search is now a product default for newly generated Worlds, not a
        # user-facing toggle. Existing generator runs still skip search later.
        creation_request = creation_request.model_copy(update={"do_web_search": True})

    session_id = str(uuid.uuid4())

    # Store the session with initial state in the new format
    game_session_manager.sessions[session_id] = {
        'created_at': time.time(),
        'last_accessed': time.time(),
        'game_instance': None,  # Will be set when game is created
        'creation_request': creation_request,
        'status': 'creating',  # creating, ready, error
        'generator_id': creation_request.generator_id,
        'language': creation_request.language,
        'debug_seed': creation_request.debug_seed
    }

    logging.info(f"Created new game session: {session_id}")

    return {
        "session_id": session_id,
        "status": "creating"
    }

@app.get("/api/worlds/recent")
async def get_recent_worlds(request: Request, limit: int = 12):
    """List reusable generated Worlds.

    Local/dev and opt-in library deployments see recent Worlds for convenience.
    Other deployments see public Worlds only.
    """
    try:
        requester_user_id = get_request_user_id(request)
        worlds = [
            serialize_world_summary(world, requester_user_id)
            for world in db.list_worlds(limit, local_dev=is_world_library_allowed(request))
        ]
        return JSONResponse({
            "worlds": worlds
        })
    except Exception as e:
        logging.error(f"Error listing worlds: {e}")
        return JSONResponse({
            "error": "Failed to load worlds"
        }, status_code=500)

@app.get("/api/my/worlds")
async def get_my_worlds(request: Request, limit: int = 20):
    """List Worlds owned by the logged-in user."""
    user_id = get_request_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    try:
        worlds = [
            serialize_world_summary(world, user_id)
            for world in db.list_worlds(limit, owner_id=user_id)
        ]
        return JSONResponse({
            "worlds": worlds
        })
    except Exception as e:
        logging.error(f"Error listing owned worlds: {e}")
        return JSONResponse({
            "error": "Failed to load worlds"
        }, status_code=500)

@app.get("/api/my/stats")
async def get_my_stats(request: Request):
    """Return dashboard stats for the logged-in user."""
    user_id = get_request_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    user = db.get_user_by_id(user_id)
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)

    try:
        return JSONResponse({
            "username": user["username"],
            "stats": db.get_user_world_stats(user_id),
        })
    except Exception as e:
        logging.error(f"Error loading user stats: {e}")
        return JSONResponse({
            "error": "Failed to load user stats"
        }, status_code=500)

@app.get("/api/admin/users")
async def get_admin_users(request: Request, limit: int = 100):
    """List registered users and lightweight ownership stats for admins."""
    admin_user = require_admin_user(request)

    try:
        return JSONResponse({
            "admin": serialize_user(admin_user),
            "users": db.list_users_with_world_counts(limit),
        })
    except Exception:
        logging.exception("Error listing admin users")
        return JSONResponse({
            "error": "Failed to load users"
        }, status_code=500)

@app.patch("/api/admin/users/{user_id}/password-reset")
async def set_admin_user_password_reset(
        request: AdminPasswordResetRequest,
        req: Request,
        user_id: str,
):
    """Mark or clear a user's password-reset-required flag."""
    require_admin_user(req)

    try:
        updated = db.set_user_password_reset_required(
            user_id,
            request.password_reset_required,
        )
    except Exception:
        logging.exception("Error updating admin password-reset flag")
        return JSONResponse({
            "error": "Failed to update user"
        }, status_code=500)

    if not updated:
        return JSONResponse({"error": "User not found"}, status_code=404)

    return JSONResponse({
        "id": user_id,
        "password_reset_required": request.password_reset_required,
    })

@app.get("/api/worlds/{world_id}")
async def get_world(request: Request, world_id: str):
    """Get world metadata by ID if visible to the requester."""
    requester_user_id = get_request_user_id(request)
    generator_data = db.get_visible_generator(
        world_id,
        requester_owner_id=requester_user_id
    )
    if not generator_data:
        return JSONResponse({"error": "World not found"}, status_code=404)

    return JSONResponse(serialize_generator_metadata(
        world_id,
        generator_data,
        requester_user_id,
    ))

class VisibilityUpdateRequest(BaseModel):
    visibility: str

@app.patch("/api/worlds/{world_id}/visibility")
async def update_world_visibility(request: VisibilityUpdateRequest, req: Request, world_id: str):
    user_id = req.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    generator_data = db.get_generator(world_id)
    if not generator_data:
        return JSONResponse({"error": "World not found"}, status_code=404)

    if generator_data.get("owner_id") != user_id:
        return JSONResponse({"error": "Not authorized"}, status_code=403)

    visibility = request.visibility.strip().lower()
    if visibility not in ("private", "unlisted", "public"):
        return JSONResponse({"error": "Invalid visibility"}, status_code=400)

    if visibility == "public":
        if generator_data.get("visibility") == "public":
            return JSONResponse({
                "id": world_id,
                "visibility": "public",
                "moderation_status": generator_data.get("moderation_status", "approved"),
                "moderation_reason": generator_data.get("moderation_reason"),
                "public_reviewed_at": generator_data.get("public_reviewed_at"),
                "message": PUBLIC_REVIEW_ALREADY_PUBLIC_MESSAGE,
            })

        reviewed_world = db.request_public_visibility(
            world_id,
            requested_by_owner_id=user_id,
            review_delay_seconds=get_world_public_review_delay_seconds(),
            reviewer_model=get_world_public_review_model_name(),
        )
        if not reviewed_world:
            return JSONResponse({"error": "Failed to queue public review"}, status_code=409)

        response_status = 202
        response_message = PUBLIC_REVIEW_QUEUED_MESSAGE
        if is_world_public_review_immediate_enabled() and not is_public_review_queue_overwhelmed():
            await process_public_world_review(db, reviewed_world)
            reviewed_world = db.get_generator(world_id) or reviewed_world
            response_status = 200
            response_message = PUBLIC_REVIEW_COMPLETED_MESSAGE

        return JSONResponse({
            "id": world_id,
            "visibility": reviewed_world.get("visibility", "private"),
            "moderation_status": reviewed_world.get("moderation_status", "pending"),
            "moderation_reason": reviewed_world.get("moderation_reason"),
            "moderation_confidence": reviewed_world.get("moderation_confidence"),
            "moderation_categories": reviewed_world.get("moderation_categories", []),
            "public_requested_at": reviewed_world.get("public_requested_at"),
            "public_review_after": reviewed_world.get("public_review_after"),
            "public_reviewed_at": reviewed_world.get("public_reviewed_at"),
            "message": response_message,
        }, status_code=response_status)

    db.set_generator_non_public_visibility(world_id, visibility)
    return JSONResponse({
        "id": world_id,
        "visibility": visibility,
        "moderation_status": "not_requested",
    })

# Legacy API endpoint for backward compatibility
@app.post("/api/create_game")
async def create_game(request: CreateGameRequest, req: Request):
    """Legacy endpoint - redirects to new session-based flow."""
    try:
        if request.generator_id:
            # Check if generator exists
            generator_data = db.get_visible_generator(
                request.generator_id,
                requester_owner_id=get_request_user_id(req)
            )
            if not generator_data:
                return JSONResponse({
                    "error": "World not found"
                }, status_code=404)
        else:
            login_required_response = require_login_to_create_world_response(req)
            if login_required_response is not None:
                return login_required_response

            requester_user_id = get_request_user_id(req)
            rate_limit_key = world_creation_rate_limiter.make_key(
                req,
                requester_user_id or "anonymous",
                "create_world",
            )
            rate_limited_response = consume_rate_limit_attempt(
                world_creation_rate_limiter,
                rate_limit_key,
                WORLD_CREATION_RATE_LIMIT_MESSAGE,
            )
            if rate_limited_response is not None:
                return rate_limited_response

        # Store configuration in session for the new flow
        req.session["generator_id"] = request.generator_id if request.generator_id else None
        req.session["language"] = request.language
        req.session["do_web_search"] = False if request.generator_id else True

        # Set theme and compress it
        theme_desc = request.theme if request.theme else "fantasy"
        compressed = base64.b64encode(zlib.compress(theme_desc.encode())).decode()
        req.session["theme_desc"] = compressed

        return JSONResponse({
            "message": "Game configuration saved."
        })
    except Exception:
        logging.exception("Error in create_game")
        return JSONResponse({
            "error": "Failed to create game"
        }, status_code=500)

# Auth endpoints
class SignupRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/signup")
async def signup(request: SignupRequest, req: Request):
    rate_limit_key = signup_rate_limiter.make_key(req, scope="signup")
    rate_limited_response = consume_rate_limit_attempt(
        signup_rate_limiter,
        rate_limit_key,
        SIGNUP_RATE_LIMIT_MESSAGE,
    )
    if rate_limited_response is not None:
        return rate_limited_response

    username = request.username.strip()
    password = request.password
    if not username or not password:
        return JSONResponse({"error": "Username and password are required"}, status_code=400)
    if len(username) < 3:
        return JSONResponse({"error": "Username must be at least 3 characters"}, status_code=400)

    password_error = validate_signup_password(username, password)
    if password_error:
        return JSONResponse({"error": password_error}, status_code=400)

    user = db.create_user(username, password)
    if not user:
        return JSONResponse({"error": "Username already exists"}, status_code=409)

    req.session["user_id"] = user["id"]
    return JSONResponse(serialize_user(user))

@app.post("/api/login")
async def login(request: LoginRequest, req: Request):
    rate_limit_key = auth_rate_limiter.make_key(req, request.username, "login")
    if is_rate_limiting_enabled() and auth_rate_limiter.is_limited(rate_limit_key):
        return rate_limit_response(
            LOGIN_RATE_LIMIT_MESSAGE,
            auth_rate_limiter.retry_after_seconds(rate_limit_key),
        )

    user = db.get_user_by_username(request.username)
    if not user:
        if is_rate_limiting_enabled():
            auth_rate_limiter.record_failure(rate_limit_key)
        return JSONResponse({"error": "Invalid username or password"}, status_code=401)

    if not db._verify_password(request.password, user["password_hash"]):
        if is_rate_limiting_enabled():
            auth_rate_limiter.record_failure(rate_limit_key)
        return JSONResponse({"error": "Invalid username or password"}, status_code=401)

    auth_rate_limiter.clear(rate_limit_key)
    req.session["user_id"] = user["id"]
    return JSONResponse(serialize_user(user))

@app.post("/api/logout")
async def api_logout(req: Request):
    req.session.pop("user_id", None)
    return JSONResponse({"message": "Logged out"})

@app.get("/api/me")
async def get_me(req: Request):
    user_id = req.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    user = db.get_user_by_id(user_id)
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)

    return JSONResponse(serialize_user(user))

# Logout
@app.post("/logout")
async def logout(request: Request):
    request.session.clear()
    response = RedirectResponse(url="/", status_code=302)
    # Create new session immediately
    request.session["game_session"] = str(uuid.uuid4())
    return response

# Time profiler
class TimeProfiler:
    def __init__(self, name="Operation"):
        self.name = name

    def __enter__(self):
        self.start = time.time()
        return self

    def __exit__(self, *args):
        self.elapsed = time.time() - self.start
        logging.info(f"{self.name} took {self.elapsed:.2f} seconds")

# WebSocket endpoint for the game - now works with sessions
@app.websocket("/ws/game/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    try:
        # Check if session exists
        if session_id not in game_session_manager.sessions:
            await websocket.send_json({
                "type": "error",
                "message": "Session not found"
            })
            return

        session = game_session_manager.sessions[session_id]

        # If game is not created yet, create it now
        if session['status'] == 'creating':
            await websocket.send_json({
                "type": "status",
                "message": "Creating game world...",
                "status": "creating"
            })

            try:
                request = session['creation_request']
                seed = request.debug_seed if request.debug_seed is not None else int(time.time())
                user_id = websocket.session.get("user_id")

                if request.generator_id:
                    # Check if generator exists
                    generator_data = db.get_visible_generator(
                        request.generator_id,
                        requester_owner_id=user_id
                    )
                    if not generator_data:
                        await websocket.send_json({
                            "type": "error",
                            "message": "World not found"
                        })
                        return

                    # Use generator data
                    theme_desc = generator_data['theme_desc']
                    language = request.language or generator_data['language']
                    do_web_search = False  # Don't re-do web search for existing generators
                else:
                    if is_login_required_to_create_world() and not user_id:
                        await websocket.send_json({
                            "type": "error",
                            "message": LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE
                        })
                        return

                    # Use provided parameters
                    theme_desc = request.theme if request.theme else "fantasy"
                    language = request.language
                    do_web_search = request.do_web_search

                await websocket.send_json({
                    "type": "status",
                    "message": "Generating game content...",
                    "status": "creating"
                })

                # Determine ownership and visibility for newly generated worlds.
                world_visibility = get_default_new_world_visibility()

                async def send_forge_progress(event):
                    await websocket.send_json({"type": "forge_progress", **event})

                # Create new game instance with timeout
                try:
                    game_instance = await asyncio.wait_for(
                        Game.create(
                            seed=seed,
                            theme_desc=theme_desc,
                            language=language,
                            do_web_search=do_web_search,
                            generator_id=request.generator_id,
                            owner_id=user_id,
                            visibility=world_visibility,
                            on_progress=send_forge_progress
                        ),
                        timeout=get_world_creation_timeout_seconds()
                    )
                except asyncio.TimeoutError:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Game creation is taking longer than expected. Please try again with a simpler theme or use an existing generator."
                    })
                    return

                # Update session with created game
                session['game_instance'] = game_instance
                session['status'] = 'ready'
                session['last_accessed'] = time.time()
                if game_instance.state_manager:
                    session['generator_id'] = game_instance.state_manager.generator_id

                await websocket.send_json({
                    "type": "status",
                    "message": "Game ready!",
                    "status": "ready"
                })

            except Exception:
                logging.exception("Error creating game for session %s", session_id)
                session['status'] = 'error'
                await websocket.send_json({
                    "type": "error",
                    "message": "Failed to create game"
                })
                return

        # Get the game instance
        game_instance = session['game_instance']
        if not game_instance:
            await websocket.send_json({
                "type": "error",
                "message": "Game not ready"
            })
            return

        # Handle the WebSocket connection with the game instance
        try:
            game_instance.add_client(websocket)

            # Check for error message through state manager
            if game_instance.state_manager and game_instance.state_manager.error_message:
                logging.info("Sending game state error message")
                await websocket.send_json({
                    'type': 'error',
                    'message': game_instance.state_manager.error_message
                })

            initial_response = {
                'type': 'connection_established',
                'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None
            }
            await websocket.send_json(initial_response)

            while True:
                message = await websocket.receive_json()

                # Contain per-action failures. Anything raised here used to
                # escape to the outer handler, which closes the socket; the
                # client reads that as code 1006 and redirects home, so one bad
                # action ejected the player and lost the whole run.
                try:
                    response = await game_instance.handle_message(message)
                except (WebSocketDisconnect, ConnectionResetError):
                    raise
                except Exception:
                    logging.exception(
                        "Error handling action '%s'",
                        message.get('action') if isinstance(message, dict) else None,
                    )
                    response = {
                        'type': 'error',
                        'message': 'That action could not be completed.',
                    }

                # Add generator_id to response if available
                if game_instance.state_manager and game_instance.state_manager.generator_id and isinstance(response, dict):
                    response['generator_id'] = game_instance.state_manager.generator_id

                await websocket.send_json(response)

        except WebSocketDisconnect:
            logging.info("WebSocket client disconnected normally")
        except ConnectionResetError:
            logging.info("WebSocket connection reset by client")
        except Exception:
            logging.exception("Game loop error")
            # Try to send error message if connection is still open
            try:
                await websocket.send_json({
                    'type': 'error',
                    'message': 'Game error occurred'
                })
            except (WebSocketDisconnect, ConnectionResetError, RuntimeError):
                logging.debug("Could not send error message - connection already closed")
        finally:
            if game_instance:
                try:
                    game_instance.remove_client(websocket)
                except Exception as cleanup_error:
                    logging.debug(f"Error during WebSocket cleanup: {cleanup_error}")

    except WebSocketDisconnect:
        logging.info(f"WebSocket disconnected for session: {session_id}")
    except Exception:
        logging.exception("WebSocket error for session %s", session_id)
        try:
            await websocket.send_json({
                "type": "error",
                "message": "WebSocket error occurred"
            })
        except:
            pass

# Legacy WebSocket endpoint for backward compatibility
@app.websocket("/ws/game")
async def legacy_websocket_endpoint(websocket: WebSocket):
    """Legacy WebSocket endpoint - creates session on-the-fly for backward compatibility."""
    game_instance = None
    try:
        await websocket.accept()
        logging.info("New WebSocket connection established (legacy)")

        session = websocket.session

        # Retrieve session variables
        generator_id = session.get("generator_id")
        language = session.get("language", "en")
        do_web_search = session.get("do_web_search", False)
        user_id = websocket.session.get("user_id")

        if not generator_id and is_login_required_to_create_world() and not user_id:
            await websocket.send_json({
                "type": "error",
                "message": LOGIN_REQUIRED_TO_CREATE_WORLD_MESSAGE
            })
            return

        # Decompress theme description
        compressed_theme = session.get("theme_desc")
        if compressed_theme:
            theme_desc = zlib.decompress(base64.b64decode(compressed_theme)).decode()
        else:
            theme_desc = "fantasy"

        # Create a new Game instance
        rand_seed = int(time.time())

        # Create game instance using the factory method
        game_instance = await Game.create(
            seed=rand_seed,
            theme_desc=theme_desc,
            language=language,
            do_web_search=do_web_search,
            generator_id=generator_id,
            owner_id=user_id,
            visibility=get_default_new_world_visibility()
        )

        # Create session for this game
        session_id = game_session_manager.create_session(game_instance)
        logging.info(f"Created legacy session: {session_id}")

        try:
            game_instance.add_client(websocket)

            # Check for error message through state manager
            if game_instance.state_manager and game_instance.state_manager.error_message:
                logging.info("Sending game state error message")
                await websocket.send_json({
                    'type': 'error',
                    'message': game_instance.state_manager.error_message
                })

            initial_response = {
                'type': 'connection_established',
                'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None
            }
            await websocket.send_json(initial_response)

            while True:
                message = await websocket.receive_json()

                # Contain per-action failures. Anything raised here used to
                # escape to the outer handler, which closes the socket; the
                # client reads that as code 1006 and redirects home, so one bad
                # action ejected the player and lost the whole run.
                try:
                    response = await game_instance.handle_message(message)
                except (WebSocketDisconnect, ConnectionResetError):
                    raise
                except Exception:
                    logging.exception(
                        "Error handling action '%s'",
                        message.get('action') if isinstance(message, dict) else None,
                    )
                    response = {
                        'type': 'error',
                        'message': 'That action could not be completed.',
                    }

                # Add generator_id to response if available
                if game_instance.state_manager and game_instance.state_manager.generator_id and isinstance(response, dict):
                    response['generator_id'] = game_instance.state_manager.generator_id

                await websocket.send_json(response)

        except WebSocketDisconnect:
            logging.info("WebSocket client disconnected normally")
        except ConnectionResetError:
            logging.info("WebSocket connection reset by client")
        except Exception:
            logging.exception("Game loop error")
            # Try to send error message if connection is still open
            try:
                await websocket.send_json({
                    'type': 'error',
                    'message': 'Game error occurred'
                })
            except (WebSocketDisconnect, ConnectionResetError, RuntimeError):
                logging.debug("Could not send error message - connection already closed")
    except WebSocketDisconnect:
        logging.info("WebSocket disconnected during initialization")
    except Exception:
        logging.exception("WebSocket connection error")
        # Send error message to client if possible
        try:
            await websocket.send_json({
                'type': 'error',
                'message': 'Failed to initialize game'
            })
        except (WebSocketDisconnect, ConnectionResetError, RuntimeError) as send_error:
            logging.debug(f"Could not send initialization error message: {send_error}")
    finally:
        if game_instance:
            try:
                game_instance.remove_client(websocket)
            except Exception as cleanup_error:
                logging.debug(f"Error during WebSocket cleanup: {cleanup_error}")

# API endpoint to get session info
@app.get("/api/session/{session_id}/info")
async def get_session_info(session_id: str):
    """Get information about a game session."""
    if session_id not in game_session_manager.sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session_data = game_session_manager.sessions[session_id]

    # Handle both new and old session structures
    if isinstance(session_data, dict) and 'game_instance' in session_data:
        # New structure
        game_instance = session_data['game_instance']
        return JSONResponse({
            "session_id": session_id,
            "generator_id": session_data.get('generator_id'),
            "created_at": session_data.get('created_at'),
            "last_accessed": session_data.get('last_accessed'),
            "status": session_data.get('status'),
            "game_title": game_instance.get_game_title() if game_instance else None
        })
    else:
        # Old structure - session_data is the game instance directly
        game_instance = session_data
        return JSONResponse({
            "session_id": session_id,
            "generator_id": game_instance.state_manager.generator_id if game_instance.state_manager else None,
            "created_at": None,  # Not available in old structure
            "last_accessed": None,  # Not available in old structure
            "status": "ready",  # Assume ready for old structure
            "game_title": game_instance.get_game_title() if game_instance else None
        })

# API endpoint to get server stats
@app.get("/api/stats")
async def get_server_stats():
    """Get server statistics."""
    return JSONResponse({
        "active_sessions": game_session_manager.get_session_count(),
        "uptime": time.time() - app.state.start_time if hasattr(app.state, 'start_time') else 0
    })

if __name__ == "__main__":
    import uvicorn
    app.state.start_time = time.time()
    uvicorn.run(app, host="0.0.0.0", port=8000)

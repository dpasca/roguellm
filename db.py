import os
import json
import uuid
import sqlite3
import hashlib
import hmac
import secrets
import time
import asyncio
from typing import Dict, List, Optional, Sequence, Tuple, Union
from contextlib import contextmanager
import logging
import boto3
from threading import Lock, Thread
from datetime import datetime, timedelta, timezone

# Bump when the persisted playable snapshot shape changes, so stale rows are
# regenerated instead of loaded.
WORLD_SNAPSHOT_VERSION = 1

VALID_WORLD_VISIBILITIES = {"private", "unlisted", "public"}
VALID_WORLD_MODERATION_STATUSES = {
    "not_requested",
    "pending",
    "approved",
    "rejected",
    "needs_human_review",
    "error",
}


class DatabaseManager:
    class ConnectionWrapper:
        def __init__(self, connection, on_commit):
            self.connection = connection
            self.on_commit = on_commit

        def commit(self):
            self.connection.commit()
            # Schedule upload instead of blocking
            self.on_commit()

        def __getattr__(self, name):
            return getattr(self.connection, name)

    def __init__(self, upload_frequency_minutes: int = 5):
        self.db_path = os.path.join("_data", "rllm_game_data.db")
        self.timeout = 20.0
        self.max_retries = 3
        self.retry_delay = 0.1

        # Upload batching configuration
        self.upload_frequency_minutes = upload_frequency_minutes
        self.last_upload_time = None
        self.pending_upload = False
        self.upload_lock = Lock()
        self.background_upload_thread = None
        self.shutdown_flag = False

        # Check if storage is configured
        required_vars = [
            'DO_STORAGE_SERVER',
            'DO_SPACES_ACCESS_KEY',
            'DO_SPACES_SECRET_KEY',
            'DO_STORAGE_CONTAINER'
        ]
        self.storage_enabled = all(os.getenv(var) for var in required_vars)

        if self.storage_enabled:
            self.s3 = boto3.client('s3',
                endpoint_url=os.getenv('DO_STORAGE_SERVER'),
                aws_access_key_id=os.getenv('DO_SPACES_ACCESS_KEY'),
                aws_secret_access_key=os.getenv('DO_SPACES_SECRET_KEY')
            )
            self.bucket = os.getenv('DO_STORAGE_CONTAINER')
            logging.info(f"Storage backend enabled - upload frequency: {upload_frequency_minutes} minutes")

            # Start background upload thread
            self._start_background_upload_thread()
        else:
            self.s3 = None
            self.bucket = None
            logging.info("Storage backend disabled - using local storage only")

    def _start_background_upload_thread(self):
        """Start the background thread for periodic uploads"""
        if self.background_upload_thread is None or not self.background_upload_thread.is_alive():
            self.background_upload_thread = Thread(target=self._background_upload_worker, daemon=True)
            self.background_upload_thread.start()
            logging.info("Background upload thread started")

    def _background_upload_worker(self):
        """Background worker that handles periodic uploads"""
        while not self.shutdown_flag:
            try:
                time.sleep(30)  # Check every 30 seconds

                with self.upload_lock:
                    if not self.pending_upload:
                        continue

                    # Check if enough time has passed since last upload
                    now = datetime.now()
                    if (self.last_upload_time is None or
                        now - self.last_upload_time >= timedelta(minutes=self.upload_frequency_minutes)):

                        self._upload_db_to_storage_sync()
                        self.pending_upload = False
                        self.last_upload_time = now
                        logging.info("Background upload completed")

            except Exception as e:
                logging.error(f"Error in background upload worker: {e}")

    def _schedule_upload(self):
        """Schedule an upload to happen in the background"""
        if not self.storage_enabled:
            return

        with self.upload_lock:
            self.pending_upload = True

        # Ensure background thread is running
        if self.background_upload_thread is None or not self.background_upload_thread.is_alive():
            self._start_background_upload_thread()

    def _upload_db_to_storage_sync(self):
        """Synchronous version of upload for background thread"""
        if not self.storage_enabled:
            return

        try:
            self.s3.upload_file(
                Filename=self.db_path,
                Bucket=self.bucket,
                Key='rllm_game_data.db'
            )
            logging.info("Uploaded DB to storage (background)")
        except Exception as e:
            logging.error(f"Failed to upload DB to storage (background): {e}")

    def force_upload_now(self):
        """Force an immediate upload (for shutdown or critical operations)"""
        if not self.storage_enabled:
            return

        with self.upload_lock:
            self._upload_db_to_storage_sync()
            self.pending_upload = False
            self.last_upload_time = datetime.now()
            logging.info("Forced immediate upload completed")

    def shutdown(self):
        """Gracefully shutdown the database manager"""
        self.shutdown_flag = True

        # Force final upload if there are pending changes
        if self.pending_upload:
            logging.info("Performing final upload before shutdown...")
            self.force_upload_now()

        # Wait for background thread to finish
        if self.background_upload_thread and self.background_upload_thread.is_alive():
            self.background_upload_thread.join(timeout=10)
            logging.info("Background upload thread stopped")

    def download_db_from_storage(self):
        """Downloads DB from DO Spaces if storage is enabled"""
        if not self.storage_enabled:
            return

        try:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            self.s3.download_file(
                Bucket=self.bucket,
                Key='rllm_game_data.db',
                Filename=self.db_path
            )
            logging.info("Downloaded DB from storage")
        except Exception as e:
            logging.warning(f"Could not download DB from storage: {e}")

    def upload_db_to_storage(self):
        """Uploads DB to DO Spaces if storage is enabled"""
        if not self.storage_enabled:
            return

        try:
            self.s3.upload_file(
                Filename=self.db_path,
                Bucket=self.bucket,
                Key='rllm_game_data.db'
            )
            logging.info("Uploaded DB to storage")
        except Exception as e:
            logging.error(f"Failed to upload DB to storage: {e}")

    def init_db(self):
        """Initialize database and load from remote storage if available"""
        self.download_db_from_storage()
        with self.get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS generators (
                    id TEXT PRIMARY KEY,
                    theme_desc TEXT,
                    theme_desc_better TEXT,
                    language TEXT,
                    player_defs TEXT,
                    item_defs TEXT,
                    enemy_defs TEXT,
                    celltype_defs TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    owner_id TEXT NULL,
                    visibility TEXT NOT NULL DEFAULT 'unlisted'
                        CHECK (visibility IN ('private', 'unlisted', 'public')),
                    moderation_status TEXT NOT NULL DEFAULT 'not_requested'
                        CHECK (moderation_status IN (
                            'not_requested',
                            'pending',
                            'approved',
                            'rejected',
                            'needs_human_review',
                            'error'
                        )),
                    moderation_reason TEXT NULL,
                    moderation_model TEXT NULL,
                    moderation_confidence REAL NULL,
                    moderation_categories TEXT NULL,
                    public_requested_at TIMESTAMP NULL,
                    public_review_after TIMESTAMP NULL,
                    public_reviewed_at TIMESTAMP NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS generator_worlds (
                    generator_id TEXT PRIMARY KEY,
                    snapshot_version INTEGER NOT NULL DEFAULT 1,
                    language TEXT,
                    map_csv TEXT,
                    entity_placements TEXT,
                    tile_info TEXT,
                    regions TEXT,
                    visual_manifest TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS generator_translations (
                    generator_id TEXT NOT NULL,
                    language TEXT NOT NULL,
                    theme_desc_better TEXT,
                    player_defs TEXT,
                    item_defs TEXT,
                    enemy_defs TEXT,
                    celltype_defs TEXT,
                    translation_version INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (generator_id, language),
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE
                )
            """)
            self._ensure_column(
                conn,
                "generator_worlds",
                "visual_manifest",
                "TEXT",
            )
            self._ensure_column(
                conn,
                "generator_translations",
                "translation_version",
                "INTEGER DEFAULT 1"
            )
            self._ensure_column(conn, "generators", "owner_id", "TEXT NULL")
            self._ensure_column(conn, "generators", "visibility", "TEXT NOT NULL DEFAULT 'unlisted'")
            self._ensure_column(conn, "generators", "moderation_status", "TEXT NOT NULL DEFAULT 'not_requested'")
            self._ensure_column(conn, "generators", "moderation_reason", "TEXT NULL")
            self._ensure_column(conn, "generators", "moderation_model", "TEXT NULL")
            self._ensure_column(conn, "generators", "moderation_confidence", "REAL NULL")
            self._ensure_column(conn, "generators", "moderation_categories", "TEXT NULL")
            self._ensure_column(conn, "generators", "public_requested_at", "TIMESTAMP NULL")
            self._ensure_column(conn, "generators", "public_review_after", "TIMESTAMP NULL")
            self._ensure_column(conn, "generators", "public_reviewed_at", "TIMESTAMP NULL")
            self._ensure_column(conn, "generators", "updated_at", "TIMESTAMP")
            # Databases predating area crossings have the snapshot but not this.
            # Adding it nullable avoids invalidating every existing snapshot;
            # a world without regions regenerates just its crossings.
            self._ensure_column(conn, "generator_worlds", "regions", "TEXT NULL")
            self._backfill_generator_ownership_shape(conn)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_reset_required INTEGER NOT NULL DEFAULT 0,
                    password_reset_marked_at TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            self._ensure_column(conn, "users", "password_reset_required", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(conn, "users", "password_reset_marked_at", "TIMESTAMP NULL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS mobile_auth_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    access_token_hash TEXT UNIQUE NOT NULL,
                    refresh_token_hash TEXT UNIQUE NOT NULL,
                    access_expires_at INTEGER NOT NULL,
                    refresh_expires_at INTEGER NOT NULL,
                    platform TEXT NULL,
                    device_name TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    revoked_at TIMESTAMP NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_mobile_auth_sessions_user
                ON mobile_auth_sessions(user_id, refresh_expires_at)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS credit_ledger (
                    id TEXT PRIMARY KEY,
                    operation_key TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    bucket TEXT NOT NULL CHECK (bucket IN ('promo', 'paid')),
                    amount INTEGER NOT NULL CHECK (amount != 0),
                    kind TEXT NOT NULL,
                    reference_type TEXT NULL,
                    reference_id TEXT NULL,
                    metadata TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (operation_key, bucket),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
                ON credit_ledger(user_id, created_at)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS store_purchases (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
                    external_transaction_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    product_id TEXT NOT NULL,
                    credits INTEGER NOT NULL CHECK (credits > 0),
                    environment TEXT NOT NULL,
                    provider_metadata TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (provider, external_transaction_id),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_store_purchases_user_created
                ON store_purchases(user_id, created_at)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS world_metrics (
                    generator_id TEXT PRIMARY KEY,
                    play_count INTEGER NOT NULL DEFAULT 0,
                    completion_count INTEGER NOT NULL DEFAULT 0,
                    unique_completer_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS world_play_sessions (
                    session_id TEXT PRIMARY KEY,
                    generator_id TEXT NOT NULL,
                    user_id TEXT NULL,
                    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP NULL,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_world_play_sessions_generator
                ON world_play_sessions(generator_id, started_at)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS world_player_completions (
                    user_id TEXT NOT NULL,
                    generator_id TEXT NOT NULL,
                    first_session_id TEXT NOT NULL,
                    qualifies_for_popularity INTEGER NOT NULL DEFAULT 1,
                    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, generator_id),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS world_art_reroll_attempts (
                    id TEXT PRIMARY KEY,
                    generator_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (
                        status IN ('reserved', 'succeeded', 'failed')
                    ),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    finished_at TIMESTAMP NULL,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_world_art_rerolls_world_user
                ON world_art_reroll_attempts(generator_id, user_id, status)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS world_moderation_reviews (
                    id TEXT PRIMARY KEY,
                    generator_id TEXT NOT NULL,
                    requested_by_owner_id TEXT NULL,
                    model_name TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    confidence REAL NULL,
                    categories TEXT NULL,
                    public_reason TEXT NULL,
                    internal_notes TEXT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (generator_id) REFERENCES generators(id) ON DELETE CASCADE
                )
            """)
            conn.commit()

    def _ensure_column(self, conn, table_name: str, column_name: str, column_definition: str):
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({table_name})")
        columns = {row[1] for row in cur.fetchall()}
        if column_name not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")

    def _backfill_generator_ownership_shape(self, conn):
        """Normalize newly added world ownership columns on existing databases."""
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(generators)")
        columns = {row[1] for row in cur.fetchall()}

        if "visibility" in columns:
            conn.execute("""
                UPDATE generators
                SET visibility = 'unlisted'
                WHERE visibility IS NULL
                   OR visibility NOT IN ('private', 'unlisted', 'public')
            """)

        if "updated_at" in columns:
            if "created_at" in columns:
                conn.execute("""
                    UPDATE generators
                    SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)
                    WHERE updated_at IS NULL
                """)
            else:
                conn.execute("""
                    UPDATE generators
                    SET updated_at = CURRENT_TIMESTAMP
                    WHERE updated_at IS NULL
                """)

        if "moderation_status" in columns:
            conn.execute("""
                UPDATE generators
                SET moderation_status = 'not_requested'
                WHERE moderation_status IS NULL
                   OR moderation_status NOT IN (
                        'not_requested',
                        'pending',
                        'approved',
                        'rejected',
                        'needs_human_review',
                        'error'
                   )
            """)

    def backup_db(self):
        """Upload current DB to remote storage"""
        try:
            self.s3.upload_file(
                self.db_path,
                self.bucket,
                'rllm_game_data.db'
            )
            logging.info("Database backed up to storage")
        except Exception as e:
            logging.error(f"Failed to backup database: {str(e)}")

    @contextmanager
    def get_connection(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=self.timeout)
        wrapped = self.ConnectionWrapper(conn, self._schedule_upload)
        try:
            yield wrapped
        finally:
            conn.close()

    def _execute_with_retry(self, operation, *args):
        """
        Execute a database operation with retry logic.
        """
        last_error = None
        for attempt in range(self.max_retries):
            try:
                with self.get_connection() as conn:
                    result = operation(conn, *args)
                    return result
            except sqlite3.OperationalError as e:
                last_error = e
                if "database is locked" in str(e):
                    time.sleep(self.retry_delay * (attempt + 1))
                    continue
                raise e
            except Exception as e:
                raise e

        raise last_error if last_error else Exception("Max retries exceeded")

    def generate_generator_id(
            self,
            theme_desc: str,
            theme_desc_better: str,
            language: str,
            player_defs: List[Dict],
            item_defs: List[Dict],
            enemy_defs: List[Dict],
            celltype_defs: List[Dict]
    ) -> str:
        """
        Generate a consistent generator ID based on the hash of the generator data.
        Returns first 8 characters of the hash for a shorter ID.
        """
        data = {
            'theme_desc': theme_desc,
            'theme_desc_better': theme_desc_better,
            'language': language,
            'player_defs': player_defs,
            'item_defs': item_defs,
            'enemy_defs': enemy_defs,
            'celltype_defs': celltype_defs
        }
        data_json = json.dumps(data, sort_keys=True)
        hash_object = hashlib.sha256(data_json.encode('utf-8'))
        generator_id = hash_object.hexdigest()[:8]  # Take only first 8 characters
        return generator_id

    def save_generator(
            self,
            theme_desc: str,
            theme_desc_better: str,
            language: str,
            player_defs: List[Dict],
            item_defs: List[Dict],
            enemy_defs: List[Dict],
            celltype_defs: List[Dict],
            owner_id: Optional[str] = None,
            visibility: str = "unlisted"
    ) -> str:
        """
        Save a generator and return its unique ID.
        Uses UPSERT pattern to handle concurrent inserts safely.
        """
        visibility = self._normalize_visibility(visibility)

        def _save(conn, *args):
            generator_id = self.generate_generator_id(
                theme_desc,
                theme_desc_better,
                language,
                player_defs,
                item_defs,
                enemy_defs,
                celltype_defs
            )

            cur = conn.cursor()
            # Use INSERT OR REPLACE to handle concurrent inserts
            cur.execute("""
                INSERT OR REPLACE INTO generators
                (id, theme_desc, theme_desc_better, language, player_defs, item_defs, enemy_defs, celltype_defs, owner_id, visibility, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                generator_id,
                theme_desc,
                theme_desc_better,
                language,
                json.dumps(player_defs),
                json.dumps(item_defs),
                json.dumps(enemy_defs),
                json.dumps(celltype_defs),
                owner_id,
                visibility
            ))
            conn.commit()
            return generator_id

        generator_id = self._execute_with_retry(_save)
        # Upload is now scheduled automatically by the connection wrapper
        return generator_id

    def _normalize_visibility(self, visibility: Optional[str]) -> str:
        normalized = (visibility or "unlisted").strip().lower()
        if normalized not in VALID_WORLD_VISIBILITIES:
            raise ValueError(
                f"visibility must be one of: {', '.join(sorted(VALID_WORLD_VISIBILITIES))}"
            )
        return normalized

    def _normalize_moderation_status(self, moderation_status: Optional[str]) -> str:
        normalized = (moderation_status or "not_requested").strip().lower()
        if normalized not in VALID_WORLD_MODERATION_STATUSES:
            raise ValueError(
                "moderation_status must be one of: "
                f"{', '.join(sorted(VALID_WORLD_MODERATION_STATUSES))}"
            )
        return normalized

    def _utc_timestamp(self, value: Optional[datetime] = None) -> str:
        timestamp = value or datetime.now(timezone.utc)
        return timestamp.astimezone(timezone.utc).replace(
            microsecond=0,
            tzinfo=None,
        ).isoformat(sep=" ")

    def _json_list_value(self, raw_value: Optional[str]) -> List:
        try:
            value = json.loads(raw_value or "[]")
            return value if isinstance(value, list) else []
        except json.JSONDecodeError:
            return []

    def _generator_from_row(self, row) -> Dict:
        return {
            'theme_desc': row[0],
            'theme_desc_better': row[1],
            'language': row[2],
            'player_defs': json.loads(row[3]),
            'item_defs': json.loads(row[4]),
            'enemy_defs': json.loads(row[5]),
            'celltype_defs': json.loads(row[6]),
            'owner_id': row[7],
            'visibility': row[8],
            'moderation_status': row[9] or "not_requested",
            'moderation_reason': row[10],
            'moderation_model': row[11],
            'moderation_confidence': row[12],
            'moderation_categories': self._json_list_value(row[13]),
            'public_requested_at': row[14],
            'public_review_after': row[15],
            'public_reviewed_at': row[16],
            'updated_at': row[17],
        }

    def get_generator(self, generator_id: str) -> Optional[Dict]:
        """
        Retrieve a generator by its ID.
        Returns None if not found.
        """
        def _get(conn, generator_id):
            cur = conn.cursor()
            cur.execute("""
                SELECT theme_desc, theme_desc_better, language,
                       player_defs, item_defs, enemy_defs, celltype_defs,
                       owner_id, visibility, moderation_status,
                       moderation_reason, moderation_model, moderation_confidence,
                       moderation_categories, public_requested_at,
                       public_review_after, public_reviewed_at, updated_at
                FROM generators
                WHERE id = ?
            """, (generator_id,))

            result = cur.fetchone()
            if result is None:
                return None

            return self._generator_from_row(result)

        return self._execute_with_retry(_get, generator_id)

    def get_visible_generator(self, generator_id: str, requester_owner_id: Optional[str] = None) -> Optional[Dict]:
        """
        Retrieve a generator only if it is visible to the requester.
        Public and unlisted are always visible.
        Private is visible only to its owner.
        Returns None if not found or not visible.
        """
        generator = self.get_generator(generator_id)
        if generator is None:
            return None

        visibility = generator.get('visibility', 'unlisted')
        if visibility == 'private':
            if generator.get('owner_id') is not None and generator.get('owner_id') == requester_owner_id:
                return generator
            return None

        return generator

    def update_generator_definitions(
            self,
            generator_id: str,
            player_defs: Optional[List[Dict]] = None,
            enemy_defs: Optional[List[Dict]] = None,
            celltype_defs: Optional[Union[List[Dict], Dict]] = None,
    ) -> None:
        """Update stored definitions in place, keeping the same generator id.

        `save_generator` derives the id from a hash of the definitions, so
        re-saving after attaching art URLs would mint a different id and orphan
        the art written under the original one. This is a targeted UPDATE for
        that case.
        """
        assignments = []
        values = []
        if player_defs is not None:
            assignments.append("player_defs = ?")
            values.append(json.dumps(player_defs))
        if enemy_defs is not None:
            assignments.append("enemy_defs = ?")
            values.append(json.dumps(enemy_defs))
        if celltype_defs is not None:
            assignments.append("celltype_defs = ?")
            values.append(json.dumps(celltype_defs))

        if not assignments:
            return

        def _update(conn, *args):
            cur = conn.cursor()
            cur.execute(
                f"UPDATE generators SET {', '.join(assignments)}, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (*values, generator_id),
            )
            conn.commit()

        self._execute_with_retry(_update)

    def get_generator_world(
            self,
            generator_id: str,
            snapshot_version: int = 1
    ) -> Optional[Dict]:
        """Retrieve the persisted playable snapshot for a generated world.

        The snapshot stores the map as cell-type ids and the placements as
        entity ids, so both stay language-independent. Only `tile_info` holds
        generated prose, which is why the source language is recorded with it.
        """
        def _get(conn, generator_id, snapshot_version):
            cur = conn.cursor()
            cur.execute("""
                SELECT language, map_csv, entity_placements, tile_info, visual_manifest, regions
                FROM generator_worlds
                WHERE generator_id = ? AND snapshot_version = ?
            """, (generator_id, snapshot_version))

            result = cur.fetchone()
            if result is None:
                return None

            tile_info = json.loads(result[3]) if result[3] else {}
            return {
                'language': result[0],
                'map_csv': result[1],
                'entity_placements': json.loads(result[2]) if result[2] else [],
                # Keyed by language: generated prose is not reusable across
                # languages, but the map and placements are.
                'tile_info_by_language': tile_info if isinstance(tile_info, dict) else {},
                'visual_manifest': json.loads(result[4]) if result[4] else None,
                # Keyed by language, like tile_info: crossing lines are prose
                # and are not reusable across languages. Absent on worlds saved
                # before area crossings existed, and a bare list on the handful
                # saved while this was briefly unkeyed - both fall back to
                # regenerating rather than failing the snapshot.
                'regions_by_language': DatabaseManager._as_language_map(result[5]),
            }

        return self._execute_with_retry(_get, generator_id, snapshot_version)

    def save_generator_visual_manifest(
            self,
            generator_id: str,
            manifest: Dict,
            snapshot_version: int = 1
    ) -> None:
        """Persist a World's art direction: its style, palette, and exclusions.

        Written at forge time, whereas the rest of the snapshot is written when
        a run first initializes. The two therefore touch deliberately disjoint
        columns, so whichever lands second cannot blank the other.
        """
        def _save(conn, *args):
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO generator_worlds (generator_id, snapshot_version, visual_manifest)
                VALUES (?, ?, ?)
                ON CONFLICT(generator_id) DO UPDATE SET
                    visual_manifest = excluded.visual_manifest,
                    updated_at = CURRENT_TIMESTAMP
            """, (generator_id, snapshot_version, json.dumps(manifest)))
            conn.commit()

        self._execute_with_retry(_save)

    @staticmethod
    def _as_language_map(raw):
        """Read a language-keyed column, tolerating a pre-keying bare list."""
        if not raw:
            return {}
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}

    def save_generator_world(
            self,
            generator_id: str,
            language: str,
            map_csv: str,
            entity_placements: List[Dict],
            tile_info_by_language: Dict[str, List[Dict]],
            snapshot_version: int = 1,
            regions_by_language: Optional[Dict[str, List[Dict]]] = None,
    ) -> None:
        """Persist the playable snapshot so replays reuse it instead of regenerating."""
        def _save(conn, *args):
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO generator_worlds
                (generator_id, snapshot_version, language, map_csv, entity_placements, tile_info, regions)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(generator_id) DO UPDATE SET
                    snapshot_version = excluded.snapshot_version,
                    language = excluded.language,
                    map_csv = excluded.map_csv,
                    entity_placements = excluded.entity_placements,
                    tile_info = excluded.tile_info,
                    regions = excluded.regions,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                generator_id,
                snapshot_version,
                language,
                map_csv,
                json.dumps(entity_placements),
                json.dumps(tile_info_by_language),
                json.dumps(regions_by_language or {})
            ))
            conn.commit()

        self._execute_with_retry(_save)

    def get_generator_translation(
            self,
            generator_id: str,
            language: str,
            translation_version: int = 1
    ) -> Optional[Dict]:
        """Retrieve a cached per-language translation for a generated world."""
        def _get(conn, generator_id, language, translation_version):
            cur = conn.cursor()
            cur.execute("""
                SELECT theme_desc_better, player_defs, item_defs, enemy_defs, celltype_defs
                FROM generator_translations
                WHERE generator_id = ? AND language = ? AND translation_version = ?
            """, (generator_id, language, translation_version))

            result = cur.fetchone()
            if result is None:
                return None

            return {
                'language': language,
                'theme_desc_better': result[0],
                'player_defs': json.loads(result[1]),
                'item_defs': json.loads(result[2]),
                'enemy_defs': json.loads(result[3]),
                'celltype_defs': json.loads(result[4])
            }

        return self._execute_with_retry(_get, generator_id, language, translation_version)

    def list_generator_translations(self, generator_id: str) -> List[Dict]:
        """Return every cached language view so shared art URLs can be updated."""
        def _list(conn, target_generator_id):
            rows = conn.execute("""
                SELECT language, theme_desc_better, player_defs, item_defs,
                       enemy_defs, celltype_defs, translation_version
                FROM generator_translations
                WHERE generator_id = ?
            """, (target_generator_id,)).fetchall()
            return [
                {
                    "language": row[0],
                    "theme_desc_better": row[1],
                    "player_defs": json.loads(row[2]),
                    "item_defs": json.loads(row[3]),
                    "enemy_defs": json.loads(row[4]),
                    "celltype_defs": json.loads(row[5]),
                    "translation_version": int(row[6] or 1),
                }
                for row in rows
            ]

        return self._execute_with_retry(_list, generator_id)

    def save_generator_translation(
            self,
            generator_id: str,
            language: str,
            theme_desc_better: str,
            player_defs: List[Dict],
            item_defs: List[Dict],
            enemy_defs: List[Dict],
            celltype_defs: Union[List[Dict], Dict],
            translation_version: int = 1
    ) -> None:
        """Cache a translated view of a generated world for one language."""
        def _save(conn, *args):
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO generator_translations
                (generator_id, language, theme_desc_better, player_defs, item_defs, enemy_defs, celltype_defs,
                 translation_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(generator_id, language) DO UPDATE SET
                    theme_desc_better = excluded.theme_desc_better,
                    player_defs = excluded.player_defs,
                    item_defs = excluded.item_defs,
                    enemy_defs = excluded.enemy_defs,
                    celltype_defs = excluded.celltype_defs,
                    translation_version = excluded.translation_version,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                generator_id,
                language,
                theme_desc_better,
                json.dumps(player_defs),
                json.dumps(item_defs),
                json.dumps(enemy_defs),
                json.dumps(celltype_defs),
                translation_version
            ))
            conn.commit()

        self._execute_with_retry(_save)

    def update_generator_visibility(self, generator_id: str, visibility: str) -> bool:
        """Update the visibility of a generator. Returns True if updated."""
        visibility = self._normalize_visibility(visibility)

        def _update(conn, generator_id, visibility):
            cur = conn.cursor()
            cur.execute("""
                UPDATE generators
                SET visibility = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (visibility, generator_id))
            conn.commit()
            return cur.rowcount > 0

        return self._execute_with_retry(_update, generator_id, visibility)

    def set_generator_non_public_visibility(self, generator_id: str, visibility: str) -> bool:
        """Set private/unlisted visibility and clear any pending public request."""
        visibility = self._normalize_visibility(visibility)
        if visibility == "public":
            raise ValueError("Use public review flow before setting visibility to public")

        def _update(conn, generator_id, visibility):
            cur = conn.cursor()
            cur.execute("""
                UPDATE generators
                SET visibility = ?,
                    moderation_status = 'not_requested',
                    moderation_reason = NULL,
                    moderation_model = NULL,
                    moderation_confidence = NULL,
                    moderation_categories = NULL,
                    public_requested_at = NULL,
                    public_review_after = NULL,
                    public_reviewed_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (visibility, generator_id))
            conn.commit()
            return cur.rowcount > 0

        return self._execute_with_retry(_update, generator_id, visibility)

    def request_public_visibility(
            self,
            generator_id: str,
            requested_by_owner_id: str,
            review_delay_seconds: int,
            reviewer_model: str,
    ) -> Optional[Dict]:
        """Queue a public visibility review while keeping the World non-public."""
        delay_seconds = max(0, int(review_delay_seconds))
        requested_at = datetime.now(timezone.utc)
        review_after = requested_at + timedelta(seconds=delay_seconds)
        requested_at_text = self._utc_timestamp(requested_at)
        review_after_text = self._utc_timestamp(review_after)

        def _request(
                conn,
                generator_id,
                requested_by_owner_id,
                reviewer_model,
                requested_at_text,
                review_after_text,
        ):
            cur = conn.cursor()
            cur.execute("""
                UPDATE generators
                SET moderation_status = 'pending',
                    moderation_reason = 'Public review is queued.',
                    moderation_model = ?,
                    moderation_confidence = NULL,
                    moderation_categories = '[]',
                    public_requested_at = ?,
                    public_review_after = ?,
                    public_reviewed_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND owner_id = ?
                  AND visibility != 'public'
            """, (
                reviewer_model,
                requested_at_text,
                review_after_text,
                generator_id,
                requested_by_owner_id,
            ))
            conn.commit()
            if cur.rowcount == 0:
                return None

            cur.execute("""
                SELECT theme_desc, theme_desc_better, language,
                       player_defs, item_defs, enemy_defs, celltype_defs,
                       owner_id, visibility, moderation_status,
                       moderation_reason, moderation_model, moderation_confidence,
                       moderation_categories, public_requested_at,
                       public_review_after, public_reviewed_at, updated_at
                FROM generators
                WHERE id = ?
            """, (generator_id,))
            row = cur.fetchone()
            if not row:
                return None

            world = self._generator_from_row(row)
            world["id"] = generator_id
            return world

        return self._execute_with_retry(
            _request,
            generator_id,
            requested_by_owner_id,
            reviewer_model,
            requested_at_text,
            review_after_text,
        )

    def list_due_public_reviews(self, limit: int = 5) -> List[Dict]:
        """Return pending public review rows whose review-after time has passed."""
        limit = max(1, min(limit, 20))
        now_text = self._utc_timestamp()

        def _list(conn, limit, now_text):
            cur = conn.cursor()
            cur.execute("""
                SELECT id, theme_desc, theme_desc_better, language,
                       player_defs, item_defs, enemy_defs, celltype_defs,
                       owner_id, visibility, moderation_status,
                       moderation_reason, moderation_model, moderation_confidence,
                       moderation_categories, public_requested_at,
                       public_review_after, public_reviewed_at, updated_at
                FROM generators
                WHERE moderation_status = 'pending'
                  AND visibility != 'public'
                  AND public_review_after IS NOT NULL
                  AND public_review_after <= ?
                ORDER BY public_review_after ASC
                LIMIT ?
            """, (now_text, limit))

            reviews = []
            for row in cur.fetchall():
                world = self._generator_from_row(row[1:])
                world["id"] = row[0]
                reviews.append(world)
            return reviews

        return self._execute_with_retry(_list, limit, now_text)

    def count_pending_public_reviews(self) -> int:
        """Return the number of non-public Worlds waiting for public review."""
        def _count(conn):
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*)
                FROM generators
                WHERE moderation_status = 'pending'
                  AND visibility != 'public'
            """)
            return int(cur.fetchone()[0])

        return self._execute_with_retry(_count)

    def record_public_review(
            self,
            generator_id: str,
            requested_by_owner_id: Optional[str],
            model_name: str,
            decision: str,
            confidence: Optional[float],
            categories: List[str],
            public_reason: str,
            internal_notes: str,
    ) -> bool:
        """Record an LLM public review and publish only approved Worlds."""
        normalized_decision = (decision or "").strip().lower()
        if normalized_decision not in {"approve", "reject", "needs_human_review", "error"}:
            normalized_decision = "needs_human_review"

        if normalized_decision == "approve":
            moderation_status = "approved"
            visibility_update = "public"
        elif normalized_decision == "reject":
            moderation_status = "rejected"
            visibility_update = None
        elif normalized_decision == "error":
            moderation_status = "error"
            visibility_update = None
        else:
            moderation_status = "needs_human_review"
            visibility_update = None

        reviewed_at = self._utc_timestamp()
        categories_json = json.dumps(categories or [], sort_keys=True)
        confidence_value = None
        if confidence is not None:
            confidence_value = max(0.0, min(1.0, float(confidence)))

        def _record(conn):
            cur = conn.cursor()
            review_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO world_moderation_reviews
                (id, generator_id, requested_by_owner_id, model_name, decision,
                 confidence, categories, public_reason, internal_notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                review_id,
                generator_id,
                requested_by_owner_id,
                model_name,
                normalized_decision,
                confidence_value,
                categories_json,
                public_reason,
                internal_notes,
            ))

            if visibility_update:
                cur.execute("""
                    UPDATE generators
                    SET visibility = ?,
                        moderation_status = ?,
                        moderation_reason = ?,
                        moderation_model = ?,
                        moderation_confidence = ?,
                        moderation_categories = ?,
                        public_reviewed_at = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                      AND moderation_status = 'pending'
                """, (
                    visibility_update,
                    moderation_status,
                    public_reason,
                    model_name,
                    confidence_value,
                    categories_json,
                    reviewed_at,
                    generator_id,
                ))
            else:
                cur.execute("""
                    UPDATE generators
                    SET moderation_status = ?,
                        moderation_reason = ?,
                        moderation_model = ?,
                        moderation_confidence = ?,
                        moderation_categories = ?,
                        public_reviewed_at = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                      AND moderation_status = 'pending'
                """, (
                    moderation_status,
                    public_reason,
                    model_name,
                    confidence_value,
                    categories_json,
                    reviewed_at,
                    generator_id,
                ))

            conn.commit()
            return cur.rowcount > 0

        return self._execute_with_retry(_record)

    def record_public_review_error(
            self,
            generator_id: str,
            model_name: str,
            public_reason: str,
            internal_notes: str,
    ) -> bool:
        """Record a review failure without exposing internal error details."""
        return self.record_public_review(
            generator_id=generator_id,
            requested_by_owner_id=None,
            model_name=model_name,
            decision="error",
            confidence=None,
            categories=["review_error"],
            public_reason=public_reason,
            internal_notes=internal_notes,
        )

    def list_worlds(self, limit: int = 20, local_dev: bool = False, owner_id: Optional[str] = None) -> List[Dict]:
        """
        Return recent reusable generated worlds.

        The database table is still named "generators" for compatibility, but
        each row is a reusable World that can start many play sessions.

        When owner_id is provided, all worlds owned by that user are returned.
        In local_dev mode, public and unlisted worlds are returned for dev
        convenience. Otherwise, only public worlds are returned.
        """
        limit = max(1, min(limit, 50))

        def _list(conn, limit, local_dev, owner_id):
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(generators)")
            columns = {row[1] for row in cur.fetchall()}
            has_created_at = "created_at" in columns
            has_updated_at = "updated_at" in columns
            has_owner_id = "owner_id" in columns
            has_visibility = "visibility" in columns
            has_moderation_status = "moderation_status" in columns
            has_moderation_reason = "moderation_reason" in columns
            has_moderation_model = "moderation_model" in columns
            has_moderation_confidence = "moderation_confidence" in columns
            has_moderation_categories = "moderation_categories" in columns
            has_public_requested_at = "public_requested_at" in columns
            has_public_review_after = "public_review_after" in columns
            has_public_reviewed_at = "public_reviewed_at" in columns

            # Qualified with g., because generator_worlds carries columns of
            # the same names and the join would otherwise be ambiguous.
            created_at_select = "g.created_at" if has_created_at else "NULL AS created_at"
            updated_at_select = "g.updated_at" if has_updated_at else "NULL AS updated_at"
            if has_updated_at and has_created_at:
                order_by = "COALESCE(g.updated_at, g.created_at) DESC"
            elif has_updated_at:
                order_by = "g.updated_at DESC"
            elif has_created_at:
                order_by = "g.created_at DESC"
            else:
                order_by = "g.rowid DESC"

            if owner_id is not None:
                if not has_owner_id:
                    return []
                where_clause = "g.owner_id = ?"
                params = (owner_id,)
            elif local_dev or not has_visibility:
                where_clause = "g.visibility != 'private'" if has_visibility else "1=1"
                params = ()
            else:
                where_clause = "g.visibility = 'public'"
                params = ()

            owner_id_select = "g.owner_id" if has_owner_id else "NULL AS owner_id"
            visibility_select = "g.visibility" if "visibility" in columns else "'unlisted' AS visibility"
            moderation_status_select = (
                "g.moderation_status"
                if has_moderation_status
                else "'not_requested' AS moderation_status"
            )
            moderation_reason_select = (
                "g.moderation_reason"
                if has_moderation_reason
                else "NULL AS moderation_reason"
            )
            moderation_model_select = (
                "g.moderation_model"
                if has_moderation_model
                else "NULL AS moderation_model"
            )
            moderation_confidence_select = (
                "g.moderation_confidence"
                if has_moderation_confidence
                else "NULL AS moderation_confidence"
            )
            moderation_categories_select = (
                "g.moderation_categories"
                if has_moderation_categories
                else "'[]' AS moderation_categories"
            )
            public_requested_at_select = (
                "g.public_requested_at"
                if has_public_requested_at
                else "NULL AS public_requested_at"
            )
            public_review_after_select = (
                "g.public_review_after"
                if has_public_review_after
                else "NULL AS public_review_after"
            )
            public_reviewed_at_select = (
                "g.public_reviewed_at"
                if has_public_reviewed_at
                else "NULL AS public_reviewed_at"
            )

            # Databases predating world snapshots have no generator_worlds
            # table at all, so the join has to be conditional the same way every
            # column check above is.
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='generator_worlds'"
            )
            has_worlds_table = cur.fetchone() is not None
            if has_worlds_table:
                manifest_select = "w.visual_manifest"
                manifest_join = "LEFT JOIN generator_worlds w ON w.generator_id = g.id"
            else:
                manifest_select = "NULL AS visual_manifest"
                manifest_join = ""

            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='world_metrics'"
            )
            has_metrics_table = cur.fetchone() is not None
            if has_metrics_table:
                metrics_select = """
                    COALESCE(m.play_count, 0),
                    COALESCE(m.completion_count, 0),
                    COALESCE(m.unique_completer_count, 0)
                """
                metrics_join = "LEFT JOIN world_metrics m ON m.generator_id = g.id"
            else:
                metrics_select = "0, 0, 0"
                metrics_join = ""

            # Left join so a World without art still lists; the gallery falls
            # back to a text card for those.
            cur.execute(f"""
                SELECT g.id, g.theme_desc, g.theme_desc_better, g.language,
                       g.player_defs, g.item_defs, g.enemy_defs, g.celltype_defs,
                       {created_at_select}, {updated_at_select},
                       {owner_id_select}, {visibility_select},
                       {moderation_status_select}, {moderation_reason_select},
                       {moderation_model_select}, {moderation_confidence_select},
                       {moderation_categories_select}, {public_requested_at_select},
                       {public_review_after_select}, {public_reviewed_at_select},
                       {manifest_select}, {metrics_select}
                FROM generators g
                {manifest_join}
                {metrics_join}
                WHERE {where_clause}
                ORDER BY {order_by}
                LIMIT ?
            """, params + (limit,))

            worlds = []
            for row in cur.fetchall():
                theme_desc = row[1] or ""
                theme_desc_better = row[2] or theme_desc
                title_source = theme_desc_better.strip() or theme_desc.strip()
                title = title_source.splitlines()[0][:120] if title_source else row[0]

                worlds.append({
                    "id": row[0],
                    "title": title,
                    "theme": theme_desc,
                    "language": row[3],
                    "player_count": self._json_list_size(row[4]),
                    "item_count": self._json_list_size(row[5]),
                    "enemy_count": self._json_list_size(row[6]),
                    "terrain_count": self._json_mapping_size(row[7]),
                    "created_at": row[8],
                    "updated_at": row[9],
                    "owner_id": row[10],
                    "visibility": row[11],
                    "moderation_status": row[12] or "not_requested",
                    "moderation_reason": row[13],
                    "moderation_model": row[14],
                    "moderation_confidence": row[15],
                    "moderation_categories": self._json_list_value(row[16]),
                    "public_requested_at": row[17],
                    "public_review_after": row[18],
                    "public_reviewed_at": row[19],
                    "cover_url": self._cover_url_from_manifest(row[20]),
                    "play_count": int(row[21] or 0),
                    "completion_count": int(row[22] or 0),
                    "unique_completer_count": int(row[23] or 0),
                })

            return worlds

        return self._execute_with_retry(_list, limit, local_dev, owner_id)

    @staticmethod
    def _cover_url_from_manifest(raw_manifest: Optional[str]) -> Optional[str]:
        """Pull the gallery card out of a stored visual manifest.

        Worlds forged before art existed, or whose art failed, simply have no
        cover; the gallery falls back to a text card for those.
        """
        if not raw_manifest:
            return None

        try:
            manifest = json.loads(raw_manifest)
        except (json.JSONDecodeError, TypeError):
            return None

        if not isinstance(manifest, dict):
            return None

        cover_url = manifest.get("cover_url")
        return cover_url if isinstance(cover_url, str) and cover_url else None

    def get_user_world_stats(self, owner_id: str) -> Dict:
        """Return lightweight dashboard stats for Worlds owned by a user."""
        def _stats(conn, owner_id):
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(generators)")
            columns = {row[1] for row in cur.fetchall()}
            if "owner_id" not in columns:
                return {
                    "total_worlds": 0,
                    "private_worlds": 0,
                    "unlisted_worlds": 0,
                    "public_worlds": 0,
                    "total_entities": 0,
                    "total_plays": 0,
                    "total_completions": 0,
                    "unique_completers": 0,
                    "creator_reward_credits": 0,
                }

            visibility_select = "visibility" if "visibility" in columns else "'unlisted' AS visibility"
            cur.execute(f"""
                SELECT {visibility_select}, player_defs, item_defs, enemy_defs, celltype_defs
                FROM generators
                WHERE owner_id = ?
            """, (owner_id,))

            stats = {
                "total_worlds": 0,
                "private_worlds": 0,
                "unlisted_worlds": 0,
                "public_worlds": 0,
                "total_entities": 0,
                "total_plays": 0,
                "total_completions": 0,
                "unique_completers": 0,
                "creator_reward_credits": 0,
            }
            for row in cur.fetchall():
                visibility = row[0] or "unlisted"
                stats["total_worlds"] += 1
                if visibility == "private":
                    stats["private_worlds"] += 1
                elif visibility == "public":
                    stats["public_worlds"] += 1
                else:
                    stats["unlisted_worlds"] += 1

                stats["total_entities"] += (
                    self._json_list_size(row[1])
                    + self._json_list_size(row[2])
                    + self._json_list_size(row[3])
                    + self._json_mapping_size(row[4])
                )

            has_metrics = cur.execute("""
                SELECT 1
                FROM sqlite_master
                WHERE type = 'table' AND name = 'world_metrics'
            """).fetchone()
            if has_metrics:
                metrics = cur.execute("""
                    SELECT
                        COALESCE(SUM(m.play_count), 0),
                        COALESCE(SUM(m.completion_count), 0),
                        COALESCE(SUM(m.unique_completer_count), 0)
                    FROM generators g
                    LEFT JOIN world_metrics m ON m.generator_id = g.id
                    WHERE g.owner_id = ?
                """, (owner_id,)).fetchone()
                stats["total_plays"] = int(metrics[0] or 0)
                stats["total_completions"] = int(metrics[1] or 0)
                stats["unique_completers"] = int(metrics[2] or 0)

            creator_rewards = cur.execute("""
                SELECT COALESCE(SUM(amount), 0)
                FROM credit_ledger
                WHERE user_id = ?
                  AND kind = 'creator_milestone_reward'
                  AND amount > 0
            """, (owner_id,)).fetchone()
            stats["creator_reward_credits"] = int(creator_rewards[0] or 0)

            return stats

        return self._execute_with_retry(_stats, owner_id)

    @staticmethod
    def _credit_balance_from_connection(conn, user_id: str) -> Dict[str, int]:
        row = conn.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN bucket = 'promo' THEN amount ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN bucket = 'paid' THEN amount ELSE 0 END), 0)
            FROM credit_ledger
            WHERE user_id = ?
        """, (user_id,)).fetchone()
        promo = int(row[0] or 0)
        paid = int(row[1] or 0)
        return {"promo": promo, "paid": paid, "total": promo + paid}

    def get_credit_balance(self, user_id: str) -> Dict[str, int]:
        return self._execute_with_retry(
            lambda conn, target_user_id: self._credit_balance_from_connection(
                conn, target_user_id
            ),
            user_id,
        )

    def record_verified_store_purchase(
            self,
            user_id: str,
            provider: str,
            external_transaction_id: str,
            product_id: str,
            credits: int,
            environment: str,
            provider_metadata: Optional[Dict] = None,
    ) -> Dict:
        """Atomically record one verified purchase and grant paid credits.

        Verification happens outside this class. This method deliberately
        accepts a fixed credit amount from the server-side product catalog,
        then makes the purchase row and ledger grant one transaction.
        """
        if provider not in {"apple", "google"}:
            raise ValueError("Store provider must be 'apple' or 'google'")
        if not external_transaction_id:
            raise ValueError("Store transaction identifier is required")
        if not product_id:
            raise ValueError("Store product identifier is required")
        if credits <= 0:
            raise ValueError("Store credit grant must be positive")

        transaction_digest = hashlib.sha256(
            f"{provider}:{external_transaction_id}".encode("utf-8")
        ).hexdigest()
        operation_key = f"store_purchase:{provider}:{transaction_digest}"
        metadata_json = (
            json.dumps(provider_metadata, sort_keys=True)
            if provider_metadata else None
        )

        def _record(conn):
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("""
                SELECT id, user_id, product_id, credits, environment
                FROM store_purchases
                WHERE provider = ? AND external_transaction_id = ?
            """, (provider, external_transaction_id)).fetchone()
            if existing:
                same_purchase = (
                    existing[1] == user_id
                    and existing[2] == product_id
                    and int(existing[3]) == credits
                )
                balance = self._credit_balance_from_connection(conn, user_id)
                conn.commit()
                return {
                    "applied": False,
                    "conflict": not same_purchase,
                    "purchase_id": existing[0],
                    "product_id": existing[2],
                    "credits": int(existing[3]),
                    "environment": existing[4],
                    "balance": balance,
                }

            purchase_id = str(uuid.uuid4())
            conn.execute("""
                INSERT INTO store_purchases (
                    id, provider, external_transaction_id, user_id,
                    product_id, credits, environment, provider_metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                purchase_id, provider, external_transaction_id, user_id,
                product_id, credits, environment, metadata_json,
            ))
            conn.execute("""
                INSERT INTO credit_ledger (
                    id, operation_key, user_id, bucket, amount, kind,
                    reference_type, reference_id, metadata
                ) VALUES (?, ?, ?, 'paid', ?, 'store_purchase',
                          'store_purchase', ?, ?)
            """, (
                str(uuid.uuid4()), operation_key, user_id, credits,
                purchase_id, metadata_json,
            ))
            balance = self._credit_balance_from_connection(conn, user_id)
            conn.commit()
            return {
                "applied": True,
                "conflict": False,
                "purchase_id": purchase_id,
                "product_id": product_id,
                "credits": credits,
                "environment": environment,
                "balance": balance,
            }

        return self._execute_with_retry(_record)

    def grant_credits(
            self,
            user_id: str,
            amount: int,
            kind: str,
            operation_key: str,
            bucket: str = "promo",
            reference_type: Optional[str] = None,
            reference_id: Optional[str] = None,
            metadata: Optional[Dict] = None,
    ) -> Dict:
        """Append one idempotent positive ledger entry."""
        if amount <= 0:
            raise ValueError("Credit grants must be positive")
        if bucket not in {"promo", "paid"}:
            raise ValueError("Credit bucket must be 'promo' or 'paid'")

        def _grant(conn):
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("""
                SELECT id
                FROM credit_ledger
                WHERE operation_key = ? AND bucket = ?
            """, (operation_key, bucket)).fetchone()
            applied = existing is None
            if applied:
                conn.execute("""
                    INSERT INTO credit_ledger (
                        id, operation_key, user_id, bucket, amount, kind,
                        reference_type, reference_id, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(uuid.uuid4()), operation_key, user_id, bucket, amount, kind,
                    reference_type, reference_id,
                    json.dumps(metadata, sort_keys=True) if metadata else None,
                ))

            balance = self._credit_balance_from_connection(conn, user_id)
            conn.commit()
            return {"applied": applied, "amount": amount, "balance": balance}

        return self._execute_with_retry(_grant)

    def spend_credits(
            self,
            user_id: str,
            amount: int,
            kind: str,
            operation_key: str,
            reference_type: Optional[str] = None,
            reference_id: Optional[str] = None,
            metadata: Optional[Dict] = None,
    ) -> Dict:
        """Atomically spend promo credits first, then paid credits.

        The spend is itself append-only. Calling this again with the same
        operation key returns the original successful result without charging
        twice.
        """
        if amount < 0:
            raise ValueError("Credit spend cannot be negative")
        if amount == 0:
            balance = self.get_credit_balance(user_id)
            return {
                "spent": True, "applied": False, "amount": 0,
                "operation_key": operation_key, "balance": balance,
            }

        def _spend(conn):
            conn.execute("BEGIN IMMEDIATE")
            existing_rows = conn.execute("""
                SELECT amount
                FROM credit_ledger
                WHERE operation_key = ? AND user_id = ? AND amount < 0
            """, (operation_key, user_id)).fetchall()
            if existing_rows:
                charged = -sum(int(row[0]) for row in existing_rows)
                balance = self._credit_balance_from_connection(conn, user_id)
                conn.commit()
                return {
                    "spent": True, "applied": False, "amount": charged,
                    "operation_key": operation_key, "balance": balance,
                }

            balance = self._credit_balance_from_connection(conn, user_id)
            if balance["total"] < amount:
                conn.rollback()
                return {
                    "spent": False, "applied": False, "amount": amount,
                    "operation_key": operation_key, "balance": balance,
                }

            promo_amount = min(balance["promo"], amount)
            paid_amount = amount - promo_amount
            metadata_json = json.dumps(metadata, sort_keys=True) if metadata else None
            for bucket, bucket_amount in (
                    ("promo", promo_amount),
                    ("paid", paid_amount),
            ):
                if not bucket_amount:
                    continue
                conn.execute("""
                    INSERT INTO credit_ledger (
                        id, operation_key, user_id, bucket, amount, kind,
                        reference_type, reference_id, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(uuid.uuid4()), operation_key, user_id, bucket,
                    -bucket_amount, kind, reference_type, reference_id,
                    metadata_json,
                ))

            updated_balance = self._credit_balance_from_connection(conn, user_id)
            conn.commit()
            return {
                "spent": True, "applied": True, "amount": amount,
                "operation_key": operation_key, "balance": updated_balance,
            }

        return self._execute_with_retry(_spend)

    def refund_credit_spend(
            self,
            user_id: str,
            original_operation_key: str,
            kind: str = "technical_refund",
            reference_type: Optional[str] = None,
            reference_id: Optional[str] = None,
    ) -> Optional[Dict]:
        """Reverse an earlier spend into the exact buckets it came from."""
        refund_operation_key = f"refund:{original_operation_key}"

        def _refund(conn):
            conn.execute("BEGIN IMMEDIATE")
            existing_rows = conn.execute("""
                SELECT amount
                FROM credit_ledger
                WHERE operation_key = ? AND user_id = ? AND amount > 0
            """, (refund_operation_key, user_id)).fetchall()
            if existing_rows:
                balance = self._credit_balance_from_connection(conn, user_id)
                conn.commit()
                return {
                    "refunded": True, "applied": False,
                    "amount": sum(int(row[0]) for row in existing_rows),
                    "operation_key": refund_operation_key, "balance": balance,
                }

            spent_rows = conn.execute("""
                SELECT bucket, amount
                FROM credit_ledger
                WHERE operation_key = ? AND user_id = ? AND amount < 0
            """, (original_operation_key, user_id)).fetchall()
            if not spent_rows:
                conn.rollback()
                return None

            refunded_amount = 0
            for bucket, raw_amount in spent_rows:
                amount = -int(raw_amount)
                refunded_amount += amount
                conn.execute("""
                    INSERT INTO credit_ledger (
                        id, operation_key, user_id, bucket, amount, kind,
                        reference_type, reference_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(uuid.uuid4()), refund_operation_key, user_id, bucket,
                    amount, kind, reference_type, reference_id,
                ))

            balance = self._credit_balance_from_connection(conn, user_id)
            conn.commit()
            return {
                "refunded": True, "applied": True, "amount": refunded_amount,
                "operation_key": refund_operation_key, "balance": balance,
            }

        return self._execute_with_retry(_refund)

    @staticmethod
    def _world_metrics_from_connection(conn, generator_id: str) -> Dict[str, int]:
        row = conn.execute("""
            SELECT play_count, completion_count, unique_completer_count
            FROM world_metrics
            WHERE generator_id = ?
        """, (generator_id,)).fetchone()
        if row is None:
            return {
                "play_count": 0,
                "completion_count": 0,
                "unique_completer_count": 0,
            }
        return {
            "play_count": int(row[0] or 0),
            "completion_count": int(row[1] or 0),
            "unique_completer_count": int(row[2] or 0),
        }

    def get_world_metrics(self, generator_id: str) -> Dict[str, int]:
        return self._execute_with_retry(
            lambda conn, world_id: self._world_metrics_from_connection(conn, world_id),
            generator_id,
        )

    def record_world_play_start(
            self,
            session_id: str,
            generator_id: str,
            user_id: Optional[str],
    ) -> Dict:
        """Count a run once even when its WebSocket reconnects."""
        def _record(conn):
            conn.execute("BEGIN IMMEDIATE")
            cur = conn.execute("""
                INSERT OR IGNORE INTO world_play_sessions (
                    session_id, generator_id, user_id
                ) VALUES (?, ?, ?)
            """, (session_id, generator_id, user_id))
            applied = cur.rowcount > 0
            if applied:
                conn.execute("""
                    INSERT INTO world_metrics (generator_id, play_count)
                    VALUES (?, 1)
                    ON CONFLICT(generator_id) DO UPDATE SET
                        play_count = play_count + 1,
                        updated_at = CURRENT_TIMESTAMP
                """, (generator_id,))

            metrics = self._world_metrics_from_connection(conn, generator_id)
            conn.commit()
            return {"applied": applied, **metrics}

        return self._execute_with_retry(_record)

    def record_world_completion(
            self,
            session_id: str,
            generator_id: str,
            user_id: Optional[str],
            reward_amount: int = 0,
            daily_reward_cap: int = 0,
            creator_milestones: Optional[Sequence[Tuple[int, int]]] = None,
    ) -> Dict:
        """Record a server-qualified win and its optional capped reward."""
        reward_amount = max(0, reward_amount)
        daily_reward_cap = max(0, daily_reward_cap)
        milestone_rewards = {}
        for player_count, credit_amount in creator_milestones or ():
            player_count = int(player_count)
            credit_amount = int(credit_amount)
            if player_count > 0 and credit_amount > 0:
                milestone_rewards[player_count] = credit_amount
        normalized_milestones = sorted(milestone_rewards.items())

        def _record(conn):
            conn.execute("BEGIN IMMEDIATE")
            play_cur = conn.execute("""
                INSERT OR IGNORE INTO world_play_sessions (
                    session_id, generator_id, user_id
                ) VALUES (?, ?, ?)
            """, (session_id, generator_id, user_id))
            if play_cur.rowcount > 0:
                conn.execute("""
                    INSERT INTO world_metrics (generator_id, play_count)
                    VALUES (?, 1)
                    ON CONFLICT(generator_id) DO UPDATE SET
                        play_count = play_count + 1,
                        updated_at = CURRENT_TIMESTAMP
                """, (generator_id,))

            completed_at = conn.execute("""
                SELECT completed_at
                FROM world_play_sessions
                WHERE session_id = ?
            """, (session_id,)).fetchone()
            if completed_at and completed_at[0] is not None:
                metrics = self._world_metrics_from_connection(conn, generator_id)
                balance = (
                    self._credit_balance_from_connection(conn, user_id)
                    if user_id else None
                )
                conn.commit()
                return {
                    "applied": False,
                    "reward_granted": False,
                    "credits_granted": 0,
                    "creator_reward": {
                        "reward_granted": False,
                        "credits_granted": 0,
                        "milestone_players": None,
                        "milestones_reached": [],
                    },
                    "balance": balance,
                    **metrics,
                }

            conn.execute("""
                UPDATE world_play_sessions
                SET completed_at = CURRENT_TIMESTAMP
                WHERE session_id = ?
            """, (session_id,))
            conn.execute("""
                INSERT INTO world_metrics (generator_id, completion_count)
                VALUES (?, 1)
                ON CONFLICT(generator_id) DO UPDATE SET
                    completion_count = completion_count + 1,
                    updated_at = CURRENT_TIMESTAMP
            """, (generator_id,))

            first_distinct_completion = False
            owner_id = None
            qualifies_for_popularity = False
            if user_id:
                owner_row = conn.execute(
                    "SELECT owner_id FROM generators WHERE id = ?",
                    (generator_id,),
                ).fetchone()
                owner_id = owner_row[0] if owner_row else None
                qualifies_for_popularity = owner_id != user_id
                completion_cur = conn.execute("""
                    INSERT OR IGNORE INTO world_player_completions (
                        user_id, generator_id, first_session_id,
                        qualifies_for_popularity
                    ) VALUES (?, ?, ?, ?)
                """, (
                    user_id, generator_id, session_id,
                    int(qualifies_for_popularity),
                ))
                first_distinct_completion = completion_cur.rowcount > 0
                if first_distinct_completion and qualifies_for_popularity:
                    conn.execute("""
                        UPDATE world_metrics
                        SET unique_completer_count = unique_completer_count + 1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE generator_id = ?
                    """, (generator_id,))

            creator_milestones_reached = []
            creator_credits_granted = 0
            if (
                    first_distinct_completion
                    and qualifies_for_popularity
                    and owner_id
                    and normalized_milestones
            ):
                unique_completer_count = self._world_metrics_from_connection(
                    conn, generator_id
                )["unique_completer_count"]
                for milestone_players, milestone_credits in normalized_milestones:
                    if milestone_players > unique_completer_count:
                        break
                    operation_key = (
                        f"creator_milestone:{generator_id}:{milestone_players}"
                    )
                    milestone_cur = conn.execute("""
                        INSERT OR IGNORE INTO credit_ledger (
                            id, operation_key, user_id, bucket, amount, kind,
                            reference_type, reference_id, metadata
                        ) VALUES (?, ?, ?, 'promo', ?,
                                  'creator_milestone_reward', 'world', ?, ?)
                    """, (
                        str(uuid.uuid4()), operation_key, owner_id,
                        milestone_credits, generator_id,
                        json.dumps({
                            "qualified_players": milestone_players,
                            "trigger_session_id": session_id,
                            "trigger_user_id": user_id,
                        }, sort_keys=True),
                    ))
                    if milestone_cur.rowcount > 0:
                        creator_credits_granted += milestone_credits
                        creator_milestones_reached.append({
                            "players": milestone_players,
                            "credits": milestone_credits,
                        })

            reward_granted = False
            credits_granted = 0
            daily_reward_count = 0
            if user_id:
                daily_reward_count = int(conn.execute("""
                    SELECT COUNT(DISTINCT operation_key)
                    FROM credit_ledger
                    WHERE user_id = ?
                      AND kind = 'play_completion_reward'
                      AND amount > 0
                      AND DATE(created_at) = DATE('now')
                """, (user_id,)).fetchone()[0] or 0)

            if (
                    user_id
                    and first_distinct_completion
                    and reward_amount > 0
                    and daily_reward_count < daily_reward_cap
            ):
                operation_key = f"completion_reward:{user_id}:{generator_id}"
                conn.execute("""
                    INSERT INTO credit_ledger (
                        id, operation_key, user_id, bucket, amount, kind,
                        reference_type, reference_id
                    ) VALUES (?, ?, ?, 'promo', ?, 'play_completion_reward',
                              'world', ?)
                """, (
                    str(uuid.uuid4()), operation_key, user_id,
                    reward_amount, generator_id,
                ))
                reward_granted = True
                credits_granted = reward_amount
                daily_reward_count += 1

            metrics = self._world_metrics_from_connection(conn, generator_id)
            balance = (
                self._credit_balance_from_connection(conn, user_id)
                if user_id else None
            )
            conn.commit()
            return {
                "applied": True,
                "first_distinct_completion": first_distinct_completion,
                "reward_granted": reward_granted,
                "credits_granted": credits_granted,
                "daily_rewards_remaining": max(
                    0, daily_reward_cap - daily_reward_count
                ),
                "creator_reward": {
                    "reward_granted": bool(creator_milestones_reached),
                    "credits_granted": creator_credits_granted,
                    "milestone_players": (
                        creator_milestones_reached[-1]["players"]
                        if creator_milestones_reached else None
                    ),
                    "milestones_reached": creator_milestones_reached,
                },
                "balance": balance,
                **metrics,
            }

        return self._execute_with_retry(_record)

    def reserve_free_world_art_reroll(
            self,
            generator_id: str,
            user_id: str,
    ) -> Optional[str]:
        """Reserve the one free visual reroll without allowing double clicks."""
        attempt_id = str(uuid.uuid4())

        def _reserve(conn):
            conn.execute("BEGIN IMMEDIATE")
            # A dead process must not consume the allowance forever. Image
            # generation has a much shorter timeout than this stale window.
            conn.execute("""
                UPDATE world_art_reroll_attempts
                SET status = 'failed', finished_at = CURRENT_TIMESTAMP
                WHERE generator_id = ? AND user_id = ?
                  AND status = 'reserved'
                  AND created_at < DATETIME('now', '-30 minutes')
            """, (generator_id, user_id))
            used_or_active = conn.execute("""
                SELECT 1
                FROM world_art_reroll_attempts
                WHERE generator_id = ? AND user_id = ?
                  AND status IN ('reserved', 'succeeded')
                LIMIT 1
            """, (generator_id, user_id)).fetchone()
            if used_or_active:
                conn.rollback()
                return None

            conn.execute("""
                INSERT INTO world_art_reroll_attempts (
                    id, generator_id, user_id, status
                ) VALUES (?, ?, ?, 'reserved')
            """, (attempt_id, generator_id, user_id))
            conn.commit()
            return attempt_id

        return self._execute_with_retry(_reserve)

    def finish_world_art_reroll(self, attempt_id: str, succeeded: bool) -> bool:
        def _finish(conn):
            cur = conn.execute("""
                UPDATE world_art_reroll_attempts
                SET status = ?, finished_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'reserved'
            """, ("succeeded" if succeeded else "failed", attempt_id))
            conn.commit()
            return cur.rowcount > 0

        return self._execute_with_retry(_finish)

    def get_free_world_art_rerolls_remaining(
            self,
            generator_id: str,
            user_id: str,
    ) -> int:
        def _remaining(conn):
            row = conn.execute("""
                SELECT 1
                FROM world_art_reroll_attempts
                WHERE generator_id = ? AND user_id = ?
                  AND status IN ('reserved', 'succeeded')
                LIMIT 1
            """, (generator_id, user_id)).fetchone()
            return 0 if row else 1

        return self._execute_with_retry(_remaining)

    def list_users_with_world_counts(self, limit: int = 100) -> List[Dict]:
        """Return registered users with admin-safe world count metadata."""
        limit = max(1, min(limit, 500))

        def _list(conn, limit):
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(users)")
            user_columns = {row[1] for row in cur.fetchall()}
            reset_required_select = (
                "COALESCE(u.password_reset_required, 0)"
                if "password_reset_required" in user_columns
                else "0"
            )
            reset_marked_at_select = (
                "u.password_reset_marked_at"
                if "password_reset_marked_at" in user_columns
                else "NULL"
            )
            created_at_select = "u.created_at" if "created_at" in user_columns else "NULL"

            cur.execute("PRAGMA table_info(generators)")
            generator_columns = {row[1] for row in cur.fetchall()}
            has_owner_id = "owner_id" in generator_columns

            if not has_owner_id:
                cur.execute(f"""
                    SELECT u.id, u.username, {created_at_select},
                           {reset_required_select}, {reset_marked_at_select}
                    FROM users u
                    ORDER BY LOWER(u.username) ASC
                    LIMIT ?
                """, (limit,))
                return [
                    {
                        "id": row[0],
                        "username": row[1],
                        "created_at": row[2],
                        "password_reset_required": bool(row[3]),
                        "password_reset_marked_at": row[4],
                        "stats": {
                            "total_worlds": 0,
                            "private_worlds": 0,
                            "unlisted_worlds": 0,
                            "public_worlds": 0,
                        },
                    }
                    for row in cur.fetchall()
                ]

            visibility_expr = (
                "COALESCE(g.visibility, 'unlisted')"
                if "visibility" in generator_columns
                else "'unlisted'"
            )
            cur.execute(f"""
                SELECT u.id, u.username, {created_at_select},
                       {reset_required_select}, {reset_marked_at_select},
                       COUNT(g.id) AS total_worlds,
                       SUM(CASE
                           WHEN g.id IS NOT NULL AND {visibility_expr} = 'private' THEN 1
                           ELSE 0
                       END) AS private_worlds,
                       SUM(CASE
                           WHEN g.id IS NOT NULL AND {visibility_expr} = 'unlisted' THEN 1
                           ELSE 0
                       END) AS unlisted_worlds,
                       SUM(CASE
                           WHEN g.id IS NOT NULL AND {visibility_expr} = 'public' THEN 1
                           ELSE 0
                       END) AS public_worlds
                FROM users u
                LEFT JOIN generators g ON g.owner_id = u.id
                GROUP BY u.id, u.username, {created_at_select},
                         {reset_required_select}, {reset_marked_at_select}
                ORDER BY LOWER(u.username) ASC
                LIMIT ?
            """, (limit,))

            return [
                {
                    "id": row[0],
                    "username": row[1],
                    "created_at": row[2],
                    "password_reset_required": bool(row[3]),
                    "password_reset_marked_at": row[4],
                    "stats": {
                        "total_worlds": int(row[5] or 0),
                        "private_worlds": int(row[6] or 0),
                        "unlisted_worlds": int(row[7] or 0),
                        "public_worlds": int(row[8] or 0),
                    },
                }
                for row in cur.fetchall()
            ]

        return self._execute_with_retry(_list, limit)

    def _json_list_size(self, raw_value: str) -> int:
        try:
            value = json.loads(raw_value or "[]")
            return len(value) if isinstance(value, list) else 0
        except json.JSONDecodeError:
            return 0

    def _json_mapping_size(self, raw_value: str) -> int:
        try:
            value = json.loads(raw_value or "{}")
            return len(value) if isinstance(value, (dict, list)) else 0
        except json.JSONDecodeError:
            return 0

    # User management helpers
    def _hash_password(self, password: str) -> str:
        salt = os.urandom(32)
        key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return salt.hex() + ':' + key.hex()

    def _verify_password(self, password: str, password_hash: str) -> bool:
        try:
            salt_hex, key_hex = password_hash.split(':')
            salt = bytes.fromhex(salt_hex)
            key = bytes.fromhex(key_hex)
            new_key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
            return hmac.compare_digest(new_key, key)
        except Exception:
            return False

    @staticmethod
    def _hash_mobile_auth_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_mobile_auth_session(
            self,
            user_id: str,
            access_ttl_seconds: int,
            refresh_ttl_seconds: int,
            platform: Optional[str] = None,
            device_name: Optional[str] = None,
            now: Optional[int] = None,
    ) -> Dict:
        if access_ttl_seconds <= 0 or refresh_ttl_seconds <= 0:
            raise ValueError("Mobile authentication TTLs must be positive")
        if access_ttl_seconds >= refresh_ttl_seconds:
            raise ValueError("Mobile refresh tokens must outlive access tokens")

        issued_at = int(time.time() if now is None else now)
        access_token = secrets.token_urlsafe(48)
        refresh_token = secrets.token_urlsafe(48)
        session_id = str(uuid.uuid4())
        access_expires_at = issued_at + access_ttl_seconds
        refresh_expires_at = issued_at + refresh_ttl_seconds

        def _create(conn):
            conn.execute("""
                INSERT INTO mobile_auth_sessions (
                    id, user_id, access_token_hash, refresh_token_hash,
                    access_expires_at, refresh_expires_at, platform, device_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                user_id,
                self._hash_mobile_auth_token(access_token),
                self._hash_mobile_auth_token(refresh_token),
                access_expires_at,
                refresh_expires_at,
                platform,
                device_name,
            ))
            conn.commit()

        self._execute_with_retry(_create)
        return {
            "session_id": session_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_expires_at": access_expires_at,
            "refresh_expires_at": refresh_expires_at,
        }

    def get_mobile_access_token_user_id(
            self,
            access_token: str,
            now: Optional[int] = None,
    ) -> Optional[str]:
        if not access_token:
            return None

        current_time = int(time.time() if now is None else now)
        token_hash = self._hash_mobile_auth_token(access_token)

        def _get(conn):
            row = conn.execute("""
                SELECT user_id
                FROM mobile_auth_sessions
                WHERE access_token_hash = ?
                  AND revoked_at IS NULL
                  AND access_expires_at > ?
                  AND refresh_expires_at > ?
            """, (token_hash, current_time, current_time)).fetchone()
            return row[0] if row else None

        return self._execute_with_retry(_get)

    def refresh_mobile_auth_session(
            self,
            refresh_token: str,
            access_ttl_seconds: int,
            refresh_ttl_seconds: int,
            now: Optional[int] = None,
    ) -> Optional[Dict]:
        if not refresh_token:
            return None
        if access_ttl_seconds <= 0 or refresh_ttl_seconds <= 0:
            raise ValueError("Mobile authentication TTLs must be positive")
        if access_ttl_seconds >= refresh_ttl_seconds:
            raise ValueError("Mobile refresh tokens must outlive access tokens")

        issued_at = int(time.time() if now is None else now)
        old_refresh_hash = self._hash_mobile_auth_token(refresh_token)
        next_access_token = secrets.token_urlsafe(48)
        next_refresh_token = secrets.token_urlsafe(48)
        access_expires_at = issued_at + access_ttl_seconds
        refresh_expires_at = issued_at + refresh_ttl_seconds

        def _refresh(conn):
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("""
                SELECT id, user_id
                FROM mobile_auth_sessions
                WHERE refresh_token_hash = ?
                  AND revoked_at IS NULL
                  AND refresh_expires_at > ?
            """, (old_refresh_hash, issued_at)).fetchone()
            if not row:
                conn.rollback()
                return None

            conn.execute("""
                UPDATE mobile_auth_sessions
                SET access_token_hash = ?, refresh_token_hash = ?,
                    access_expires_at = ?, refresh_expires_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                self._hash_mobile_auth_token(next_access_token),
                self._hash_mobile_auth_token(next_refresh_token),
                access_expires_at,
                refresh_expires_at,
                row[0],
            ))
            conn.commit()
            return {
                "session_id": row[0],
                "user_id": row[1],
                "access_token": next_access_token,
                "refresh_token": next_refresh_token,
                "access_expires_at": access_expires_at,
                "refresh_expires_at": refresh_expires_at,
            }

        return self._execute_with_retry(_refresh)

    def revoke_mobile_auth_session(self, access_token: str) -> bool:
        if not access_token:
            return False

        token_hash = self._hash_mobile_auth_token(access_token)

        def _revoke(conn):
            cursor = conn.execute("""
                UPDATE mobile_auth_sessions
                SET revoked_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE access_token_hash = ? AND revoked_at IS NULL
            """, (token_hash,))
            conn.commit()
            return cursor.rowcount > 0

        return self._execute_with_retry(_revoke)

    def create_user(self, username: str, password: str) -> Optional[Dict]:
        user_id = str(uuid.uuid4())
        password_hash = self._hash_password(password)

        def _create(conn):
            try:
                conn.execute(
                    "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
                    (user_id, username, password_hash)
                )
                conn.commit()
                return {"id": user_id, "username": username}
            except sqlite3.IntegrityError:
                return None

        return self._execute_with_retry(_create)

    def get_user_by_username(self, username: str) -> Optional[Dict]:
        def _get(conn):
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, password_hash,
                       COALESCE(password_reset_required, 0), password_reset_marked_at
                FROM users
                WHERE username = ?
            """, (username,))
            row = cur.fetchone()
            if row is None:
                return None
            return {
                "id": row[0],
                "username": row[1],
                "password_hash": row[2],
                "password_reset_required": bool(row[3]),
                "password_reset_marked_at": row[4],
            }

        return self._execute_with_retry(_get)

    def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        def _get(conn):
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, COALESCE(password_reset_required, 0), password_reset_marked_at
                FROM users
                WHERE id = ?
            """, (user_id,))
            row = cur.fetchone()
            if row is None:
                return None
            return {
                "id": row[0],
                "username": row[1],
                "password_reset_required": bool(row[2]),
                "password_reset_marked_at": row[3],
            }

        return self._execute_with_retry(_get)

    def set_user_password_reset_required(self, user_id: str, required: bool) -> bool:
        def _set(conn, user_id, required):
            reset_required = 1 if required else 0
            cur = conn.cursor()
            cur.execute("""
                UPDATE users
                SET password_reset_required = ?,
                    password_reset_marked_at = CASE
                        WHEN ? = 1 THEN CURRENT_TIMESTAMP
                        ELSE NULL
                    END
                WHERE id = ?
            """, (reset_required, reset_required, user_id))
            conn.commit()
            return cur.rowcount > 0

        return self._execute_with_retry(_set, user_id, required)

# Create a global instance with configurable upload frequency
# Can be overridden by setting UPLOAD_FREQUENCY_MINUTES environment variable
upload_freq = int(os.getenv('UPLOAD_FREQUENCY_MINUTES', '5'))
db = DatabaseManager(upload_frequency_minutes=upload_freq)

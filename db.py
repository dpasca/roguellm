import os
import json
import uuid
import sqlite3
import hashlib
import hmac
import time
import asyncio
from typing import Dict, List, Optional, Union
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
                SELECT language, map_csv, entity_placements, tile_info
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
            }

        return self._execute_with_retry(_get, generator_id, snapshot_version)

    def save_generator_world(
            self,
            generator_id: str,
            language: str,
            map_csv: str,
            entity_placements: List[Dict],
            tile_info_by_language: Dict[str, List[Dict]],
            snapshot_version: int = 1
    ) -> None:
        """Persist the playable snapshot so replays reuse it instead of regenerating."""
        def _save(conn, *args):
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO generator_worlds
                (generator_id, snapshot_version, language, map_csv, entity_placements, tile_info)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(generator_id) DO UPDATE SET
                    snapshot_version = excluded.snapshot_version,
                    language = excluded.language,
                    map_csv = excluded.map_csv,
                    entity_placements = excluded.entity_placements,
                    tile_info = excluded.tile_info,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                generator_id,
                snapshot_version,
                language,
                map_csv,
                json.dumps(entity_placements),
                json.dumps(tile_info_by_language)
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

            created_at_select = "created_at" if has_created_at else "NULL AS created_at"
            updated_at_select = "updated_at" if has_updated_at else "NULL AS updated_at"
            if has_updated_at and has_created_at:
                order_by = "COALESCE(updated_at, created_at) DESC"
            elif has_updated_at:
                order_by = "updated_at DESC"
            elif has_created_at:
                order_by = "created_at DESC"
            else:
                order_by = "rowid DESC"

            if owner_id is not None:
                if not has_owner_id:
                    return []
                where_clause = "owner_id = ?"
                params = (owner_id,)
            elif local_dev or not has_visibility:
                where_clause = "visibility != 'private'" if has_visibility else "1=1"
                params = ()
            else:
                where_clause = "visibility = 'public'"
                params = ()

            owner_id_select = "owner_id" if has_owner_id else "NULL AS owner_id"
            visibility_select = "visibility" if "visibility" in columns else "'unlisted' AS visibility"
            moderation_status_select = (
                "moderation_status"
                if has_moderation_status
                else "'not_requested' AS moderation_status"
            )
            moderation_reason_select = (
                "moderation_reason"
                if has_moderation_reason
                else "NULL AS moderation_reason"
            )
            moderation_model_select = (
                "moderation_model"
                if has_moderation_model
                else "NULL AS moderation_model"
            )
            moderation_confidence_select = (
                "moderation_confidence"
                if has_moderation_confidence
                else "NULL AS moderation_confidence"
            )
            moderation_categories_select = (
                "moderation_categories"
                if has_moderation_categories
                else "'[]' AS moderation_categories"
            )
            public_requested_at_select = (
                "public_requested_at"
                if has_public_requested_at
                else "NULL AS public_requested_at"
            )
            public_review_after_select = (
                "public_review_after"
                if has_public_review_after
                else "NULL AS public_review_after"
            )
            public_reviewed_at_select = (
                "public_reviewed_at"
                if has_public_reviewed_at
                else "NULL AS public_reviewed_at"
            )

            cur.execute(f"""
                SELECT id, theme_desc, theme_desc_better, language,
                       player_defs, item_defs, enemy_defs, celltype_defs,
                       {created_at_select}, {updated_at_select},
                       {owner_id_select}, {visibility_select},
                       {moderation_status_select}, {moderation_reason_select},
                       {moderation_model_select}, {moderation_confidence_select},
                       {moderation_categories_select}, {public_requested_at_select},
                       {public_review_after_select}, {public_reviewed_at_select}
                FROM generators
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
                })

            return worlds

        return self._execute_with_retry(_list, limit, local_dev, owner_id)

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

            return stats

        return self._execute_with_retry(_stats, owner_id)

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

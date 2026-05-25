import os
import json
import uuid
import sqlite3
import hashlib
import time
import asyncio
from typing import Dict, List, Optional, Union
from contextlib import contextmanager
import logging
import boto3
from threading import Lock, Thread
from datetime import datetime, timedelta

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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            conn.commit()

    def _ensure_column(self, conn, table_name: str, column_name: str, column_definition: str):
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({table_name})")
        columns = {row[1] for row in cur.fetchall()}
        if column_name not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")

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
            celltype_defs: List[Dict]
    ) -> str:
        """
        Save a generator and return its unique ID.
        Uses UPSERT pattern to handle concurrent inserts safely.
        """
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
                (id, theme_desc, theme_desc_better, language, player_defs, item_defs, enemy_defs, celltype_defs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                generator_id,
                theme_desc,
                theme_desc_better,
                language,
                json.dumps(player_defs),
                json.dumps(item_defs),
                json.dumps(enemy_defs),
                json.dumps(celltype_defs)
            ))
            conn.commit()
            return generator_id

        generator_id = self._execute_with_retry(_save)
        # Upload is now scheduled automatically by the connection wrapper
        return generator_id

    def get_generator(self, generator_id: str) -> Optional[Dict]:
        """
        Retrieve a generator by its ID.
        Returns None if not found.
        """
        def _get(conn, generator_id):
            cur = conn.cursor()
            cur.execute("""
                SELECT theme_desc, theme_desc_better, language, player_defs, item_defs, enemy_defs, celltype_defs
                FROM generators
                WHERE id = ?
            """, (generator_id,))

            result = cur.fetchone()
            if result is None:
                return None

            return {
                'theme_desc': result[0],
                'theme_desc_better': result[1],
                'language': result[2],
                'player_defs': json.loads(result[3]),
                'item_defs': json.loads(result[4]),
                'enemy_defs': json.loads(result[5]),
                'celltype_defs': json.loads(result[6])
            }

        return self._execute_with_retry(_get, generator_id)

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

    def list_worlds(self, limit: int = 20) -> List[Dict]:
        """
        Return recent reusable generated worlds.

        The database table is still named "generators" for compatibility, but
        each row is a reusable World that can start many play sessions.
        """
        limit = max(1, min(limit, 50))

        def _list(conn, limit):
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(generators)")
            columns = {row[1] for row in cur.fetchall()}
            has_created_at = "created_at" in columns

            created_at_select = "created_at" if has_created_at else "NULL AS created_at"
            order_by = "created_at DESC" if has_created_at else "rowid DESC"
            cur.execute(f"""
                SELECT id, theme_desc, theme_desc_better, language,
                       player_defs, item_defs, enemy_defs, celltype_defs,
                       {created_at_select}
                FROM generators
                ORDER BY {order_by}
                LIMIT ?
            """, (limit,))

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
                })

            return worlds

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
            return len(value) if isinstance(value, dict) else 0
        except json.JSONDecodeError:
            return 0

# Create a global instance with configurable upload frequency
# Can be overridden by setting UPLOAD_FREQUENCY_MINUTES environment variable
upload_freq = int(os.getenv('UPLOAD_FREQUENCY_MINUTES', '5'))
db = DatabaseManager(upload_frequency_minutes=upload_freq)

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
            conn.commit()

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

# Create a global instance with configurable upload frequency
# Can be overridden by setting UPLOAD_FREQUENCY_MINUTES environment variable
upload_freq = int(os.getenv('UPLOAD_FREQUENCY_MINUTES', '5'))
db = DatabaseManager(upload_frequency_minutes=upload_freq)

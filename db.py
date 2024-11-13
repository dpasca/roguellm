import os
import json
import uuid
import sqlite3
import hashlib
import time
from typing import Dict, List, Optional, Union
from contextlib import contextmanager

class DatabaseManager:
    def __init__(self):
        self.db_path = os.path.join("_data", "rllm_game_data.db")
        # Timeout in seconds for waiting to acquire a database lock
        self.timeout = 20.0
        # Maximum number of retries for operations
        self.max_retries = 3
        # Delay between retries in seconds
        self.retry_delay = 0.1

    @contextmanager
    def get_connection(self):
        """
        Context manager for database connections with proper timeout and retry logic.
        Automatically handles connection cleanup.
        """
        # Ensure _data directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        conn = None
        try:
            conn = sqlite3.connect(
                self.db_path,
                timeout=self.timeout,
                isolation_level='IMMEDIATE'  # This ensures better transaction handling
            )
            # Enable foreign keys
            conn.execute('PRAGMA foreign_keys = ON')
            yield conn
        except sqlite3.OperationalError as e:
            if conn:
                conn.rollback()
            raise e
        finally:
            if conn:
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

    def init_db(self):
        """Initialize the database schema."""
        def _init(conn):
            cur = conn.cursor()
            # Create generators table with index
            cur.execute("""
                CREATE TABLE IF NOT EXISTS generators (
                    id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    theme_desc TEXT NOT NULL,
                    theme_desc_better TEXT NOT NULL,
                    language TEXT DEFAULT 'en',
                    player_defs TEXT NOT NULL,
                    item_defs TEXT NOT NULL,
                    enemy_defs TEXT NOT NULL,
                    celltype_defs TEXT NOT NULL
                )
            """)
            # Add index for faster lookups
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_generators_created_at 
                ON generators(created_at)
            """)
            conn.commit()

        self._execute_with_retry(_init)

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

        return self._execute_with_retry(_save)

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

# Create a global instance
db = DatabaseManager()

import os
import json
import uuid
import sqlite3
from typing import Dict, List, Optional, Union

class DatabaseManager:
    def __init__(self):
        self.db_path = "roguellm.db"

    def get_connection(self):
        return sqlite3.connect(self.db_path)

    def init_db(self):
        """Initialize the database schema."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            # Create generators table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS generators (
                    id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    theme_desc TEXT NOT NULL,
                    language TEXT DEFAULT 'en',
                    player_defs TEXT NOT NULL,
                    item_defs TEXT NOT NULL,
                    enemy_defs TEXT NOT NULL,
                    celltype_defs TEXT NOT NULL
                )
            """)
            conn.commit()

    def save_generator(self,
                      theme_desc: str,
                      language: str,
                      player_defs: List[Dict],
                      item_defs: List[Dict],
                      enemy_defs: List[Dict],
                      celltype_defs: List[Dict]) -> str:
        """
        Save a generator and return its unique ID.
        """
        generator_id = str(uuid.uuid4())[:8]  # Use first 8 chars for shorter IDs

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO generators
                (id, theme_desc, language, player_defs, item_defs, enemy_defs, celltype_defs)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                generator_id,
                theme_desc,
                language,
                json.dumps(player_defs),
                json.dumps(item_defs),
                json.dumps(enemy_defs),
                json.dumps(celltype_defs)
            ))
            conn.commit()

        return generator_id

    def get_generator(self, generator_id: str) -> Optional[Dict]:
        """
        Retrieve a generator by its ID.
        Returns None if not found.
        """
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT theme_desc, language, player_defs, item_defs, enemy_defs, celltype_defs
                FROM generators
                WHERE id = ?
            """, (generator_id,))

            result = cur.fetchone()

            if result is None:
                return None

            return {
                'theme_desc': result[0],
                'language': result[1],
                'player_defs': json.loads(result[2]),
                'item_defs': json.loads(result[3]),
                'enemy_defs': json.loads(result[4]),
                'celltype_defs': json.loads(result[5])
            }

# Create a global instance
db = DatabaseManager()

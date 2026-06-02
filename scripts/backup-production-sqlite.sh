#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.production.yml}"
SERVICE_NAME="${SERVICE_NAME:-app}"
DB_PATH="${DB_PATH:-/app/_data/rllm_game_data.db}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DIR/backups/production}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="${TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKUP_BASENAME="${BACKUP_BASENAME:-roguellm-production-$TIMESTAMP}"
CONTAINER_TMP="/tmp/$BACKUP_BASENAME.sqlite"
RAW_BACKUP="$BACKUP_ROOT/$BACKUP_BASENAME.sqlite"
ARCHIVE="$RAW_BACKUP.gz"
METADATA="$BACKUP_ROOT/$BACKUP_BASENAME.json"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE_NAME")"
if [ -z "$container_id" ]; then
  echo "No running container found for service: $SERVICE_NAME" >&2
  exit 1
fi

cleanup_container_tmp() {
  docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
}
trap cleanup_container_tmp EXIT

docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" python - "$DB_PATH" "$CONTAINER_TMP" <<'PY'
import json
import os
import sqlite3
import sys
import time

source_path, destination_path = sys.argv[1:3]
if not os.path.exists(source_path):
    raise SystemExit(f"Database not found: {source_path}")

if os.path.exists(destination_path):
    os.remove(destination_path)

started_at = time.time()
source = sqlite3.connect(source_path)
try:
    destination = sqlite3.connect(destination_path)
    try:
        source.backup(destination)
        integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"Backup integrity check failed: {integrity}")
        table_count = destination.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"
        ).fetchone()[0]
    finally:
        destination.close()
finally:
    source.close()

print(json.dumps({
    "source": source_path,
    "destination": destination_path,
    "elapsed_seconds": round(time.time() - started_at, 3),
    "size_bytes": os.path.getsize(destination_path),
    "integrity": integrity,
    "table_count": table_count,
}))
PY

docker cp "$container_id:$CONTAINER_TMP" "$RAW_BACKUP"
gzip -9 "$RAW_BACKUP"
chmod 600 "$ARCHIVE"

python3 - "$ARCHIVE" <<'PY'
import gzip
import os
import shutil
import sqlite3
import sys
import tempfile

archive_path = sys.argv[1]
tmp_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
try:
    with gzip.open(archive_path, "rb") as source:
        shutil.copyfileobj(source, tmp_file)
    tmp_file.close()

    connection = sqlite3.connect(tmp_file.name)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"Archived backup integrity check failed: {integrity}")
    finally:
        connection.close()
finally:
    if not tmp_file.closed:
        tmp_file.close()
    os.remove(tmp_file.name)
PY

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256"
fi

cat > "$METADATA" <<EOF
{
  "created_at_utc": "$TIMESTAMP",
  "archive": "$(basename "$ARCHIVE")",
  "database_path": "$DB_PATH",
  "compose_file": "$COMPOSE_FILE",
  "service": "$SERVICE_NAME",
  "container_id": "$container_id",
  "retention_days": $RETENTION_DAYS,
  "size_bytes": $(wc -c < "$ARCHIVE")
}
EOF
chmod 600 "$METADATA"

find "$BACKUP_ROOT" -type f \( \
  -name 'roguellm-production-*.sqlite.gz' -o \
  -name 'roguellm-production-*.sqlite.gz.sha256' -o \
  -name 'roguellm-production-*.json' \
\) -mtime +"$RETENTION_DAYS" -delete

echo "Backup created: $ARCHIVE"

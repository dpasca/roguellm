#!/usr/bin/env bash

# Create a self-contained RogueLLM snapshot from the running Compose service.
# The database is copied with SQLite's online backup API before immutable World
# assets are archived, so every asset referenced by the database is included.

set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.production.yml}"
SERVICE_NAME="${SERVICE_NAME:-app}"
DB_PATH="${DB_PATH:-/app/_data/rllm_game_data.db}"
ASSETS_PATH="${ASSETS_PATH:-/app/_data/assets}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DIR/backups/production}"
BACKUP_PREFIX="${BACKUP_PREFIX:-roguellm-production}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_FREE_GIB="${MIN_FREE_GIB:-5}"
BACKUP_HEALTHCHECK_URL="${BACKUP_HEALTHCHECK_URL:-}"
TIMESTAMP="${TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"

SNAPSHOTS_DIR="$BACKUP_ROOT/snapshots"
LOCK_FILE="$BACKUP_ROOT/backup.lock"
WORK_DIR="$SNAPSHOTS_DIR/.incomplete-$TIMESTAMP-$$"
FINAL_DIR="$SNAPSHOTS_DIR/$TIMESTAMP"
CONTAINER_TMP="/tmp/$BACKUP_PREFIX-$TIMESTAMP-$$.sqlite"
BACKUP_COMPLETED=false

log() {
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
    log "ERROR: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

validate_nonnegative_integer() {
    local name="$1"
    local value="$2"

    case "$value" in
        ''|*[!0-9]*) fail "$name must be a non-negative integer" ;;
    esac
}

notify_healthcheck() {
    local suffix="${1:-}"

    if [[ -z "$BACKUP_HEALTHCHECK_URL" ]]; then
        return 0
    fi

    curl --fail --silent --show-error --max-time 10 \
        "${BACKUP_HEALTHCHECK_URL}${suffix}" >/dev/null || \
        log "WARNING: Could not notify the backup healthcheck endpoint"
}

write_failure_status() {
    local exit_code="$1"
    local temporary_status="$BACKUP_ROOT/.last-failure.$$"

    {
        printf 'FAILED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'EXIT_CODE=%s\n' "$exit_code"
        printf 'HOSTNAME=%s\n' "$(hostname)"
    } > "$temporary_status"
    mv -f "$temporary_status" "$BACKUP_ROOT/last-failure.env"
}

cleanup() {
    local exit_code=$?

    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
        rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true

    if [[ -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi

    if [[ "$BACKUP_COMPLETED" != true && "$exit_code" -ne 0 ]]; then
        write_failure_status "$exit_code"
        notify_healthcheck "/fail"
        log "Backup failed with exit code $exit_code"
    fi
}

prune_expired_backups() {
    local snapshot

    while IFS= read -r -d '' snapshot; do
        case "$snapshot" in
            "$SNAPSHOTS_DIR"/20??????T??????Z)
                log "Pruning expired snapshot: $(basename "$snapshot")"
                rm -rf -- "$snapshot"
                ;;
            *) fail "Refusing to prune unexpected path: $snapshot" ;;
        esac
    done < <(
        find "$SNAPSHOTS_DIR" \
            -mindepth 1 \
            -maxdepth 1 \
            -type d \
            -name '20??????T??????Z' \
            -mtime +"$RETENTION_DAYS" \
            -print0
    )

    # Remove database-only artifacts created by the predecessor script after
    # they age out. They remain valid database restores until then.
    find "$BACKUP_ROOT" -maxdepth 1 -type f \( \
        -name 'roguellm-production-*.sqlite.gz' -o \
        -name 'roguellm-production-*.sqlite.gz.sha256' -o \
        -name 'roguellm-production-*.json' \
    \) -mtime +"$RETENTION_DAYS" -delete
}

require_command df
require_command docker
require_command flock
require_command gzip
require_command python3
require_command sha256sum
if [[ -n "$BACKUP_HEALTHCHECK_URL" ]]; then
    require_command curl
fi

validate_nonnegative_integer "RETENTION_DAYS" "$RETENTION_DAYS"
validate_nonnegative_integer "MIN_FREE_GIB" "$MIN_FREE_GIB"

case "$BACKUP_PREFIX" in
    ''|*[!A-Za-z0-9._-]*) fail "BACKUP_PREFIX contains unsupported characters" ;;
esac

case "$TIMESTAMP" in
    20??????T??????Z) ;;
    *) fail "TIMESTAMP must use UTC basic format: YYYYMMDDTHHMMSSZ" ;;
esac

[[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"

mkdir -p "$SNAPSHOTS_DIR"
chmod 700 "$BACKUP_ROOT" "$SNAPSHOTS_DIR"

trap cleanup EXIT

exec 9> "$LOCK_FILE"
if ! flock -n 9; then
    fail "Another RogueLLM backup is already running"
fi

[[ ! -e "$FINAL_DIR" ]] || fail "Snapshot already exists: $FINAL_DIR"

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE_NAME")"
[[ -n "$container_id" ]] || fail "No running container found for service: $SERVICE_NAME"

read -r database_source_bytes asset_file_count asset_source_bytes < <(
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
        python - "$DB_PATH" "$ASSETS_PATH" <<'PY'
import os
import sys

database_path, assets_path = sys.argv[1:3]
if not os.path.isfile(database_path):
    raise SystemExit(f"Database not found: {database_path}")

asset_file_count = 0
asset_source_bytes = 0
if os.path.exists(assets_path):
    if not os.path.isdir(assets_path):
        raise SystemExit(f"Assets path is not a directory: {assets_path}")
    for current_dir, _, filenames in os.walk(assets_path):
        for filename in filenames:
            file_path = os.path.join(current_dir, filename)
            try:
                asset_source_bytes += os.path.getsize(file_path)
                asset_file_count += 1
            except FileNotFoundError:
                pass

print(os.path.getsize(database_path), asset_file_count, asset_source_bytes)
PY
)

available_bytes="$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
minimum_free_bytes=$(( MIN_FREE_GIB * 1024 * 1024 * 1024 ))
estimated_snapshot_bytes=$(( database_source_bytes + asset_source_bytes ))
if (( available_bytes - estimated_snapshot_bytes < minimum_free_bytes )); then
    fail "Insufficient free disk space to create a safe snapshot"
fi

notify_healthcheck "/start"
log "Starting snapshot $TIMESTAMP"
log "Source contains $asset_file_count generated asset files ($asset_source_bytes bytes)"
mkdir "$WORK_DIR"

database_backup_result="$({
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
        python - "$DB_PATH" "$CONTAINER_TMP" <<'PY'
import json
import os
import sqlite3
import sys
import time

source_path, destination_path = sys.argv[1:3]
if not os.path.isfile(source_path):
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
    "elapsed_seconds": round(time.time() - started_at, 3),
    "integrity": integrity,
    "size_bytes": os.path.getsize(destination_path),
    "table_count": table_count,
}))
PY
} | tr -d '\r')"

docker cp "$container_id:$CONTAINER_TMP" "$WORK_DIR/database.sqlite"
gzip -9 "$WORK_DIR/database.sqlite"
chmod 600 "$WORK_DIR/database.sqlite.gz"

log "Archiving generated World assets"
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
    python - "$ASSETS_PATH" > "$WORK_DIR/assets.tar.gz" <<'PY'
import os
import sys
import tarfile
import time

assets_path = sys.argv[1]
with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as archive:
    if os.path.exists(assets_path):
        if not os.path.isdir(assets_path):
            raise SystemExit(f"Assets path is not a directory: {assets_path}")
        archive.add(assets_path, arcname="assets", recursive=True)
    else:
        directory = tarfile.TarInfo("assets")
        directory.type = tarfile.DIRTYPE
        directory.mode = 0o755
        directory.mtime = int(time.time())
        archive.addfile(directory)
PY

[[ -s "$WORK_DIR/database.sqlite.gz" ]] || fail "Database archive is empty"
[[ -s "$WORK_DIR/assets.tar.gz" ]] || fail "Asset archive is empty"

python3 - "$WORK_DIR/database.sqlite.gz" "$WORK_DIR/assets.tar.gz" <<'PY'
import gzip
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile

database_archive, asset_archive = sys.argv[1:3]
temporary = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
try:
    with gzip.open(database_archive, "rb") as source:
        shutil.copyfileobj(source, temporary)
    temporary.close()
    connection = sqlite3.connect(temporary.name)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"Archived backup integrity check failed: {integrity}")
    finally:
        connection.close()
finally:
    if not temporary.closed:
        temporary.close()
    os.remove(temporary.name)

with tarfile.open(asset_archive, "r:gz") as archive:
    members = archive.getmembers()
    if not members or members[0].name.rstrip("/") != "assets":
        raise SystemExit("Asset archive does not start with the assets directory")
    for member in members:
        normalized = os.path.normpath(member.name)
        if normalized != "assets" and not normalized.startswith("assets/"):
            raise SystemExit(f"Unexpected asset archive path: {member.name}")
        if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise SystemExit(f"Unsupported asset archive entry: {member.name}")
PY

database_archive_bytes="$(stat -c '%s' "$WORK_DIR/database.sqlite.gz")"
asset_archive_bytes="$(stat -c '%s' "$WORK_DIR/assets.tar.gz")"

python3 - \
    "$WORK_DIR/metadata.json" \
    "$TIMESTAMP" \
    "$container_id" \
    "$COMPOSE_FILE" \
    "$SERVICE_NAME" \
    "$DB_PATH" \
    "$ASSETS_PATH" \
    "$database_source_bytes" \
    "$database_archive_bytes" \
    "$asset_file_count" \
    "$asset_source_bytes" \
    "$asset_archive_bytes" \
    "$RETENTION_DAYS" \
    "$database_backup_result" <<'PY'
import json
import sys

(
    metadata_path,
    timestamp,
    container_id,
    compose_file,
    service,
    database_path,
    assets_path,
    database_source_bytes,
    database_archive_bytes,
    asset_file_count,
    asset_source_bytes,
    asset_archive_bytes,
    retention_days,
    database_backup_result,
) = sys.argv[1:]

metadata = {
    "format_version": 2,
    "created_at_utc": timestamp,
    "container_id": container_id,
    "compose_file": compose_file,
    "service": service,
    "database_path": database_path,
    "assets_path": assets_path,
    "database_source_bytes": int(database_source_bytes),
    "database_archive_bytes": int(database_archive_bytes),
    "asset_file_count": int(asset_file_count),
    "asset_source_bytes": int(asset_source_bytes),
    "asset_archive_bytes": int(asset_archive_bytes),
    "retention_days": int(retention_days),
    "database_backup": json.loads(database_backup_result),
}
with open(metadata_path, "w", encoding="utf-8") as output:
    json.dump(metadata, output, indent=2, sort_keys=True)
    output.write("\n")
PY
chmod 600 "$WORK_DIR/metadata.json"

(
    cd "$WORK_DIR"
    sha256sum database.sqlite.gz assets.tar.gz metadata.json > SHA256SUMS
    sha256sum --check SHA256SUMS >/dev/null
)

touch "$WORK_DIR/COMPLETED"
mv "$WORK_DIR" "$FINAL_DIR"

temporary_latest="$BACKUP_ROOT/.latest.$$"
ln -s "snapshots/$TIMESTAMP" "$temporary_latest"
mv -Tf "$temporary_latest" "$BACKUP_ROOT/latest"

temporary_status="$BACKUP_ROOT/.last-success.$$"
{
    printf 'COMPLETED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'SNAPSHOT=%s\n' "$TIMESTAMP"
    printf 'DATABASE_ARCHIVE_BYTES=%s\n' "$database_archive_bytes"
    printf 'ASSET_ARCHIVE_BYTES=%s\n' "$asset_archive_bytes"
    printf 'ASSET_FILE_COUNT=%s\n' "$asset_file_count"
} > "$temporary_status"
mv -f "$temporary_status" "$BACKUP_ROOT/last-success.env"
rm -f "$BACKUP_ROOT/last-failure.env"

prune_expired_backups

BACKUP_COMPLETED=true
notify_healthcheck ""
log "Backup completed: $FINAL_DIR"
log "Database archive: $database_archive_bytes bytes; asset archive: $asset_archive_bytes bytes"

#!/usr/bin/env bash

# Verify that the latest complete snapshot is recent and internally readable.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DIR/backups/production}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-30}"
MIN_FREE_GIB="${MIN_FREE_GIB:-5}"

fail() {
    printf 'BACKUP_UNHEALTHY: %s\n' "$*" >&2
    exit 1
}

case "$MAX_AGE_HOURS" in
    ''|*[!0-9]*) fail "MAX_AGE_HOURS must be a positive integer" ;;
esac
case "$MIN_FREE_GIB" in
    ''|*[!0-9]*) fail "MIN_FREE_GIB must be a non-negative integer" ;;
esac
(( MAX_AGE_HOURS > 0 )) || fail "MAX_AGE_HOURS must be greater than zero"

[[ -L "$BACKUP_ROOT/latest" ]] || fail "Latest snapshot link is missing"
snapshot_dir="$(readlink -f "$BACKUP_ROOT/latest")"
case "$snapshot_dir" in
    "$BACKUP_ROOT"/snapshots/20??????T??????Z) ;;
    *) fail "Latest snapshot link points outside the expected directory" ;;
esac

[[ -d "$snapshot_dir" ]] || fail "Latest snapshot directory is missing"
[[ -f "$snapshot_dir/COMPLETED" ]] || fail "Latest snapshot is not marked complete"
for required_file in database.sqlite.gz assets.tar.gz metadata.json SHA256SUMS; do
    [[ -s "$snapshot_dir/$required_file" ]] || fail "$required_file is missing or empty"
done

snapshot_epoch="$(stat -c '%Y' "$snapshot_dir/COMPLETED")"
current_epoch="$(date +%s)"
age_seconds=$(( current_epoch - snapshot_epoch ))
max_age_seconds=$(( MAX_AGE_HOURS * 60 * 60 ))
(( age_seconds >= 0 )) || fail "Latest snapshot timestamp is in the future"
(( age_seconds <= max_age_seconds )) || \
    fail "Latest snapshot is older than $MAX_AGE_HOURS hours"

(
    cd "$snapshot_dir"
    sha256sum --check SHA256SUMS >/dev/null
) || fail "Snapshot checksum verification failed"

python3 - "$snapshot_dir/database.sqlite.gz" "$snapshot_dir/assets.tar.gz" <<'PY' || \
    fail "Snapshot archive validation failed"
import gzip
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile

database_archive, assets_archive = sys.argv[1:3]
temporary = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
try:
    with gzip.open(database_archive, "rb") as source:
        shutil.copyfileobj(source, temporary)
    temporary.close()
    connection = sqlite3.connect(temporary.name)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"Database integrity check failed: {integrity}")
    finally:
        connection.close()
finally:
    if not temporary.closed:
        temporary.close()
    os.remove(temporary.name)

with tarfile.open(assets_archive, "r:gz") as archive:
    members = archive.getmembers()
    if not members or members[0].name.rstrip("/") != "assets":
        raise SystemExit("Asset archive is missing its root directory")
    for member in members:
        normalized = os.path.normpath(member.name)
        if normalized != "assets" and not normalized.startswith("assets/"):
            raise SystemExit(f"Unexpected archive path: {member.name}")
        if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise SystemExit(f"Unsupported archive entry: {member.name}")
PY

available_bytes="$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
minimum_free_bytes=$(( MIN_FREE_GIB * 1024 * 1024 * 1024 ))
(( available_bytes >= minimum_free_bytes )) || \
    fail "Backup filesystem has less than $MIN_FREE_GIB GiB free"

age_minutes=$(( age_seconds / 60 ))
printf 'BACKUP_HEALTHY snapshot=%s age_minutes=%s database_bytes=%s asset_bytes=%s\n' \
    "$(basename "$snapshot_dir")" \
    "$age_minutes" \
    "$(stat -c '%s' "$snapshot_dir/database.sqlite.gz")" \
    "$(stat -c '%s' "$snapshot_dir/assets.tar.gz")"

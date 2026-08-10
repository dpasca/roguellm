#!/usr/bin/env bash

# Restore a complete snapshot into disposable local files. When
# RESTORE_SMOKE_IMAGE is set, also boot that image with networking disabled and
# probe the app and restored assets. The live staging/production volume is never
# mounted or modified.

set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DIR/backups/production}"
SNAPSHOT_PATH="${1:-$BACKUP_ROOT/latest}"
VERIFY_SCRIPT="${VERIFY_SCRIPT:-$SCRIPT_DIR/verify_restored_data.py}"
RESTORE_SMOKE_IMAGE="${RESTORE_SMOKE_IMAGE:-}"
RESTORE_ENV_FILE="${RESTORE_ENV_FILE:-}"
RESTORE_DIR=""
SMOKE_CONTAINER=""

log() {
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
    log "ERROR: $*" >&2
    exit 1
}

cleanup() {
    if [[ -n "$SMOKE_CONTAINER" ]]; then
        docker rm --force "$SMOKE_CONTAINER" >/dev/null 2>&1 || true
    fi
    if [[ -n "$RESTORE_DIR" && -d "$RESTORE_DIR" ]]; then
        case "$RESTORE_DIR" in
            "$BACKUP_ROOT"/.restore-test.*) rm -rf -- "$RESTORE_DIR" ;;
            *) log "WARNING: Refusing to clean unexpected restore path: $RESTORE_DIR" ;;
        esac
    fi
}

trap cleanup EXIT

[[ -f "$VERIFY_SCRIPT" ]] || fail "Restore verifier not found: $VERIFY_SCRIPT"

snapshot_dir="$(readlink -f "$SNAPSHOT_PATH")"
case "$snapshot_dir" in
    "$BACKUP_ROOT"/snapshots/20??????T??????Z) ;;
    *) fail "Snapshot path is outside the expected backup directory" ;;
esac

[[ -f "$snapshot_dir/COMPLETED" ]] || fail "Snapshot is not marked complete"
for required_file in database.sqlite.gz assets.tar.gz metadata.json SHA256SUMS; do
    [[ -s "$snapshot_dir/$required_file" ]] || fail "$required_file is missing or empty"
done

(
    cd "$snapshot_dir"
    sha256sum --check SHA256SUMS >/dev/null
) || fail "Snapshot checksum verification failed"

RESTORE_DIR="$(mktemp -d "$BACKUP_ROOT/.restore-test.XXXXXX")"
mkdir "$RESTORE_DIR/_data"

log "Restoring the database and generated assets into disposable files"
gzip -dc "$snapshot_dir/database.sqlite.gz" > "$RESTORE_DIR/_data/rllm_game_data.db"

python3 - "$snapshot_dir/assets.tar.gz" "$RESTORE_DIR/_data" <<'PY'
import os
import shutil
import sys
import tarfile
from pathlib import Path

archive_path, destination_text = sys.argv[1:3]
destination = Path(destination_text).resolve()

with tarfile.open(archive_path, "r:gz") as archive:
    members = archive.getmembers()
    if not members or members[0].name.rstrip("/") != "assets":
        raise SystemExit("Asset archive is missing its root directory")

    for member in members:
        normalized = os.path.normpath(member.name)
        if normalized != "assets" and not normalized.startswith("assets/"):
            raise SystemExit(f"Unexpected asset archive path: {member.name}")
        if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise SystemExit(f"Unsupported asset archive entry: {member.name}")

        target = (destination / normalized).resolve()
        if os.path.commonpath((destination, target)) != str(destination):
            raise SystemExit(f"Asset archive entry escapes restore directory: {member.name}")
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit(f"Could not read asset archive entry: {member.name}")
        with source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
PY

verification_output="$(python3 "$VERIFY_SCRIPT" "$RESTORE_DIR/_data")"
log "$verification_output"

if [[ -n "$RESTORE_SMOKE_IMAGE" ]]; then
    command -v docker >/dev/null 2>&1 || fail "Docker is required for the app smoke test"
    docker image inspect "$RESTORE_SMOKE_IMAGE" >/dev/null 2>&1 || \
        fail "Restore smoke image is unavailable: $RESTORE_SMOKE_IMAGE"
    [[ -n "$RESTORE_ENV_FILE" ]] || fail "RESTORE_ENV_FILE is required with RESTORE_SMOKE_IMAGE"
    [[ -f "$RESTORE_ENV_FILE" ]] || fail "Restore environment file not found: $RESTORE_ENV_FILE"

    SMOKE_CONTAINER="roguellm-restore-test-$$"
    log "Booting a network-isolated app against the disposable restore"
    docker run --detach --rm \
        --name "$SMOKE_CONTAINER" \
        --network none \
        --user 0 \
        --env-file "$RESTORE_ENV_FILE" \
        --env APP_ENV=production \
        --env ENABLE_WORLD_ART=0 \
        --env DO_STORAGE_SERVER= \
        --env DO_SPACES_ACCESS_KEY= \
        --env DO_SPACES_SECRET_KEY= \
        --env DO_STORAGE_CONTAINER= \
        --volume "$RESTORE_DIR/_data:/app/_data" \
        "$RESTORE_SMOKE_IMAGE" >/dev/null

    app_ready=false
    for _ in $(seq 1 60); do
        if docker exec --interactive "$SMOKE_CONTAINER" python - <<'PY' >/dev/null 2>&1
import urllib.request

for path in ("/health", "/health/db"):
    with urllib.request.urlopen(f"http://127.0.0.1:8000{path}", timeout=2) as response:
        if response.status != 200:
            raise SystemExit(f"Unexpected status for {path}: {response.status}")
PY
        then
            app_ready=true
            break
        fi
        sleep 1
    done
    [[ "$app_ready" == true ]] || fail "Restored app did not become healthy"

    first_asset="$(python3 - "$RESTORE_DIR/_data/assets" <<'PY'
import os
import sys
from pathlib import Path

assets_dir = Path(sys.argv[1])
for path in sorted(assets_dir.rglob("*")):
    if path.is_file():
        print(path.relative_to(assets_dir).as_posix())
        break
PY
)"
    if [[ -n "$first_asset" ]]; then
        docker exec --interactive "$SMOKE_CONTAINER" python - "$first_asset" <<'PY'
import sys
import urllib.parse
import urllib.request

asset_path = "/".join(urllib.parse.quote(part) for part in sys.argv[1].split("/"))
with urllib.request.urlopen(
    f"http://127.0.0.1:8000/assets/worlds/{asset_path}", timeout=5
) as response:
    if response.status != 200:
        raise SystemExit(f"Unexpected asset status: {response.status}")
    if not response.headers.get_content_type().startswith("image/"):
        raise SystemExit(f"Unexpected asset content type: {response.headers.get_content_type()}")
    if not response.read(1):
        raise SystemExit("Restored asset response is empty")
PY
    fi
    log "Disposable app passed health, database, and asset-serving probes"
fi

log "RESTORE_TEST_PASSED snapshot=$(basename "$snapshot_dir")"

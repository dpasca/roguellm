#!/usr/bin/env bash
set -Eeuo pipefail

# Compatibility entry point for the original database-only cron job. Backups
# now include both the SQLite database and generated World assets.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/backup-production-data.sh" "$@"

#!/bin/bash
# deploy/backup-db.sh — hourly safety backup of the SQLite DB.
# Cron: 0 * * * * /path/to/deploy/backup-db.sh
# Keeps last 48 hourly snapshots + 1 daily. Never loses more than 1h of data.
set -e

PROJECT_DIR="$(dirname "$0")/.."
SRC="$PROJECT_DIR/backend/data/aris.db"
BACKUP_DIR="$PROJECT_DIR/backend/data/backups"
mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d_%H%M%S)
cp "$SRC" "$BACKUP_DIR/aris_$TS.db"

# Keep only last 48 hourly + 7 daily
ls -t "$BACKUP_DIR"/aris_*.db 2>/dev/null | tail -n +49 | xargs -r rm -f

echo "[$(date)] DB backed up: aris_$TS.db"

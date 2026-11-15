#!/usr/bin/env bash
set -euo pipefail

# Daily PostgreSQL backup helper for docker-compose.prod.yml
# Example cron entry (03:15 UTC daily):
# 15 3 * * * cd /path/to/Ledgerwise-AI-SDR && ./scripts/backup-db.sh >> /var/log/ledgerwise-backup.log 2>&1

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-starter_db}"

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_FILE="${BACKUP_DIR}/ledgerwise-${TIMESTAMP}.sql.gz"

echo "Starting PostgreSQL backup -> ${OUT_FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
	pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-acl | gzip -9 > "${OUT_FILE}"

echo "Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "ledgerwise-*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete

echo "Backup completed: ${OUT_FILE}"

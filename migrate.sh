#!/usr/bin/env bash
# migrate.sh — run as the `migrate` service.
# Applies both alembic chains in FK-safe order and exits.
# web and loader depend on this completing successfully before they start.
set -euo pipefail

# In production the DB lives in a separate compose project (infra), so we cannot
# rely on depends_on: service_healthy across project boundaries. Wait here instead.
DB_HOST=${DB_HOST:-db}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-agritwin}
echo "[migrate] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q; do
  sleep 2
done
echo "[migrate] PostgreSQL is ready."

echo "[migrate] Running ETL alembic migrations..."
(cd /agritwin-etl && alembic upgrade head)

echo "[migrate] Running app alembic migrations..."
alembic -c /app/alembic.ini upgrade head

echo "[migrate] Schema is up to date."

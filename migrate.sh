#!/usr/bin/env bash
# migrate.sh — run as the `migrate` service.
# Applies both alembic chains in FK-safe order and exits.
# web and loader depend on this completing successfully before they start.
set -euo pipefail

echo "[migrate] Running ETL alembic migrations..."
(cd /agritwin-etl && alembic upgrade head)

echo "[migrate] Running app alembic migrations..."
alembic -c /app/alembic.ini upgrade head

echo "[migrate] Schema is up to date."

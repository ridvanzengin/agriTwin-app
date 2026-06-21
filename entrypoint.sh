#!/usr/bin/env bash
# entrypoint.sh — run inside the Flask app container.
#
# Sequence:
#   1. Install agritwin-etl from the mounted volume (no heavy geo deps needed)
#   2. Wait for PostgreSQL to accept connections
#   3. Run ETL alembic (creates PostGIS, TimescaleDB, all data-lake tables)
#   4. Run app alembic (app-owned tables; no-op in Phase 2)
#   5. Start Flask in the background — app is live immediately
#   6. Load tables smallest-first so the map becomes useful quickly
#      — idempotency guard skips any table that already has rows (safe on restart)
#      — observation (29.5 M rows) loads last via COPY FROM STDIN
#   7. Wait keeps the container running after all data is loaded
set -euo pipefail

ETL_DIR=/agritwin-etl

if [ ! -d "$ETL_DIR" ]; then
    echo "[setup] ERROR: /agritwin-etl not found — this image must be built via docker compose." >&2
    exit 1
fi

# ── 1. Wait for PostgreSQL ────────────────────────────────────────────────────

echo "[setup] Waiting for PostgreSQL..."
python3 - <<'PYEOF'
import os, time, sys
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
for attempt in range(30):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("[setup] PostgreSQL is ready.")
        sys.exit(0)
    except Exception as exc:
        print(f"[setup] DB not ready (attempt {attempt + 1}/30): {exc}")
        time.sleep(2)

print("[setup] ERROR: PostgreSQL did not become ready in time.", file=sys.stderr)
sys.exit(1)
PYEOF

# ── 2. ETL schema ─────────────────────────────────────────────────────────────
# The initial migration creates the postgis / timescaledb extensions and all
# ETL-owned tables.  Running from $ETL_DIR so alembic.ini script_location
# (relative path) resolves correctly.

echo "[setup] Running ETL alembic migrations..."
(cd "$ETL_DIR" && alembic upgrade head)

# ── 3. App schema ─────────────────────────────────────────────────────────────

echo "[setup] Running app alembic migrations..."
alembic upgrade head

# ── 4. Start Flask ────────────────────────────────────────────────────────────
# Bind to 0.0.0.0 so the container port is reachable from the host.
# Flask starts in the background; the app is immediately accessible even though
# no data is loaded yet (API returns empty GeoJSON until tables are populated).

echo "[setup] Starting Flask..."
flask --app agritwin_app run --host 0.0.0.0 &
FLASK_PID=$!
echo "[setup] Flask running (PID $FLASK_PID)"

# ── 5. Load data (smallest → largest) ────────────────────────────────────────
# Running from $ETL_DIR so agritwin_etl.config.settings.processed_data_dir
# (default "./data/processed") resolves to /agritwin-etl/data/processed.

# Returns the current row count for a table; outputs 0 on any error.
_row_count() {
    python3 -c "
import sys, os
from sqlalchemy import create_engine, text
engine = create_engine(os.environ['DATABASE_URL'])
try:
    with engine.connect() as conn:
        print(conn.execute(text('SELECT count(*) FROM \"' + sys.argv[1] + '\"')).scalar())
except Exception:
    print(0)
" "$1"
}

load_if_empty() {
    local table=$1
    local count
    count=$(_row_count "$table")
    if [ "${count}" -gt 0 ]; then
        echo "[data] $table: ${count} rows already loaded — skipping"
    else
        echo "[data] Loading $table..."
        (cd "$ETL_DIR" && agritwin-etl db-load --table "$table")
    fi
}

load_if_empty data_source       #         5 rows
load_if_empty feature           #        23 rows
load_if_empty crop              #         8 rows
load_if_empty crop_requirement  #        40 rows
load_if_empty production_cost   #        48 rows
load_if_empty crop_statistics   #       512 rows
load_if_empty commodity_price   #     1,772 rows
load_if_empty spatial_cell      #   347,794 rows  (~1-2 min)
load_if_empty observation       # 29,537,692 rows (~2-5 min via COPY FROM STDIN)

echo "[data] All tables loaded."

# ── 6. Stay alive ─────────────────────────────────────────────────────────────
wait "$FLASK_PID"

#!/usr/bin/env bash
# load.sh — run as the `loader` service.
# Bulk-loads all Parquet data into PostgreSQL, smallest table first so the
# app becomes useful quickly.  Each table is guarded: if it already has rows
# the step is skipped, making restarts safe.
# The DB schema is guaranteed to exist (migrate service completed before us).
set -euo pipefail

# Returns the current row count for $1; prints 0 on any error.
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
        echo "[loader] $table: ${count} rows already loaded — skipping"
    else
        echo "[loader] Loading $table..."
        (cd /agritwin-etl && agritwin-etl db-load --table "$table")
    fi
}

echo "[loader] Starting data load..."

load_if_empty data_source       #         5 rows
load_if_empty feature           #        23 rows
load_if_empty crop              #         8 rows
load_if_empty crop_requirement  #        40 rows
load_if_empty production_cost   #        48 rows
load_if_empty crop_statistics   #       512 rows
load_if_empty commodity_price   #     1,772 rows
load_if_empty spatial_cell      #   347,794 rows  (~1-2 min)
load_if_empty observation       # 29,537,692 rows (~2-5 min via COPY FROM STDIN)

echo "[loader] All tables loaded."

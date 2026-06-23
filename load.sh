#!/usr/bin/env bash
# load.sh — run as the `loader` service.
#
# Four-stage pipeline, each stage guarded so restarts are fully idempotent:
#
#   Stage 1 — Reference tables (data_source, feature, crop, …)
#   Stage 2 — Spatial cells, coarsest first
#               2a. Load res-6 + res-9 cells (existing Parquet)
#               2b. Generate res-7/res-8 parent cells from DB, then load them
#   Stage 3 — Aggregated observations (res-7/res-8, ~7.7M rows) — FAST
#               → map becomes interactive at coarse zoom levels within minutes
#   Stage 4 — Raw observations (res-9/res-6, ~47M rows) — SLOW
#               → full detail at high zoom; loads in background while app serves
#
# The DB schema is guaranteed to exist (migrate service ran before us).
set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

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

_row_count_where() {
    python3 -c "
import sys, os
from sqlalchemy import create_engine, text
engine = create_engine(os.environ['DATABASE_URL'])
try:
    with engine.connect() as conn:
        print(conn.execute(text('SELECT count(*) FROM \"' + sys.argv[1] + '\" WHERE ' + sys.argv[2])).scalar())
except Exception:
    print(0)
" "$1" "$2"
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

# ── Stage 1: Reference tables ─────────────────────────────────────────────────
echo "[loader] Stage 1: reference tables"
load_if_empty data_source       #         5 rows
load_if_empty feature           #        42 rows
load_if_empty crop              #         8 rows
load_if_empty crop_requirement  #        66 rows
load_if_empty production_cost   #        48 rows
load_if_empty crop_statistics   #       512 rows
load_if_empty commodity_price   # ~1,772 rows

# ── Stage 2a: res-6 and res-9 spatial cells ───────────────────────────────────
echo "[loader] Stage 2a: spatial cells (res-6/res-9)"
load_if_empty spatial_cell      #   347,794 rows  (~1–2 min)

# ── Stage 2b: res-7 and res-8 parent cells ────────────────────────────────────
echo "[loader] Stage 2b: parent spatial cells (res-7/res-8)"
sc_res7=$(_row_count_where "spatial_cell" "resolution = 7")
if [ "${sc_res7}" -gt 0 ]; then
    echo "[loader] spatial_cell res-7: ${sc_res7} rows already loaded — skipping"
else
    echo "[loader] Generating res-7/res-8 parent cells from DB..."
    (cd /agritwin-etl && agritwin-etl build-parent-cells)
    echo "[loader] Loading res-7/res-8 spatial cells..."
    # Reloads all spatial_cell Parquet; existing rows skip via ON CONFLICT DO NOTHING.
    (cd /agritwin-etl && agritwin-etl db-load --table spatial_cell)
fi

# ── Stage 3: Aggregated observations (res-7/res-8) ───────────────────────────
# These are small (~7.7M rows total) and load in minutes.
# The web app becomes useful at zoom 7–10 as soon as this stage completes.
echo "[loader] Stage 3: aggregated observations (res-7/res-8)"
obs_res7=$(_row_count_where "observation" \
    "h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 7 LIMIT 1)")
if [ "${obs_res7}" -gt 0 ]; then
    echo "[loader] Aggregated observations already loaded — skipping"
else
    # Generate aggregated Parquet if not yet produced (idempotent: skips if files exist).
    if [ ! -f "/agritwin-etl/data/processed/observation/aggregated_res7.parquet" ]; then
        echo "[loader] Aggregating observations to res-7 and res-8 (reads raw Parquet, writes new files)..."
        (cd /agritwin-etl && agritwin-etl aggregate)
    else
        echo "[loader] Aggregated Parquet already exists — skipping aggregation"
    fi
    echo "[loader] Loading aggregated observations..."
    (cd /agritwin-etl && agritwin-etl db-load-agg)
fi

# ── Stage 4: Raw observations (res-9/res-6) ───────────────────────────────────
# Large load (~47M rows, 5–10 min via COPY FROM STDIN).
# App already serves coarse zoom levels from Stage 3; this fills in full detail.
echo "[loader] Stage 4: raw observations (res-9/res-6, ~47M rows)"
obs_res9=$(_row_count_where "observation" \
    "h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 9 LIMIT 1)")
if [ "${obs_res9}" -gt 0 ]; then
    echo "[loader] Raw observations already loaded — skipping"
else
    echo "[loader] Loading raw observations (this takes several minutes)..."
    (cd /agritwin-etl && agritwin-etl db-load-raw-obs)
fi

echo "[loader] All stages complete."

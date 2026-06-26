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

# ── Stage 3: Aggregated observations (res-6/res-7/res-8) ─────────────────────
# These are small (~7.8M rows total) and load in minutes.
# The web app becomes useful at zoom 5–10 as soon as this stage completes.
echo "[loader] Stage 3: aggregated observations (res-6/res-7/res-8)"
# Check both res-7 obs (soil/NDVI at medium zoom) AND res-6 agg obs (soil/NDVI at coarse zoom).
# If res-6 agg is missing (e.g. added later), we re-run the whole stage to pick it up.
obs_res7=$(_row_count_where "observation" \
    "h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 7 LIMIT 1)")
obs_res6_agg=0
if [ -f "/agritwin-etl/data/processed/observation/aggregated_res6.parquet" ]; then
    obs_res6_agg=$(_row_count_where "observation" \
        "h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 6 LIMIT 1) \
         AND feature_id IN (SELECT feature_id FROM feature WHERE category != 'weather')")
fi
if [ "${obs_res7}" -gt 0 ] && [ "${obs_res6_agg}" -gt 0 ]; then
    echo "[loader] Aggregated observations already loaded — skipping"
else
    # Generate aggregated Parquet files (idempotent: overwrites existing files).
    echo "[loader] Aggregating observations to res-6, res-7 and res-8 (reads raw Parquet, writes new files)..."
    (cd /agritwin-etl && agritwin-etl aggregate)
    echo "[loader] Loading aggregated observations..."
    (cd /agritwin-etl && agritwin-etl db-load-agg)
fi

# ── Stage 4: Suitability scores (baseline, scenario_id IS NULL) ───────────────
# Small load (~2.77M rows); loaded before raw obs so the suitability page is
# usable while the large res-9 observation load runs in the background.
echo "[loader] Stage 4: suitability scores (baseline)"
suit_count=$(_row_count_where "suitability_score" "scenario_id IS NULL")
if [ "${suit_count}" -gt 0 ]; then
    echo "[loader] suitability_score baseline: ${suit_count} rows already loaded — skipping"
else
    echo "[loader] Loading suitability scores..."
    (cd /agritwin-etl && agritwin-etl db-load --table suitability_score)
fi

# ── Stage 5: Raw observations (res-9/res-6) ───────────────────────────────────
# Large load (~47M rows, 5–10 min via COPY FROM STDIN).
# App already serves coarse zoom levels from Stage 3; suitability page is already
# live from Stage 4. This fills in full res-9 detail for the monitoring page.
echo "[loader] Stage 5: raw observations (res-9/res-6, ~47M rows)"
obs_res9=$(_row_count_where "observation" \
    "h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 9 LIMIT 1)")
if [ "${obs_res9}" -gt 0 ]; then
    echo "[loader] Raw observations already loaded — skipping"
else
    echo "[loader] Loading raw observations (this takes several minutes)..."
    (cd /agritwin-etl && agritwin-etl db-load-raw-obs)
fi

# ── Stage 6: Demo scenario seed ───────────────────────────────────────────────
# Runs after all ETL data is loaded so the Celery worker can score immediately.
echo "[loader] Stage 6: seeding demo scenarios"
python3 /app/seed_runner.py

echo "[loader] All stages complete."

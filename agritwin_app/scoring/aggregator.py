"""Bulk feature-value collection for suitability scoring.

Runs a small number of SQL queries to pre-fetch all aggregated feature values
for every res-9 cell. Returns a dict keyed by h3_id so the scoring loop needs
no per-cell DB round-trips.
"""
import math
import h3
from sqlalchemy import text
from sqlalchemy.orm import Session

# ERA5-Land features are stored at H3 res-6 (coarser ERA5 grid).
_ERA5_RESOLUTION = 6
_ERA5_FEATURES = {"temperature_2m", "precipitation", "solar_radiation", "temperature_2m_min", "actual_et"}

# Terrain features come from spatial_cell columns, not from observation.
_TERRAIN_FEATURES = {"elevation", "slope"}


def _safe(v) -> float | None:
    """Convert NaN / None to None."""
    if v is None:
        return None
    try:
        return None if math.isnan(float(v)) else float(v)
    except (TypeError, ValueError):
        return None


def collect_feature_values(session: Session) -> dict[str, dict[str, float | None]]:
    """
    Return {res9_h3_id: {feature_name: aggregated_value}} for all res-9 cells.

    Aggregation rules per feature:
      temperature_2m      — AVG across all monthly values (annual mean °C)
      precipitation       — SUM per year then AVG across years (annual mm/year)
      solar_radiation     — AVG across all monthly values (mean monthly MJ/m²)
      temperature_2m_min  — MIN of Apr–Oct monthly minimums (coldest growing-season month)
      actual_et           — AVG across available months 2021-2023 (mm/month)
      soil_*              — direct value (single static timestamp 2017-01-01)
      land_cover_type     — direct value (single static timestamp 2020-01-01)
      elevation, slope    — from spatial_cell columns
    """
    result: dict[str, dict[str, float | None]] = {}

    # --- 1. Terrain from spatial_cell ---
    rows = session.execute(text(
        "SELECT h3_id, elevation, slope FROM spatial_cell WHERE resolution = 9"
    )).mappings().all()
    for row in rows:
        result[row["h3_id"]] = {
            "elevation": _safe(row["elevation"]),
            "slope": _safe(row["slope"]),
        }

    # --- 2. ERA5 weather at res-6 (aggregate then fan out to res-9) ---
    weather_sql = text("""
        SELECT
            o.h3_id,
            f.name AS feature_name,
            CASE f.name
                WHEN 'precipitation' THEN
                    AVG(annual_sum) OVER (PARTITION BY o.h3_id, f.name)
                ELSE
                    AVG(o.value) OVER (PARTITION BY o.h3_id, f.name)
            END AS agg_value
        FROM (
            SELECT
                h3_id,
                feature_id,
                value,
                EXTRACT(year FROM timestamp) AS yr,
                SUM(CASE WHEN f2.name = 'precipitation' THEN value ELSE NULL END)
                    OVER (PARTITION BY h3_id, feature_id, EXTRACT(year FROM timestamp)) AS annual_sum
            FROM observation o2
            JOIN feature f2 USING (feature_id)
            WHERE f2.name IN ('temperature_2m', 'precipitation', 'solar_radiation', 'actual_et')
        ) o
        JOIN feature f ON f.feature_id = o.feature_id
    """)
    # Use a simpler per-feature approach for clarity:
    era5_agg: dict[str, dict[str, float | None]] = {}  # {res6_h3_id: {feat: value}}

    # temperature_2m — annual mean
    rows = session.execute(text("""
        SELECT h3_id, AVG(value) AS v
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.name = 'temperature_2m'
        GROUP BY h3_id
    """)).mappings().all()
    for row in rows:
        era5_agg.setdefault(row["h3_id"], {})["temperature_2m"] = _safe(row["v"])

    # precipitation — annual sum then avg across years
    rows = session.execute(text("""
        SELECT h3_id, AVG(annual_sum) AS v
        FROM (
            SELECT h3_id, EXTRACT(year FROM timestamp) AS yr, SUM(value) AS annual_sum
            FROM observation o JOIN feature f USING(feature_id)
            WHERE f.name = 'precipitation'
            GROUP BY h3_id, yr
        ) yearly
        GROUP BY h3_id
    """)).mappings().all()
    for row in rows:
        era5_agg.setdefault(row["h3_id"], {})["precipitation"] = _safe(row["v"])

    # solar_radiation — monthly mean
    rows = session.execute(text("""
        SELECT h3_id, AVG(value) AS v
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.name = 'solar_radiation'
        GROUP BY h3_id
    """)).mappings().all()
    for row in rows:
        era5_agg.setdefault(row["h3_id"], {})["solar_radiation"] = _safe(row["v"])

    # temperature_2m_min — min of Apr–Oct monthly minimums
    rows = session.execute(text("""
        SELECT h3_id, MIN(value) AS v
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.name = 'temperature_2m_min'
          AND EXTRACT(month FROM timestamp) BETWEEN 4 AND 10
        GROUP BY h3_id
    """)).mappings().all()
    for row in rows:
        era5_agg.setdefault(row["h3_id"], {})["temperature_2m_min"] = _safe(row["v"])

    # actual_et — monthly mean (2021-2023 only)
    rows = session.execute(text("""
        SELECT h3_id, AVG(value) AS v
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.name = 'actual_et'
        GROUP BY h3_id
    """)).mappings().all()
    for row in rows:
        era5_agg.setdefault(row["h3_id"], {})["actual_et"] = _safe(row["v"])

    # Fan ERA5 res-6 values out to res-9 cells
    for h3_id in list(result.keys()):
        parent = h3.cell_to_parent(h3_id, _ERA5_RESOLUTION)
        weather = era5_agg.get(parent, {})
        result[h3_id].update(weather)

    # --- 3. Soil features (res-9, static timestamp) ---
    rows = session.execute(text("""
        SELECT o.h3_id, f.name AS feature_name, o.value
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.category = 'soil'
          AND o.h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 9)
    """)).mappings().all()
    for row in rows:
        if row["h3_id"] in result:
            result[row["h3_id"]][row["feature_name"]] = _safe(row["value"])

    # --- 4. Land cover (res-9, static) ---
    rows = session.execute(text("""
        SELECT o.h3_id, o.value
        FROM observation o JOIN feature f USING(feature_id)
        WHERE f.name = 'land_cover_type'
          AND o.h3_id IN (SELECT h3_id FROM spatial_cell WHERE resolution = 9)
    """)).mappings().all()
    for row in rows:
        if row["h3_id"] in result:
            result[row["h3_id"]]["land_cover_type"] = _safe(row["value"])

    return result

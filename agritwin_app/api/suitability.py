import json
import h3
from flask import jsonify, request, Response
from sqlalchemy import text
from . import bp
from ..db.session import get_session
from ..db.models import SpatialCell

TURKEY_WEST, TURKEY_SOUTH, TURKEY_EAST, TURKEY_NORTH = 25.5, 35.5, 45.0, 42.5

FEATURE_LABELS = {
    "temperature_2m":            "Temperature",
    "precipitation":             "Precipitation",
    "solar_radiation":           "Solar Radiation",
    "temperature_2m_min":        "Min Temperature",
    "soil_ph_0-5cm":             "Soil pH",
    "soil_organic_carbon_0-5cm": "Organic Carbon",
    "soil_clay_0-5cm":           "Clay Content",
    "soil_nitrogen_0-5cm":       "Soil Nitrogen",
    "elevation":                 "Elevation",
    "slope":                     "Slope",
}

FEATURE_UNITS = {
    "temperature_2m":            "°C",
    "precipitation":             "mm",
    "solar_radiation":           "MJ/m²",
    "temperature_2m_min":        "°C",
    "soil_ph_0-5cm":             "pH",
    "soil_organic_carbon_0-5cm": "g/kg",
    "soil_clay_0-5cm":           "g/kg",
    "soil_nitrogen_0-5cm":       "g/kg",
    "elevation":                 "m",
    "slope":                     "°",
}

SOIL_FEATURES   = {"soil_ph_0-5cm", "soil_organic_carbon_0-5cm", "soil_clay_0-5cm", "soil_nitrogen_0-5cm"}
TERRAIN_FEATURES = {"elevation", "slope"}

# Canonical display order for the feature breakdown section
FEATURE_ORDER = [
    "temperature_2m", "precipitation", "solar_radiation", "temperature_2m_min",
    "soil_ph_0-5cm", "soil_organic_carbon_0-5cm", "soil_clay_0-5cm", "soil_nitrogen_0-5cm",
    "elevation", "slope",
]

DEFAULT_CROP    = "Wheat"
ERA5_RESOLUTION = 6


def _parse_bbox(raw: str) -> tuple[float, float, float, float]:
    parts = raw.split(",")
    if len(parts) != 4:
        raise ValueError("bbox must be west,south,east,north")
    w, s, e, n = (float(p) for p in parts)
    return w, s, e, n


def _bbox_ok(w, s, e, n) -> bool:
    return (
        w >= TURKEY_WEST - 2 and s >= TURKEY_SOUTH - 2
        and e <= TURKEY_EAST + 2 and n <= TURKEY_NORTH + 2
        and w < e and s < n
    )


@bp.get("/suitability/cells")
def get_suitability_cells():
    raw_bbox = request.args.get("bbox", "")
    if not raw_bbox:
        return jsonify({"error": "bbox parameter is required"}), 400

    try:
        w, s, e, n = _parse_bbox(raw_bbox)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not _bbox_ok(w, s, e, n):
        return jsonify({"error": "bbox outside Turkey extent"}), 400

    crop_name = request.args.get("crop", DEFAULT_CROP)

    with get_session() as session:
        sql = text("""
            SELECT
                sc.h3_id,
                ST_AsGeoJSON(sc.geometry) AS geojson,
                ss.score
            FROM spatial_cell sc
            LEFT JOIN suitability_score ss
                ON ss.h3_id = sc.h3_id
                AND ss.scenario_id IS NULL
                AND ss.crop_id = (SELECT crop_id FROM crop WHERE name = :crop_name)
            WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
              AND sc.resolution = 9
        """)
        rows = session.execute(
            sql, {"w": w, "s": s, "e": e, "n": n, "crop_name": crop_name}
        ).mappings().all()

        features = [
            {
                "type": "Feature",
                "geometry": json.loads(row["geojson"]),
                "properties": {"h3_id": row["h3_id"], "score": row["score"]},
            }
            for row in rows
        ]
        body = json.dumps({"type": "FeatureCollection", "features": features})
        return Response(body, mimetype="application/geo+json")


@bp.get("/suitability/cells/<h3_id>")
def get_suitability_cell(h3_id: str):
    with get_session() as session:
        cell = session.get(SpatialCell, h3_id)
        if cell is None:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        sql = text("""
            SELECT c.name AS crop_name, ss.score, ss.scored_at
            FROM suitability_score ss
            JOIN crop c ON c.crop_id = ss.crop_id
            WHERE ss.h3_id = :h3_id AND ss.scenario_id IS NULL
            ORDER BY ss.score DESC NULLS LAST
        """)
        rows = session.execute(sql, {"h3_id": h3_id}).mappings().all()

        return jsonify([
            {
                "crop_name": row["crop_name"],
                "score":     row["score"],
                "scored_at": row["scored_at"].isoformat() if row["scored_at"] else None,
            }
            for row in rows
        ])


@bp.get("/suitability/cells/<h3_id>/monthly")
def get_suitability_monthly(h3_id: str):
    """Return all feature requirement data for the cell + crop.

    Response is a list ordered by FEATURE_ORDER. Each item is either:
      - Weather (is_static=false): {"feature", "label", "unit", "is_static": false,
          "months": [{"month", "actual", "req_min", "req_optimal", "req_max"}, ...]}
      - Static  (is_static=true):  {"feature", "label", "unit", "is_static": true,
          "actual", "req_min", "req_optimal", "req_max"}
    """
    crop_name = request.args.get("crop", DEFAULT_CROP)

    with get_session() as session:
        cell = session.get(SpatialCell, h3_id)
        if cell is None:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        era5_h3_id = h3.cell_to_parent(h3_id, ERA5_RESOLUTION)

        crop_row = session.execute(
            text("SELECT crop_id FROM crop WHERE name = :name"),
            {"name": crop_name},
        ).one_or_none()
        if crop_row is None:
            return jsonify({"error": f"crop {crop_name!r} not found"}), 404
        crop_id = crop_row[0]

        req_rows = session.execute(
            text("""
                SELECT parameter, month, min_value, optimal_value, max_value
                FROM crop_requirement
                WHERE crop_id = :crop_id
                ORDER BY parameter, month NULLS LAST
            """),
            {"crop_id": crop_id},
        ).mappings().all()

        if not req_rows:
            return jsonify([])

        # Split requirements into weather (monthly) and static (year-round)
        weather_reqs: dict[str, dict[int, dict]] = {}
        static_reqs:  dict[str, dict]            = {}

        for r in req_rows:
            feat = r["parameter"]
            if feat not in FEATURE_LABELS:
                continue
            if r["month"] is not None:
                weather_reqs.setdefault(feat, {})[r["month"]] = {
                    "req_min":     r["min_value"],
                    "req_optimal": r["optimal_value"],
                    "req_max":     r["max_value"],
                }
            else:
                static_reqs[feat] = {
                    "req_min":     r["min_value"],
                    "req_optimal": r["optimal_value"],
                    "req_max":     r["max_value"],
                }

        result_map: dict[str, dict] = {}

        # ── Weather features: ERA5 climatology at res-6 parent ─────────────────
        if weather_reqs:
            weather_names = list(weather_reqs.keys())
            obs_rows = session.execute(
                text("""
                    SELECT
                        f.name AS feature_name,
                        EXTRACT(MONTH FROM o.timestamp)::int AS month,
                        AVG(o.value) AS actual
                    FROM observation o
                    JOIN feature f ON f.feature_id = o.feature_id
                    WHERE o.h3_id = :h3_id
                      AND f.name = ANY(:feature_names)
                    GROUP BY f.name, EXTRACT(MONTH FROM o.timestamp)
                    ORDER BY f.name, month
                """),
                {"h3_id": era5_h3_id, "feature_names": weather_names},
            ).mappings().all()

            actuals: dict[str, dict[int, float]] = {}
            for row in obs_rows:
                actuals.setdefault(row["feature_name"], {})[row["month"]] = row["actual"]

            for feat, monthly_reqs in weather_reqs.items():
                months_data = [
                    {
                        "month":       month,
                        "actual":      round(float(actuals.get(feat, {}).get(month)), 2)
                                       if actuals.get(feat, {}).get(month) is not None else None,
                        "req_min":     req["req_min"],
                        "req_optimal": req["req_optimal"],
                        "req_max":     req["req_max"],
                    }
                    for month, req in sorted(monthly_reqs.items())
                ]
                result_map[feat] = {
                    "feature":   feat,
                    "label":     FEATURE_LABELS[feat],
                    "unit":      FEATURE_UNITS[feat],
                    "is_static": False,
                    "months":    months_data,
                }

        # ── Static features: soil at res-9, terrain from spatial_cell ──────────
        if static_reqs:
            soil_names    = [f for f in static_reqs if f in SOIL_FEATURES]
            terrain_names = [f for f in static_reqs if f in TERRAIN_FEATURES]

            soil_actuals: dict[str, float] = {}
            if soil_names:
                soil_rows = session.execute(
                    text("""
                        SELECT DISTINCT ON (f.name)
                            f.name  AS feature_name,
                            o.value AS actual
                        FROM observation o
                        JOIN feature f ON f.feature_id = o.feature_id
                        WHERE o.h3_id = :h3_id
                          AND f.name = ANY(:feature_names)
                        ORDER BY f.name, o.timestamp DESC
                    """),
                    {"h3_id": h3_id, "feature_names": soil_names},
                ).mappings().all()
                for row in soil_rows:
                    soil_actuals[row["feature_name"]] = row["actual"]

            terrain_actuals: dict[str, float] = {}
            if terrain_names:
                sc_row = session.execute(
                    text("SELECT elevation, slope FROM spatial_cell WHERE h3_id = :h3_id"),
                    {"h3_id": h3_id},
                ).one_or_none()
                if sc_row:
                    terrain_actuals["elevation"] = sc_row[0]
                    terrain_actuals["slope"]      = sc_row[1]

            all_static = {**soil_actuals, **terrain_actuals}

            for feat, req in static_reqs.items():
                raw_val = all_static.get(feat)
                result_map[feat] = {
                    "feature":     feat,
                    "label":       FEATURE_LABELS[feat],
                    "unit":        FEATURE_UNITS[feat],
                    "is_static":   True,
                    "actual":      round(float(raw_val), 3) if raw_val is not None else None,
                    "req_min":     req["req_min"],
                    "req_optimal": req["req_optimal"],
                    "req_max":     req["req_max"],
                }

        result = [result_map[f] for f in FEATURE_ORDER if f in result_map]
        return jsonify(result)

import json
from flask import jsonify, request, Response
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from . import bp
from ..db.session import get_session
from ..db.models import SpatialCell
from ..tasks import compute_scenario_scores


def _polygon_wkt_from_geojson(geojson_coords: list) -> str:
    """Convert GeoJSON ring coordinates to WKT POLYGON string."""
    ring = " ".join(f"{lng} {lat}" for lng, lat in geojson_coords[0])
    return f"POLYGON(({ring}))"


@bp.get("/scenarios")
def list_scenarios():
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT scenario_id, name, status, created_at, scored_at
                FROM scenario
                ORDER BY created_at DESC
            """)
        ).mappings().all()

        return jsonify([
            {
                "scenario_id": r["scenario_id"],
                "name": r["name"],
                "status": r["status"] or "pending",
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "scored_at": r["scored_at"].isoformat() if r["scored_at"] else None,
            }
            for r in rows
        ])


@bp.post("/scenarios")
def create_scenario():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "JSON body required"}), 400

    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    polygon = body.get("polygon", "")
    if not polygon:
        return jsonify({"error": "polygon (WKT) is required"}), 400

    try:
        shapely_wkt.loads(polygon)
    except Exception:
        return jsonify({"error": "invalid polygon WKT"}), 400

    overrides = body.get("overrides", {})
    allowed_keys = {"precipitation", "temperature_2m", "temperature_2m_min", "soil_ph_0-5cm"}
    overrides = {k: float(v) for k, v in overrides.items() if k in allowed_keys}

    MAX_CELLS = 30_000
    with get_session() as session:
        cell_count = session.execute(
            text("""
                SELECT COUNT(*)
                FROM spatial_cell
                WHERE resolution = 9
                  AND ST_Within(geometry, ST_SetSRID(ST_GeomFromText(:polygon), 4326))
            """),
            {"polygon": polygon},
        ).scalar_one()

    if cell_count > MAX_CELLS:
        return jsonify({
            "error": (
                f"Polygon is too large — it covers {cell_count:,} cells "
                f"(limit: {MAX_CELLS:,}). Please draw a smaller area."
            )
        }), 400

    with get_session() as session:
        result = session.execute(
            text("""
                INSERT INTO scenario (name, overrides, polygon_geom, status, created_at)
                VALUES (
                    :name,
                    CAST(:overrides AS JSONB),
                    ST_SetSRID(ST_GeomFromText(:polygon), 4326),
                    'pending',
                    NOW()
                )
                RETURNING scenario_id
            """),
            {
                "name": name,
                "overrides": json.dumps(overrides),
                "polygon": polygon,
            },
        )
        scenario_id = result.scalar_one()
        session.commit()

    task = compute_scenario_scores.delay(scenario_id)

    with get_session() as session:
        session.execute(
            text("UPDATE scenario SET task_id = :task_id WHERE scenario_id = :id"),
            {"task_id": task.id, "id": scenario_id},
        )
        session.commit()

    return jsonify({"scenario_id": scenario_id, "task_id": task.id}), 201


@bp.get("/scenarios/<int:scenario_id>/status")
def get_scenario_status(scenario_id: int):
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT status, scored_at
                FROM scenario WHERE scenario_id = :id
            """),
            {"id": scenario_id},
        ).one_or_none()

        if row is None:
            return jsonify({"error": "not found"}), 404

        return jsonify({
            "status": row[0] or "pending",
            "scored_at": row[1].isoformat() if row[1] else None,
        })


@bp.delete("/scenarios/<int:scenario_id>")
def delete_scenario(scenario_id: int):
    with get_session() as session:
        result = session.execute(
            text("DELETE FROM scenario WHERE scenario_id = :id RETURNING scenario_id"),
            {"id": scenario_id},
        )
        deleted = result.one_or_none()
        session.commit()

    if deleted is None:
        return jsonify({"error": "not found"}), 404
    return jsonify({"deleted": scenario_id}), 200


@bp.get("/scenarios/<int:scenario_id>/cells")
def get_scenario_cells(scenario_id: int):
    raw_bbox = request.args.get("bbox", "")
    if not raw_bbox:
        return jsonify({"error": "bbox parameter is required"}), 400

    parts = raw_bbox.split(",")
    if len(parts) != 4:
        return jsonify({"error": "bbox must be west,south,east,north"}), 400
    try:
        w, s, e, n = (float(p) for p in parts)
    except ValueError:
        return jsonify({"error": "bbox values must be numeric"}), 400

    crop_name = request.args.get("crop", "Wheat")

    with get_session() as session:
        sql = text("""
            SELECT
                sc.h3_id,
                ST_AsGeoJSON(sc.geometry) AS geojson,
                ss.score
            FROM spatial_cell sc
            LEFT JOIN suitability_score ss
                ON ss.h3_id = sc.h3_id
                AND ss.scenario_id = :scenario_id
                AND ss.crop_id = (SELECT crop_id FROM crop WHERE name = :crop_name)
            WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
              AND sc.resolution = 9
              AND EXISTS (
                SELECT 1 FROM suitability_score
                WHERE h3_id = sc.h3_id AND scenario_id = :scenario_id
              )
        """)
        rows = session.execute(
            sql, {"scenario_id": scenario_id, "w": w, "s": s, "e": e, "n": n,
                  "crop_name": crop_name}
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


@bp.get("/scenarios/<int:scenario_id>/cells/<h3_id>/requirements")
def get_scenario_cell_requirements(scenario_id: int, h3_id: str):
    import h3 as h3lib

    WEATHER = {"precipitation", "temperature_2m", "temperature_2m_min"}
    FEATURE_META = {
        "precipitation":      {"label": "Precipitation",    "unit": "mm/month"},
        "temperature_2m":     {"label": "Mean Temperature", "unit": "°C"},
        "temperature_2m_min": {"label": "Min Temperature",  "unit": "°C"},
        "soil_ph_0-5cm":      {"label": "Soil pH",          "unit": ""},
    }

    with get_session() as session:
        scen = session.execute(
            text("SELECT overrides FROM scenario WHERE scenario_id = :id"),
            {"id": scenario_id},
        ).one_or_none()

        if scen is None:
            return jsonify({"error": "scenario not found"}), 404

        active = {k: v for k, v in (scen.overrides or {}).items() if v != 0}
        if not active:
            return jsonify([])

        parent_h3 = h3lib.cell_to_parent(h3_id, 6)
        result = []

        crop_name = request.args.get("crop", "Wheat")

        for feature_name, delta in active.items():
            meta = FEATURE_META.get(feature_name)
            if not meta:
                continue

            obs_h3 = parent_h3 if feature_name in WEATHER else h3_id

            obs_rows = session.execute(text("""
                SELECT EXTRACT(MONTH FROM o.timestamp)::int AS month,
                       AVG(o.value) AS value
                FROM observation o
                JOIN feature f ON f.feature_id = o.feature_id
                WHERE o.h3_id = :h3_id AND f.name = :feature_name
                GROUP BY 1 ORDER BY 1
            """), {"h3_id": obs_h3, "feature_name": feature_name}).mappings().all()

            if feature_name not in WEATHER and obs_rows:
                # Soil features (e.g. SoilGrids) are a static snapshot with 1-2
                # timestamps.  Broadcast the average across all 12 months so the
                # chart shows a flat line rather than 1-2 isolated dots.
                avg_val = sum(float(r["value"]) for r in obs_rows) / len(obs_rows)
                obs_by_month = {m: avg_val for m in range(1, 13)}
            else:
                obs_by_month = {r["month"]: float(r["value"]) for r in obs_rows}

            req_rows = session.execute(text("""
                SELECT cr.month,
                       cr.min_value     AS req_min,
                       cr.optimal_value AS req_optimal,
                       cr.max_value     AS req_max
                FROM crop_requirement cr
                JOIN crop c ON c.crop_id = cr.crop_id
                WHERE cr.parameter = :param AND c.name = :crop_name
                ORDER BY cr.month
            """), {"param": feature_name, "crop_name": crop_name}).mappings().all()

            req_by_month = {r["month"]: r for r in req_rows}

            months_out = []
            for m in range(1, 13):
                baseline = obs_by_month.get(m)
                scenario_val = (baseline + delta) if baseline is not None else None
                req = req_by_month.get(m)
                months_out.append({
                    "month":          m,
                    "baseline_value": baseline,
                    "scenario_value": scenario_val,
                    "req_min":     float(req["req_min"])     if req and req["req_min"]     is not None else None,
                    "req_optimal": float(req["req_optimal"]) if req and req["req_optimal"] is not None else None,
                    "req_max":     float(req["req_max"])     if req and req["req_max"]     is not None else None,
                })

            result.append({
                "feature": feature_name,
                "label":   meta["label"],
                "unit":    meta["unit"],
                "delta":   delta,
                "months":  months_out,
            })

        return jsonify(result)


@bp.get("/scenarios/<int:scenario_id>/cells/<h3_id>")
def get_scenario_cell(scenario_id: int, h3_id: str):
    with get_session() as session:
        cell = session.get(SpatialCell, h3_id)
        if cell is None:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        sql = text("""
            SELECT
                c.name AS crop_name,
                base.score AS baseline_score,
                scen.score AS scenario_score
            FROM crop c
            LEFT JOIN suitability_score base
                ON base.crop_id = c.crop_id
                AND base.h3_id = :h3_id
                AND base.scenario_id IS NULL
            LEFT JOIN suitability_score scen
                ON scen.crop_id = c.crop_id
                AND scen.h3_id = :h3_id
                AND scen.scenario_id = :scenario_id
            ORDER BY c.name
        """)
        rows = session.execute(sql, {"h3_id": h3_id, "scenario_id": scenario_id}).mappings().all()

        return jsonify([
            {
                "crop_name": row["crop_name"],
                "baseline_score": row["baseline_score"],
                "scenario_score": row["scenario_score"],
            }
            for row in rows
        ])

import json
from flask import jsonify, request, Response
from sqlalchemy import text
from . import bp
from ..db.session import get_session


@bp.get("/yield-profit/cells")
def list_yield_profit_cells():
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
        rows = session.execute(
            text("""
                SELECT
                    sc.h3_id,
                    ST_AsGeoJSON(sc.geometry) AS geojson,
                    yp.predicted_yield,
                    pp.net_profit
                FROM spatial_cell sc
                LEFT JOIN yield_prediction yp
                    ON yp.h3_id = sc.h3_id
                    AND yp.scenario_id IS NULL
                    AND yp.crop_id = (SELECT crop_id FROM crop WHERE name = :crop_name)
                LEFT JOIN profit_projection pp
                    ON pp.h3_id = sc.h3_id
                    AND pp.scenario_id IS NULL
                    AND pp.crop_id = (SELECT crop_id FROM crop WHERE name = :crop_name)
                WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
                  AND sc.resolution = 9
                  AND EXISTS (
                    SELECT 1 FROM yield_prediction
                    WHERE h3_id = sc.h3_id AND scenario_id IS NULL
                  )
            """),
            {"crop_name": crop_name, "w": w, "s": s, "e": e, "n": n},
        ).mappings().all()

        features = [
            {
                "type": "Feature",
                "geometry": json.loads(row["geojson"]),
                "properties": {
                    "h3_id": row["h3_id"],
                    "predicted_yield": row["predicted_yield"],
                    "net_profit": row["net_profit"],
                },
            }
            for row in rows
        ]
        body = json.dumps({"type": "FeatureCollection", "features": features})
        return Response(body, mimetype="application/geo+json")


@bp.get("/yield-profit/cells/<h3_id>")
def get_yield_profit_cell(h3_id: str):
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT
                    c.name AS crop_name,
                    yp.predicted_yield,
                    pp.gross_revenue,
                    pp.total_cost,
                    pp.net_profit,
                    pc_breakdown.cost_breakdown
                FROM crop c
                LEFT JOIN yield_prediction yp
                    ON yp.crop_id = c.crop_id
                    AND yp.h3_id = :h3_id
                    AND yp.scenario_id IS NULL
                LEFT JOIN profit_projection pp
                    ON pp.crop_id = c.crop_id
                    AND pp.h3_id = :h3_id
                    AND pp.scenario_id IS NULL
                LEFT JOIN LATERAL (
                    SELECT json_agg(json_build_object(
                        'cost_type', pc.cost_type,
                        'cost', pc.cost
                    ) ORDER BY pc.cost_type) AS cost_breakdown
                    FROM production_cost pc
                    WHERE pc.crop_id = c.crop_id
                ) pc_breakdown ON true
                ORDER BY pp.net_profit DESC NULLS LAST
            """),
            {"h3_id": h3_id},
        ).mappings().all()

        if not rows:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        return jsonify([
            {
                "crop_name": row["crop_name"],
                "predicted_yield": row["predicted_yield"],
                "gross_revenue": row["gross_revenue"],
                "total_cost": row["total_cost"],
                "net_profit": row["net_profit"],
                "cost_breakdown": row["cost_breakdown"] or [],
            }
            for row in rows
        ])

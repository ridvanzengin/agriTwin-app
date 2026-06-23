import json
import math
from datetime import date
import h3
from flask import jsonify, request, Response
from sqlalchemy import select, text
from . import bp
from ..db.session import get_session
from ..db.models import Feature, Observation, SpatialCell

def _f(v):
    """PostgreSQL can store NaN for float columns; json.dumps emits NaN (invalid JSON). Return None instead."""
    try:
        return None if math.isnan(v) else v
    except TypeError:
        return v  # None or non-numeric pass through


# Turkey bounding box (generous sanity limit; ±2° margin applied in _bbox_ok)
TURKEY_WEST, TURKEY_SOUTH, TURKEY_EAST, TURKEY_NORTH = 25.5, 35.5, 45.0, 42.5

# Features stored at H3 resolution 6 (ERA5-Land)
WEATHER_CATEGORY = "weather"
ERA5_RESOLUTION = 6

# Terrain features live as columns on spatial_cell, not in the observation table.
TERRAIN_FEATURES: dict[str, str] = {
    "elevation": "m",
    "slope": "°",
    "aspect": "°",
}


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


@bp.get("/cells")
def get_cells():
    raw_bbox = request.args.get("bbox", "")
    if not raw_bbox:
        return jsonify({"error": "bbox parameter is required"}), 400

    try:
        w, s, e, n = _parse_bbox(raw_bbox)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not _bbox_ok(w, s, e, n):
        return jsonify({"error": "bbox outside Turkey extent"}), 400

    res_raw = request.args.get("resolution", "9")
    try:
        resolution = int(res_raw)
        if resolution not in (6, 7, 8, 9):
            raise ValueError
    except ValueError:
        return jsonify({"error": "resolution must be 6, 7, 8, or 9"}), 400

    feature_name = request.args.get("feature")
    base_params = {"w": w, "s": s, "e": e, "n": n, "resolution": resolution}

    with get_session() as session:
        if feature_name:
            if feature_name in TERRAIN_FEATURES:
                # elevation/slope/aspect are spatial_cell columns (null at res-6, populated at res-7/8/9)
                unit = TERRAIN_FEATURES[feature_name]
                col = feature_name  # safe: gated to TERRAIN_FEATURES keys
                sql = text(f"""
                    SELECT
                        sc.h3_id,
                        ST_AsGeoJSON(sc.geometry) AS geojson,
                        sc.elevation,
                        sc.slope,
                        sc.aspect,
                        sc.{col} AS value
                    FROM spatial_cell sc
                    WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
                      AND sc.resolution = :resolution
                """)  # noqa: S608 — col gated to TERRAIN_FEATURES keys
                rows = session.execute(sql, base_params).mappings().all()
                features = [
                    {
                        "type": "Feature",
                        "geometry": json.loads(row["geojson"]),
                        "properties": {
                            "h3_id": row["h3_id"],
                            "elevation": _f(row["elevation"]),
                            "slope": _f(row["slope"]),
                            "aspect": _f(row["aspect"]),
                            "value": _f(row["value"]),
                            "value_unit": unit,
                        },
                    }
                    for row in rows
                ]
                body = json.dumps({"type": "FeatureCollection", "features": features})
                return Response(body, mimetype="application/geo+json")

            feat_row = session.execute(
                select(Feature).where(Feature.name == feature_name)
            ).scalar_one_or_none()
            if feat_row is None:
                return jsonify({"error": f"unknown feature: {feature_name}"}), 400

            if feat_row.category == WEATHER_CATEGORY and resolution != ERA5_RESOLUTION:
                # Weather: ERA5 observations stored at res-6 parent cells.
                # Map each polygon cell (res-7/8/9) to its ERA5 parent before joining.
                cells_sql = text("""
                    SELECT h3_id, ST_AsGeoJSON(geometry) AS geojson, elevation, slope, aspect
                    FROM spatial_cell
                    WHERE geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
                      AND resolution = :resolution
                """)
                cell_rows = session.execute(
                    cells_sql, {"w": w, "s": s, "e": e, "n": n, "resolution": resolution}
                ).mappings().all()

                parent_map = {
                    row["h3_id"]: h3.cell_to_parent(row["h3_id"], ERA5_RESOLUTION)
                    for row in cell_rows
                }
                unique_parents = list(set(parent_map.values()))

                obs_sql = text("""
                    SELECT DISTINCT ON (h3_id) h3_id, value
                    FROM observation
                    WHERE h3_id = ANY(:parents) AND feature_id = :fid
                    ORDER BY h3_id, timestamp DESC
                """)
                obs_rows = session.execute(
                    obs_sql, {"parents": unique_parents, "fid": feat_row.feature_id}
                ).mappings().all()
                parent_value: dict[str, float | None] = {row["h3_id"]: row["value"] for row in obs_rows}

                features = [
                    {
                        "type": "Feature",
                        "geometry": json.loads(row["geojson"]),
                        "properties": {
                            "h3_id": row["h3_id"],
                            "elevation": _f(row["elevation"]),
                            "slope": _f(row["slope"]),
                            "aspect": _f(row["aspect"]),
                            "value": parent_value.get(parent_map[row["h3_id"]]),
                            "value_unit": feat_row.unit or "",
                        },
                    }
                    for row in cell_rows
                ]
            else:
                # Direct lateral join: soil/vegetation at res-7/8/9 link directly via h3_id
                # (aggregated_res7/res8 Parquet files are loaded into observation at those h3_ids)
                sql = text("""
                    SELECT
                        sc.h3_id,
                        ST_AsGeoJSON(sc.geometry) AS geojson,
                        sc.elevation,
                        sc.slope,
                        sc.aspect,
                        latest.value,
                        :unit AS value_unit
                    FROM spatial_cell sc
                    LEFT JOIN LATERAL (
                        SELECT value
                        FROM observation
                        WHERE h3_id = sc.h3_id AND feature_id = :fid
                        ORDER BY timestamp DESC
                        LIMIT 1
                    ) latest ON TRUE
                    WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
                      AND sc.resolution = :resolution
                """)
                rows = session.execute(
                    sql,
                    {**base_params, "fid": feat_row.feature_id, "unit": feat_row.unit or ""},
                ).mappings().all()

                features = [
                    {
                        "type": "Feature",
                        "geometry": json.loads(row["geojson"]),
                        "properties": {
                            "h3_id": row["h3_id"],
                            "elevation": _f(row["elevation"]),
                            "slope": _f(row["slope"]),
                            "aspect": _f(row["aspect"]),
                            "value": _f(row["value"]),
                            "value_unit": row["value_unit"],
                        },
                    }
                    for row in rows
                ]
        else:
            sql = text("""
                SELECT
                    sc.h3_id,
                    ST_AsGeoJSON(sc.geometry) AS geojson,
                    sc.elevation,
                    sc.slope,
                    sc.aspect
                FROM spatial_cell sc
                WHERE sc.geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
                  AND sc.resolution = :resolution
            """)
            rows = session.execute(sql, base_params).mappings().all()

            features = [
                {
                    "type": "Feature",
                    "geometry": json.loads(row["geojson"]),
                    "properties": {
                        "h3_id": row["h3_id"],
                        "elevation": _f(row["elevation"]),
                        "slope": _f(row["slope"]),
                        "aspect": _f(row["aspect"]),
                    },
                }
                for row in rows
            ]

        body = json.dumps({"type": "FeatureCollection", "features": features})
        return Response(body, mimetype="application/geo+json")


@bp.get("/cells/centroids")
def get_cell_centroids():
    """All res-6 cell centroids as Point GeoJSON — loaded once, no bbox filter.

    The MapLibre client fetches this once on startup and handles clustering client-side.
    Route must be registered before /cells/<h3_id> so 'centroids' isn't captured as h3_id.
    """
    with get_session() as session:
        sql = text("""
            SELECT h3_id, ST_AsGeoJSON(ST_Centroid(geometry)) AS geojson
            FROM spatial_cell
            WHERE resolution = 6
        """)
        rows = session.execute(sql).mappings().all()
        features = [
            {
                "type": "Feature",
                "geometry": json.loads(row["geojson"]),
                "properties": {"h3_id": row["h3_id"]},
            }
            for row in rows
        ]
        body = json.dumps({"type": "FeatureCollection", "features": features})
        return Response(body, mimetype="application/geo+json")


@bp.get("/cells/<h3_id>")
def get_cell(h3_id: str):
    with get_session() as session:
        cell = session.get(SpatialCell, h3_id)
        if cell is None:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        # Weather features (ERA5) are stored at res-6; compute parent once for this cell
        era5_h3_id = h3.cell_to_parent(h3_id, ERA5_RESOLUTION)

        sql = text("""
            SELECT
                f.name,
                f.category,
                f.unit,
                latest.value,
                latest.timestamp
            FROM feature f
            JOIN LATERAL (
                SELECT value, timestamp
                FROM observation
                WHERE h3_id = CASE WHEN f.category = :weather_cat
                                   THEN :era5_h3_id
                                   ELSE :h3_id
                              END
                  AND feature_id = f.feature_id
                ORDER BY timestamp DESC
                LIMIT 1
            ) latest ON TRUE
            ORDER BY f.category, f.name
        """)
        rows = session.execute(
            sql,
            {"h3_id": h3_id, "era5_h3_id": era5_h3_id, "weather_cat": WEATHER_CATEGORY},
        ).mappings().all()

        return jsonify({
            "h3_id": cell.h3_id,
            "elevation": _f(cell.elevation),
            "slope": _f(cell.slope),
            "aspect": _f(cell.aspect),
            "features": [
                {
                    "name": row["name"],
                    "category": row["category"],
                    "unit": row["unit"] or "",
                    "latest_value": row["value"],
                    "latest_timestamp": row["timestamp"].isoformat() if row["timestamp"] else None,
                }
                for row in rows
            ],
        })


@bp.get("/cells/<h3_id>/timeseries")
def get_cell_timeseries(h3_id: str):
    feature_name = request.args.get("feature")
    if not feature_name:
        return jsonify({"error": "feature parameter is required"}), 400

    start_raw = request.args.get("start")
    end_raw = request.args.get("end")

    try:
        start_dt = date.fromisoformat(start_raw) if start_raw else None
        end_dt = date.fromisoformat(end_raw) if end_raw else None
    except ValueError:
        return jsonify({"error": "start/end must be ISO 8601 dates"}), 400

    with get_session() as session:
        cell = session.get(SpatialCell, h3_id)
        if cell is None:
            return jsonify({"error": f"cell {h3_id!r} not found"}), 404

        feat_row = session.execute(
            select(Feature).where(Feature.name == feature_name)
        ).scalar_one_or_none()
        if feat_row is None:
            return jsonify({"error": f"feature {feature_name!r} not found"}), 404

        # Weather features stored at res-6; all others at res-9
        query_h3_id = h3.cell_to_parent(h3_id, ERA5_RESOLUTION) if feat_row.category == WEATHER_CATEGORY else h3_id

        filters = "h3_id = :query_h3_id AND feature_id = :fid"
        params: dict = {"query_h3_id": query_h3_id, "fid": feat_row.feature_id}
        if start_dt:
            filters += " AND timestamp >= :start"
            params["start"] = start_dt
        if end_dt:
            filters += " AND timestamp <= :end"
            params["end"] = end_dt

        sql = text(f"""
            SELECT timestamp, value
            FROM observation
            WHERE {filters}
            ORDER BY timestamp ASC
        """)  # noqa: S608 — filters are parameterised, no injection risk
        rows = session.execute(sql, params).mappings().all()

        return jsonify({
            "h3_id": h3_id,
            "feature": feature_name,
            "unit": feat_row.unit or "",
            "data": [
                {"timestamp": row["timestamp"].isoformat(), "value": row["value"]}
                for row in rows
            ],
        })

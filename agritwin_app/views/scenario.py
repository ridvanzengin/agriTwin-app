import json
from flask import render_template, abort
from sqlalchemy import text
from . import bp
from ..db.session import get_session


@bp.get("/scenarios")
def scenario_list_view():
    return render_template("scenario_list.html")


@bp.get("/scenarios/new")
def scenario_new_view():
    return render_template("scenario_new.html")


@bp.get("/scenarios/<int:scenario_id>")
def scenario_result_view(scenario_id: int):
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT name, status,
                       ST_AsGeoJSON(polygon_geom) AS polygon_geojson,
                       ST_XMin(polygon_geom::geometry) AS west,
                       ST_YMin(polygon_geom::geometry) AS south,
                       ST_XMax(polygon_geom::geometry) AS east,
                       ST_YMax(polygon_geom::geometry) AS north
                FROM scenario WHERE scenario_id = :id
            """),
            {"id": scenario_id},
        ).one_or_none()

    if row is None:
        abort(404)

    polygon_bounds = [
        [row.west, row.south],
        [row.east, row.north],
    ] if row.polygon_geojson else None

    return render_template(
        "scenario_result.html",
        scenario_id=scenario_id,
        scenario_name=row.name,
        scenario_status=row.status,
        polygon_geojson=row.polygon_geojson,
        polygon_bounds=json.dumps(polygon_bounds),
    )

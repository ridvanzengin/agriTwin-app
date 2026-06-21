from flask import render_template
from . import bp


@bp.get("/")
def map_view():
    return render_template("map.html")

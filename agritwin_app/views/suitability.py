from flask import render_template
from . import bp


@bp.get("/suitability")
def suitability_view():
    return render_template("suitability.html")

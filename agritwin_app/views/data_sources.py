from flask import render_template
from . import bp


@bp.get("/data-sources")
def data_sources_view():
    return render_template("data_sources.html")

from flask import render_template
from . import bp


@bp.get("/docs")
def docs_view():
    return render_template("docs.html")

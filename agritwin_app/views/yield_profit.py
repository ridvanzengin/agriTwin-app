from flask import render_template
from . import bp


@bp.get("/yield-profit")
def yield_profit_view():
    return render_template("yield_profit.html")

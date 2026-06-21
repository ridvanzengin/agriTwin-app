from flask import jsonify
from sqlalchemy import select
from . import bp
from ..db.session import get_session
from ..db.models import Feature


@bp.get("/features")
def list_features():
    session = next(get_session())
    rows = session.execute(
        select(Feature).order_by(Feature.category, Feature.name)
    ).scalars().all()
    return jsonify([
        {
            "name": f.name,
            "category": f.category,
            "unit": f.unit or "",
            "description": f.description or "",
        }
        for f in rows
    ])

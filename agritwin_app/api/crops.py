from flask import Blueprint, jsonify
from sqlalchemy import select
from ..db.session import get_session
from ..db.models import Crop

bp = Blueprint("crops", __name__, url_prefix="/api")


@bp.get("/crops")
def list_crops():
    with get_session() as session:
        crops = session.execute(select(Crop).order_by(Crop.name)).scalars().all()
        return jsonify([
            {"crop_id": c.crop_id, "name": c.name, "scientific_name": c.scientific_name}
            for c in crops
        ])

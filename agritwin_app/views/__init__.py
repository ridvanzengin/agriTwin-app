from flask import Blueprint

bp = Blueprint("views", __name__)

from . import map, suitability  # noqa: E402, F401

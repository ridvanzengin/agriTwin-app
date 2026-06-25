from flask import Blueprint

bp = Blueprint("views", __name__)

from . import map, suitability, scenario  # noqa: E402, F401

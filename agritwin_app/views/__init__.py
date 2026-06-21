from flask import Blueprint

bp = Blueprint("views", __name__)

from . import map  # noqa: E402, F401

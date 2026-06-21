from flask import Blueprint

bp = Blueprint("api", __name__, url_prefix="/api")

from . import cells, features  # noqa: E402, F401

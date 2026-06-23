"""Celery worker entry point.

Used by docker-compose worker service:
    celery -A agritwin_app.worker worker --loglevel=info
"""
from agritwin_app import create_app

flask_app = create_app()
celery_app = flask_app.extensions["celery"]

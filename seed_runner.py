#!/usr/bin/env python3
"""Standalone seed runner — called by load.sh after all ETL stages complete.

Initialises the DB and Celery connections from environment variables (same
ones the loader service already has), then delegates to seed_demo_scenarios().
"""
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(message)s")

db_url = os.environ["DATABASE_URL"]
broker = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
backend = os.environ.get("CELERY_RESULT_BACKEND", broker)

from agritwin_app.db.session import init_db
from agritwin_app.tasks import init_celery
from agritwin_app.seed import seed_demo_scenarios

init_db(db_url)
init_celery(broker, backend)
seed_demo_scenarios()

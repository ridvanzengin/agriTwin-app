from sqlalchemy import text

from agritwin_app.db import session as db_session


def test_init_db_configures_a_bounded_pool(app):
    # Regression guard: this TimescaleDB instance is shared with another app
    # (IoTOps) on a small VM with only ~22 usable connection slots.
    # SQLAlchemy's own default (pool_size=5, max_overflow=10) is sized for a
    # dedicated database, and gunicorn spawns one engine per worker process --
    # left at the default, that's up to 15 connections x however many
    # workers. See db/session.py's init_db() for the full reasoning.
    engine = db_session._engine
    assert engine is not None
    assert engine.pool.size() == 2


def test_dispose_engine_is_safe_before_and_after_use(app):
    # This is exactly what gunicorn's post_fork hook calls in every worker
    # (see deploy/agritwin/gunicorn.conf.py) -- must never raise, and the
    # pool must still work afterwards (it lazily reopens connections).
    db_session.dispose_engine(close=False)

    with db_session.get_session() as session:
        assert session.execute(text("SELECT 1")).scalar() == 1

    db_session.dispose_engine(close=False)

    with db_session.get_session() as session:
        assert session.execute(text("SELECT 1")).scalar() == 1

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_engine = None
_SessionLocal = None


def init_db(database_url: str) -> None:
    global _engine, _SessionLocal
    _engine = create_engine(
        database_url,
        pool_pre_ping=True,
        # This TimescaleDB instance is shared with another app (IoTOps) on a
        # small VM -- only 25 max_connections total, ~22 usable by
        # non-superuser roles. SQLAlchemy's own default (pool_size=5,
        # max_overflow=10 -> up to 15 connections per engine) is sized for a
        # dedicated database, and gunicorn spawns one engine per worker
        # process -- unbounded, that's 15 x workers. Bounded small here for
        # the same reason IoTOps's own asyncpg pool is (see that repo's
        # app/database.py).
        pool_size=2,
        max_overflow=2,
        # Without this, a low-traffic gunicorn worker that never hits
        # gunicorn.conf.py's own max_requests recycling just holds its
        # pooled connections open indefinitely -- recycle periodically
        # instead of relying solely on worker restarts.
        pool_recycle=1800,
    )
    _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def dispose_engine(close: bool = True) -> None:
    """Discard all connections currently held by the engine's pool.

    Called from gunicorn's post_fork hook (deploy/agritwin/gunicorn.conf.py)
    with close=False. gunicorn.conf.py sets preload_app=True, so init_db()
    runs once in the gunicorn *master* before it forks worker processes --
    every worker then inherits the master's already-open pooled connections
    via fork() instead of opening its own. This is SQLAlchemy's documented
    fork-safety hazard ("Using Connection Pools with Multiprocessing or
    os.fork()"): left alone, connections end up shared across worker
    processes in ways that don't get cleanly tracked or closed, which is
    exactly how this leaked -- idle connections accumulating over days,
    eventually exhausting the shared instance's connection cap.

    close=False abandons the inherited connections without closing their
    sockets from this (child) process -- closing them here would also
    sever them for the parent/sibling workers that share the same
    inherited file descriptors. The pool then lazily opens fresh,
    worker-owned connections on next use.
    """
    if _engine is not None:
        _engine.dispose(close=close)


@contextmanager
def get_session():
    if _SessionLocal is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()

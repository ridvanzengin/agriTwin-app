from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_engine = None
_SessionLocal = None


def init_db(database_url: str) -> None:
    global _engine, _SessionLocal
    _engine = create_engine(database_url, pool_pre_ping=True)
    _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


@contextmanager
def get_session():
    if _SessionLocal is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()

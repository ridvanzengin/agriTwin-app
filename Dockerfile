FROM python:3.11-slim

WORKDIR /app

# ── System deps ───────────────────────────────────────────────────────────────
# postgresql-client provides pg_isready, used in migrate.sh to wait for the DB
# when it lives in a separate compose project (production multi-app setup).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# ── App runtime deps ──────────────────────────────────────────────────────────
COPY agriTwin-app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── ETL db-load path deps ─────────────────────────────────────────────────────
# Heavy geo stack (geopandas, rasterio, xarray…) is NOT needed here.
# h3 and shapely ARE needed: build-parent-cells and aggregate use them.
RUN pip install --no-cache-dir \
    "pandas>=2.1" \
    "pyarrow>=14.0" \
    "typer[all]>=0.12" \
    "python-dotenv>=1.0" \
    "h3>=4.0" \
    "shapely>=2.0" \
    "celery[redis]>=5.3" \
    "redis>=5.0" \
    "gunicorn>=21.2" \
    "gunicorn[gthread]>=21.2"

# ── ETL source (baked in — data/ is volume-mounted at runtime) ───────────────
# Copying individual directories avoids including .venv/, data/, tests/, etc.
COPY agriTwin-etl/agritwin_etl  /agritwin-etl/agritwin_etl
COPY agriTwin-etl/alembic       /agritwin-etl/alembic
COPY agriTwin-etl/alembic.ini   /agritwin-etl/alembic.ini
COPY agriTwin-etl/pyproject.toml /agritwin-etl/pyproject.toml
RUN pip install --no-cache-dir --no-deps /agritwin-etl

# ── App source ────────────────────────────────────────────────────────────────
COPY agriTwin-app/. /app
RUN pip install --no-cache-dir --no-deps -e /app

COPY deploy/agritwin/gunicorn.conf.py /app/gunicorn.conf.py

RUN chmod +x /app/migrate.sh /app/load.sh

EXPOSE 5000
# Default command: run the Flask dev server.
# docker-compose overrides this per-service (migrate.sh / load.sh).
CMD ["flask", "--app", "agritwin_app", "run", "--host", "0.0.0.0"]

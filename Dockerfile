FROM python:3.11-slim

WORKDIR /app

# ── App runtime deps ──────────────────────────────────────────────────────────
COPY agriTwin-app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── ETL db-load path deps ─────────────────────────────────────────────────────
# The ETL's heavy geo stack (geopandas, rasterio, xarray…) is NOT needed here:
# the db-load CLI only imports pandas / pyarrow / psycopg / sqlalchemy / typer.
RUN pip install --no-cache-dir \
    "pandas>=2.1" \
    "pyarrow>=14.0" \
    "typer[all]>=0.12" \
    "python-dotenv>=1.0"

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

EXPOSE 5000
ENTRYPOINT ["/app/entrypoint.sh"]

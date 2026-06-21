# CLAUDE.md — agritwin-app

This file is the working agreement for Claude Code in this repository. Read it before making structural changes.

## What this repo is

AgriTwin's web application. A Flask + MapLibre tool that reads from the PostgreSQL data lake built by `agritwin-etl` and lets users browse H3 resolution-9 cells across Konya Province, inspect their environmental profiles (elevation, soil, weather history, NDVI), and — in later phases — run crop suitability scoring and scenario simulation.

**Phase 2 goal (first sprint):** display all H3 cells on a map; click any cell to see its full environmental profile.

## What this repo is NOT

- Not an ETL pipeline. No downloading, parsing, or Parquet writing. That lives in `agritwin-etl`.
- No Alembic migrations for ETL-owned tables (`data_source`, `spatial_cell`, `feature`, `observation`, `crop`, `crop_requirement`, `commodity_price`, `production_cost`, `ingestion_run`, `crop_statistics`). This repo reads those tables but never migrates them.
- This repo's Alembic chain manages only app-owned tables: `scenario`, `scenario_override`, `suitability_score`, `yield_prediction`, `profit_projection`. Phase 2 creates none of these yet.

## Tech stack

- Python 3.11+, Flask 3.x, SQLAlchemy 2.x, GeoAlchemy2
- Jinja2 templates (server-rendered HTML)
- MapLibre GL JS loaded from CDN — no npm, no build step
- Vanilla JS + Fetch API for all interactivity
- PostgreSQL + PostGIS + TimescaleDB (populated by `agritwin-etl`)
- Docker Compose for local Postgres (Flask itself runs via `flask run`)
- pytest

## Key architecture decisions (already made — don't relitigate without discussion)

### bbox-GeoJSON for Phase 2 map tiles

346,787 H3 res-9 cells. Returning all as a single GeoJSON blob would be ~50 MB — unusable. Instead `/api/cells` accepts a `bbox` query parameter and returns only cells whose geometry intersects the current viewport. MapLibre re-fetches on every `moveend` event. At a comfortable zoom over Konya, a typical viewport covers 2,000–8,000 cells — a manageable payload.

Documented fallback if this proves too slow: pre-generate a PMTiles file from `spatial_cell` data using `tippecanoe` and serve it statically. Don't implement PMTiles preemptively — start with bbox-GeoJSON and only switch if performance is actually a problem.

### No server-side computation at request time

All values served to the frontend are read from the database. Phase 2 is pure read-only display of what `agritwin-etl` produced. Suitability scoring and scenario simulation (Phases 3–4) will be computed as background tasks and written to app-owned tables, then read back — never computed on-the-fly per HTTP request.

### One Flask app, two Blueprints

- `api` Blueprint — JSON responses at `/api/*`, consumed by frontend JS
- `views` Blueprint — HTML responses, renders Jinja2 templates

This keeps route registration and response format clearly separated.

### Alembic version table renamed

Both repos share the same PostgreSQL database. `agritwin-etl` occupies the default `alembic_version` table. This repo's `alembic/env.py` sets `version_table = "alembic_version_app"` to avoid collision.

## Repository layout

```
agritwin-app/
  pyproject.toml
  docker-compose.yml           # Postgres with PostGIS + TimescaleDB (same image as agritwin-etl)
  .env.example
  alembic/
    env.py                     # version_table = "alembic_version_app"
    versions/                  # app-owned table migrations only (empty until Phase 3)
  agritwin_app/
    __init__.py                # Flask app factory: create_app()
    config.py                  # Pydantic BaseSettings, reads .env
    db/
      session.py               # SQLAlchemy engine + SessionLocal
      models.py                # All models: ETL tables (read-only) + app-owned tables
    api/
      __init__.py              # api Blueprint registration
      cells.py                 # GET /api/cells, /api/cells/<h3_id>, /api/cells/<h3_id>/timeseries
      features.py              # GET /api/features
    views/
      __init__.py              # views Blueprint registration
      map.py                   # GET / → renders map.html
    templates/
      base.html                # HTML boilerplate, MapLibre CDN links
      map.html                 # map container + sidebar panel
    static/
      js/
        map.js                 # MapLibre init, bbox fetch on moveend, layer setup
        panel.js               # cell click → sidebar populate + charts
      css/
        app.css
  tests/
    conftest.py                # Flask test client, DB session fixture
    test_api_cells.py
    test_api_features.py
```

## Local development setup

### Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"          # installs Flask, SQLAlchemy, alembic, pytest, etc.
```

The venv is at `.venv/` (gitignored). Always activate before running Flask or pytest.

### Running the app

```bash
cp .env.example .env             # fill in FLASK_SECRET_KEY
source .venv/bin/activate
flask --app agritwin_app run --debug
```

### Database setup

The schema and data are produced by `agritwin-etl` (repo at `~/personal/agritwin-etl`).
Run all commands **from the ETL repo directory** — alembic uses relative `script_location`.

```bash
# 1. Start Postgres
docker compose up -d

# 2. Activate this repo's venv (agritwin-etl is installed into it)
source .venv/bin/activate

# 3. Install agritwin-etl into the same venv
pip install -e ~/personal/agritwin-etl

# 4. Enable PostGIS (one-time; timescaledb is already enabled by the image)
docker exec agritwin-app-db-1 psql -U agritwin -d agritwin \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 5. Run ETL schema migrations (must run from ETL repo dir)
cd ~/personal/agritwin-etl
DATABASE_URL=postgresql+psycopg://agritwin:agritwin@localhost:5433/agritwin \
  alembic upgrade head

# 6. Load all processed Parquet data (~20–40 min for 163M rows)
DATABASE_URL=postgresql+psycopg://agritwin:agritwin@localhost:5433/agritwin \
  agritwin-etl db-load

# 7. Run this app's own Alembic chain (no-op in Phase 2)
cd ~/personal/agritwin-app
alembic upgrade head
```

Steps 3–6 are one-time setup. Step 7 runs whenever this repo adds a new migration.

> **If you need to re-run db-load from scratch**, truncate with sequence reset so auto-increment IDs stay consistent:
> ```sql
> TRUNCATE data_source, feature, crop, spatial_cell, crop_requirement,
>          crop_statistics, commodity_price, production_cost CASCADE
> RESTART IDENTITY;
> ```
> Plain `TRUNCATE ... CASCADE` (without `RESTART IDENTITY`) leaves sequences advanced,
> so re-inserted rows get IDs that don't match what subsequent FK-joining tables expect.

### Known agritwin-etl bugs fixed (already patched in that repo)

These bugs were found and fixed during the first Phase 2 session — do **not** re-apply:

| File | Fix |
|---|---|
| `db/load.py` | Added `_load_data_source()` — casts `download_date` string → Python `date` |
| `store/parquet.py` | Per-file read (avoids cross-file schema crash); strips tz-aware timestamps; converts string timestamp columns to `datetime64[ns]` |
| `data/processed/data_source/data.parquet` | Added missing `FAOSTAT`, `FAOSTAT-PP`, `TAGEM` source rows |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://agritwin:agritwin@localhost:5433/agritwin` | Same DB as agritwin-etl |
| `FLASK_SECRET_KEY` | — | Required; set any random string for local dev |
| `FLASK_DEBUG` | `false` | Set `true` for dev |

See `.env.example` for the full list.

## Conventions

- Flask app is created via `create_app()` factory in `agritwin_app/__init__.py`. Config is injected; never import `app` globally.
- All database access goes through the SQLAlchemy session from `db/session.py`. No raw `psycopg` connections.
- GeoJSON serialization: use `ST_AsGeoJSON(geometry)` in the query and `json.loads()` in Python — don't re-serialize with shapely or geopandas.
- API responses use `flask.jsonify` for dicts/lists and `flask.Response` with `mimetype="application/geo+json"` for GeoJSON FeatureCollections.
- Tests use a real database (test schema, not mocks). Never mock the DB session in tests.

## Testing

Run `pytest`. Tests hit a real Postgres — either the local docker-compose instance or a separate test DB. Never call external APIs from tests.

```bash
pip install -e ".[dev]"
docker-compose up -d
pytest
```

## Phase 2 definition of done

- [ ] `flask run` starts the dev server; `GET /` returns a Jinja2-rendered page with a MapLibre map centered on Konya Province (lon 32.5, lat 38.0, zoom 9)
- [ ] `GET /api/cells?bbox=w,s,e,n` returns a GeoJSON FeatureCollection of cells in the viewport
- [ ] `GET /api/cells?bbox=...&feature=ndvi` adds `value` + `value_unit` to each cell's properties
- [ ] Cells render as a polygon fill layer on the map, colored by a default feature (elevation)
- [ ] A feature selector dropdown switches the color layer (elevation, ndvi, temperature_2m, soil_ph_0-5cm)
- [ ] Clicking a cell opens a sidebar showing: elevation/slope/aspect, latest value per feature, NDVI timeseries chart, monthly temperature + precipitation chart
- [ ] `GET /api/cells/<h3_id>` returns the full cell profile as JSON
- [ ] `GET /api/cells/<h3_id>/timeseries?feature=ndvi` returns timestamped values as JSON
- [ ] `GET /api/features` returns the feature list
- [ ] pytest suite covers all API endpoints

## Things to avoid

- Don't add ingest logic, Parquet writing, or `agritwin-etl` CLI commands here.
- Don't run Alembic against ETL-owned tables.
- Don't add suitability scoring or scenario simulation until Phase 2 is complete and tested.
- Don't use React, Vue, or any JS framework — vanilla JS only.
- Don't use npm or a JS build step — MapLibre loaded from CDN.
- Don't add user authentication until it's explicitly needed.
- Don't compute results on the fly at request time — read from the DB; write computed results to tables as background tasks.

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
- Docker Compose (four services: db, migrate, web, loader — one command starts everything)
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
  docker-compose.yml           # Four services: db, migrate, web, loader — run from this directory
  Dockerfile                   # Build context is .. (monorepo root); bakes in ETL source, mounts data/ at runtime
  migrate.sh                   # Runs both Alembic chains (ETL + app), then exits
  load.sh                      # Bulk-loads all Parquet tables in FK-safe order, then exits
  .env.example
  alembic/
    env.py                     # version_table = "alembic_version_app"
    versions/                  # app-owned table migrations (0001_create_app_tables.py created in Phase 3)
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

### Option A: Docker (recommended)

Both repos live as subdirectories of the monorepo root (`agritwin/agriTwin-app/` and `agritwin/agriTwin-etl/`). Always run `docker compose` from **`agriTwin-app/`** — the build context `..` resolves to the monorepo root, which contains both repos.

The `.dockerignore` that controls what gets sent to the Docker daemon lives at the **monorepo root** (not here). It excludes `agriTwin-etl/data/`, `.pgdata/`, `.venv/`, etc. Never add a local `.dockerignore` here — it will be ignored because Docker reads from the build context root.

The loader service volume-mounts `../agriTwin-etl/data/processed` (relative to `agriTwin-app/`, which resolves to the monorepo's ETL data directory).

```bash
cp .env.example .env             # set FLASK_SECRET_KEY (any string for local dev)
docker compose up --build -d
```

This starts four services in dependency order:

| Service | What it does | Exits? |
|---|---|---|
| `db` | PostgreSQL + PostGIS + TimescaleDB on port 5433 | stays up |
| `migrate` | Applies both Alembic chains (ETL's + this app's), then exits | yes |
| `web` | Flask app on port 5001 (starts after `migrate`) | stays up |
| `loader` | Bulk-loads all Parquet data (~5–10 min via COPY FROM STDIN), then exits | yes |

Flask is available at **http://localhost:5001** while the loader runs — the map appears immediately and data fills in as tables load.

```bash
docker compose logs -f loader   # watch data load
docker compose logs -f web      # watch Flask startup
```

### Option B: Host flask run (for fast iteration on templates/JS)

Requires the DB to already be running and seeded (run Option A first, then stop the `web` container).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env             # set DATABASE_URL and FLASK_SECRET_KEY
flask --app agritwin_app run --debug
```

The venv is at `.venv/` (gitignored). Always activate before running `flask` or `pytest`.

### Re-seeding from scratch

If you need to wipe and reload all data:

```sql
TRUNCATE data_source, feature, crop, spatial_cell, crop_requirement,
         crop_statistics, commodity_price, production_cost CASCADE
RESTART IDENTITY;
```

Then `docker compose up -d` — the loader is idempotent (skips tables that already have rows).

> Plain `TRUNCATE ... CASCADE` (without `RESTART IDENTITY`) leaves sequences advanced,
> so re-inserted rows get IDs that don't match what subsequent FK-joining tables expect.

### Known agritwin-etl bugs fixed (already patched in that repo)

These bugs were found and fixed during Phase 2 — do **not** re-apply:

| File | Fix |
|---|---|
| `db/load.py` | `_load_data_source()` — casts `download_date` string → Python `date`; idempotent (skips existing names) |
| `db/load.py` | `_load_observation_files()` — COPY FROM STDIN (10–30× faster than row-by-row insert) |
| `db/load.py` | `_load_production_cost()` — date cast for `effective_date` |
| `db/load.py` | `_load_spatial_cell()` — batched executemany (1000/batch), WKT as bound param |
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

## Phase 2 definition of done — COMPLETE ✅

All 19 pytest tests pass. Verified end-to-end against the fully-loaded DB.

**Phase 2 core (map display + cell profile):**
- [x] `flask run` starts the dev server; `GET /` returns a Jinja2-rendered page with a MapLibre map centered on Konya Province (lon 32.5, lat 38.0, zoom 9)
- [x] `GET /api/cells?bbox=w,s,e,n` returns a GeoJSON FeatureCollection of cells in the viewport
- [x] `GET /api/cells?bbox=...&feature=ndvi` adds `value` + `value_unit` to each cell's properties
- [x] Cells render as a polygon fill layer on the map, colored by a default feature (elevation)
- [x] A feature selector dropdown switches the color layer (elevation, ndvi, temperature_2m, soil_ph_0-5cm)
- [x] Clicking a cell opens a sidebar showing: elevation/slope/aspect, latest value per feature, NDVI timeseries chart, monthly temperature + precipitation chart
- [x] `GET /api/cells/<h3_id>` returns the full cell profile as JSON
- [x] `GET /api/cells/<h3_id>/timeseries?feature=ndvi` returns timestamped values as JSON
- [x] `GET /api/features` returns the feature list

**Phase 2.5 UI polish (multi-level H3 + clustering):**
- [x] Three zoom-mode map: cluster view (zoom < 8) → res-6 polygons (8–10) → res-9 polygons (≥ 11)
- [x] `GET /api/cells/centroids` returns all res-6 centroids for MapLibre native clustering
- [x] Feature radios embedded inline in sidebar Latest tab cards; panel hidden until cell click
- [x] Tab memory preserved across panel opens (no spurious tab reset)
- [x] Soil/Vegetation rows disabled at res-6 with inline placeholder (ETL only populates those at res-9)
- [x] NaN floats serialized as JSON `null` (prevents SyntaxError on res-6 cells)
- [x] DB session pool exhaustion fixed — `get_session()` uses `@contextmanager`; all callers use `with get_session()`

## Phase 3 definition of done — IN PROGRESS 🚧

**Goal:** Suitability scoring — compute per-cell, per-crop scores from `crop_requirement` data; display on map.

- [x] Alembic migration creates app-owned tables: `suitability_score`, `scenario`, `scenario_override`, `yield_prediction`, `profit_projection` (`alembic/versions/0001_create_app_tables.py`)
- [ ] `agritwin_app/scoring/engine.py` — pure scoring function: reads cell features + crop requirements, returns score 0–1
- [ ] `flask score run [--crop NAME]` CLI command — bulk-scores all res-9 cells, writes to `suitability_score`; idempotent (upsert)
- [ ] `POST /api/score/run` — triggers scoring in a background thread; returns `{"status": "started"}`
- [ ] `GET /api/score/status` — returns `{"status": "running|idle|error", "scored_at": ...}`
- [ ] `GET /api/cells?bbox=...&mode=score&crop=wheat` — cells colored by suitability score (0–1) for the given crop
- [ ] `GET /api/cells/<h3_id>/scores` — returns `[{crop, score, scored_at}]` for all crops for the cell
- [ ] Map: "Suitability" mode toggle + crop dropdown; map colors shift to score palette (0=red → 1=green)
- [ ] Cell panel: "Suitability" tab listing all crop scores as a bar chart
- [ ] pytest covers all new API endpoints (target: ~25 total tests)

## Things to avoid

- Don't add ingest logic, Parquet writing, or `agritwin-etl` CLI commands here.
- Don't run Alembic against ETL-owned tables.
- Don't add scenario simulation or yield/profit prediction until suitability scoring is complete and tested.
- Don't use React, Vue, or any JS framework — vanilla JS only.
- Don't use npm or a JS build step — MapLibre loaded from CDN.
- Don't add user authentication until it's explicitly needed.
- Don't compute results on the fly at request time — read from the DB; write computed results to tables as background tasks.
- Don't add Celery or Redis for background tasks — use Python `threading.Thread`; the scoring job is infrequent and Docker Compose should stay at four services.

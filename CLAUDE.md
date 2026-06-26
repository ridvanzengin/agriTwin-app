# CLAUDE.md — agritwin-app

This file is the working agreement for Claude Code in this repository. Read it before making structural changes.

## What this repo is

AgriTwin's web application. A Flask + MapLibre tool that reads from the PostgreSQL data lake built by `agritwin-etl` and lets users browse H3 resolution-9 cells across Konya Province, inspect their environmental profiles (elevation, soil, weather history, NDVI), and view per-cell crop suitability scores on a dedicated suitability page.

**Current phase:** Phase 4 complete — map + cell inspection (Phase 2), crop suitability page (Phase 3), and scenario simulation (Phase 4) are all shipped. Phase 5 (yield prediction) is next.

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
  docker-compose.yml           # Six services: db, redis, migrate, web, celery_worker, loader — run from this directory
  Dockerfile                   # Build context is .. (monorepo root); bakes in ETL source, mounts data/ at runtime
  migrate.sh                   # Runs both Alembic chains (ETL + app), then exits
  load.sh                      # Bulk-loads all Parquet tables in FK-safe order, seeds demo scenarios, then exits
  seed_runner.py               # Standalone script called by load.sh to seed 4 demo scenarios after ETL data is ready
  .env.example
  alembic/
    env.py                     # version_table = "alembic_version_app"
    versions/                  # 0001_create_app_tables.py, 0002_extend_scenario_for_phase4.py
  agritwin_app/
    __init__.py                # Flask app factory: create_app()
    config.py                  # Pydantic BaseSettings, reads .env
    tasks.py                   # Celery app + compute_scenario_scores task
    seed.py                    # seed_demo_scenarios() — idempotent, called by seed_runner.py
    db/
      session.py               # SQLAlchemy engine + SessionLocal
      models.py                # All models: ETL tables (read-only) + app-owned tables
    api/
      __init__.py              # api Blueprint registration
      cells.py                 # GET /api/cells, /api/cells/<h3_id>, /api/cells/<h3_id>/timeseries
      features.py              # GET /api/features
      suitability.py           # GET /api/suitability/cells, /cells/<h3_id>, /cells/<h3_id>/monthly
      scenario.py              # POST/GET/DELETE /api/scenarios, /api/scenarios/<id>/cells, /status, /requirements
    views/
      __init__.py              # views Blueprint registration
      map.py                   # GET / → renders map.html
      suitability.py           # GET /suitability → renders suitability.html
      scenario.py              # GET /scenarios, /scenarios/new, /scenarios/<id>
    templates/
      base.html                # HTML boilerplate, MapLibre CDN links, navbar
      map.html                 # monitoring map container + sidebar panel
      suitability.html         # suitability map + two-tab sidebar (crop scores + monthly chart)
      scenario_list.html       # table of saved scenarios with status badges + polling
      scenario_new.html        # split layout: map draw (60%) + form (40%)
      scenario_result.html     # split map: baseline left / scenario right; panel with baseline vs scenario scores
    static/
      js/
        map.js                 # MapLibre init, 5-level zoom ladder, bbox fetch, panel
        panel.js               # monitoring cell click → sidebar populate + charts
        suitability_map.js     # MapLibre choropleth at res-9; score color ramp; bbox fetch on moveend
        suitability_panel.js   # Tab 1: 8-crop radio + progress bars; Tab 2: Chart.js band chart
        scenario_new.js        # MapLibre + MapboxGL Draw; polygon validation; POST to /api/scenarios
        scenario_result.js     # dual-map sync; baseline vs scenario score panel; monthly requirement chart
      css/
        app.css
  tests/
    conftest.py                # Flask test client, DB session fixture
    test_api_cells.py
    test_api_features.py
    test_api_suitability.py    # covers all three suitability API endpoints
    test_api_scenario.py       # covers scenario CRUD + status + cell endpoints
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

This starts six services in dependency order:

| Service | What it does | Exits? |
|---|---|---|
| `db` | PostgreSQL + PostGIS + TimescaleDB on port 5433 | stays up |
| `redis` | Redis 7 on port 6379 — Celery broker + result backend | stays up |
| `migrate` | Applies both Alembic chains (ETL's + this app's), then exits | yes |
| `web` | Flask app on port 5001 (starts after `migrate`) | stays up |
| `celery_worker` | Celery worker — processes scenario scoring tasks asynchronously | stays up |
| `loader` | Bulk-loads all Parquet data (~5–10 min via COPY FROM STDIN), seeds demo scenarios, then exits | yes |

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

## Phase 3 definition of done — COMPLETE ✅ (2026-06-25)

**Goal:** Suitability scoring — display per-cell, per-crop scores on a dedicated suitability page.

**Architecture:**
- Scores are **computed in `agritwin-etl`** (not here): `agritwin-etl score` writes `suitability_score.parquet`; the loader loads it into `suitability_score`. This app is **read-only** for scores.
- Suitability lives on its **own page** (`GET /suitability`) with its own map, its own sidebar, and its own JS files (`suitability_map.js`, `suitability_panel.js`). Zero changes to `map.js`/`panel.js`.
- Scoring uses **monthly averages**, not latest-value snapshots: each month's ERA5 cell mean vs. that month's crop requirement. Soil/terrain use a single year-round comparison.
- Suitability map is **res-9 only** — field-level analysis tool; no multi-resolution zoom ladder.

**Note on `actual` values in Tab 2:** The `/api/suitability/cells/<h3_id>/monthly` endpoint fetches actual climate values live from the `observation` table. Soil features show "—" until SoilGrids observations finish loading in `load.sh` Stage 5.

### Suitability page UI specification

#### Overall layout

```
┌─────────────────────────────────────────────────────────────┐
│  navbar: [AgriTwin logo]  [Monitoring]  [Suitability ←here] │
├─────────────────────────────────────────────────────────────┤
│                                          │                   │
│   MapLibre map (res-9 cells,             │  Right sidebar    │
│   colored by suitability score)          │  (hidden until    │
│                                          │   cell click)     │
│                                          │                   │
└─────────────────────────────────────────┴───────────────────┘
```

#### Map

- Opens at zoom ~12 (res-9 visible immediately — no zoom ladder, no clustering).
- Center: Konya Province (same as monitoring map).
- Cells colored by suitability score for the **currently selected crop** (radio in sidebar Tab 1).
- Color ramp: **0.0 = red → 0.5 = yellow → 1.0 = green** (traffic-light scale, standard agronomic convention).
- Default crop on load: **Wheat** (most common in Konya; scores are pre-computed so no delay).
- Clicking a cell opens the right sidebar and highlights that cell.
- On `moveend`, fetches `GET /api/suitability/cells?bbox=...&crop=<selected_crop>` to color the viewport.

#### Right sidebar

Hidden on page load; appears when a cell is clicked. Same resize handle as the monitoring panel (`localStorage` persists width). Two tabs:

---

**Tab 1 — Crop Scores** (default active tab)

Shows the suitability score for all 8 crops for the clicked cell.

Layout per crop row:
```
○ Wheat        ████████████████░░░░  0.82
○ Barley       █████████████░░░░░░░  0.68
○ Sugar Beet   ██████░░░░░░░░░░░░░░  0.34
...
```

- 8 rows, one per crop (Wheat, Barley, Sugar Beet, Sunflower, Maize, Chickpea, Lentil, Cotton).
- Each row: radio button + crop name + CSS progress bar + numeric score (2 decimal places).
- **Radio button is the crop selector** — clicking it changes the map coloring to that crop's scores.
  No separate dropdown needed; the radio serves both purposes.
- Default selected: Wheat.
- Progress bar is pure CSS (`width: calc(score * 100%)`); no Chart.js needed for this tab.
- Scores fetched from `GET /api/suitability/cells/<h3_id>` on cell click.

---

**Tab 2 — Monthly Detail**

Shows how the cell's actual monthly climate compares to the selected crop's requirements for one weather feature at a time.

- **Feature selector**: a `<select>` dropdown above the chart with the weather features that have monthly requirements for the current crop:
  `Temperature (°C)` | `Precipitation (mm)` | `Solar Radiation (MJ/m²)` | `Min Temperature (°C)`
  (Only show features that exist in crop_requirement for this crop.)
- **Chart (Chart.js)**: x-axis = months Jan–Dec; two datasets:
  1. **Shaded range band**: ideal min → ideal max for each month (only growing-season months have data; off-season months show no band). Rendered as a semi-transparent green fill between two lines.
  2. **Actual line**: actual monthly mean value for this cell (averaged across ERA5 2018–2023). Dots on each month. Line color: green where inside the ideal range, red where outside.
- Below the chart: a one-line summary, e.g. *"7 of 9 growing-season months within ideal range."*
- Data fetched from `GET /api/suitability/cells/<h3_id>/monthly?crop=<selected_crop>`.
  Response shape: `{ feature: "temperature_2m", months: [ { month: 1, actual: 0.8, req_min: -10, req_optimal: 0, req_max: 7 }, ... ] }`
  Only months with a requirement row are included; the chart leaves gaps for non-growing months.

---

- [x] Alembic migration creates app-owned tables: `suitability_score`, `scenario`, `scenario_override`, `yield_prediction`, `profit_projection` (`alembic/versions/0001_create_app_tables.py`)
- [x] `GET /suitability` route + `suitability.html` template — own navbar item, MapLibre container, right sidebar (2 tabs)
- [x] `agritwin_app/views/suitability.py` — renders suitability page
- [x] `agritwin_app/api/suitability.py` — three endpoints:
  - `GET /api/suitability/cells?bbox=w,s,e,n&crop=<name>` — GeoJSON FeatureCollection with `score` (0–1) property
  - `GET /api/suitability/cells/<h3_id>` — returns `[{crop_name, score, scored_at}]` for all 8 crops
  - `GET /api/suitability/cells/<h3_id>/monthly?crop=<name>` — monthly actual means + requirements for all weather features (feeds Tab 2)
- [x] `suitability_map.js` — MapLibre init at res-9 zoom; score color ramp (0=red → 1=green); bbox fetch on moveend; no zoom ladder
- [x] `suitability_panel.js` — Tab 1: 8 crops with radio buttons + CSS progress bars (score as 0–100%); clicking radio recolors map. Tab 2: Chart.js band chart (shaded ideal range + actual monthly mean line) with feature selector
- [x] `base.html` — "Suitability" navbar link added
- [x] `load.sh` — Stage 4 added for suitability baseline scores
- [x] pytest covers all three suitability API endpoints

## Phase 4 definition of done — COMPLETE ✅ (2026-06-26)

**Goal:** Scenario simulation — let the user draw a polygon, apply environmental overrides (precipitation, temperature, soil pH), re-score cells asynchronously, and compare against the baseline.

**Architecture:**
- Scenario scoring runs in a **Celery worker** (`tasks.py`), not in a Flask request. The web service dispatches the task; the worker writes results to `suitability_score` with a non-null `scenario_id`.
- **Redis** (new service) is the Celery broker and result backend.
- Scores are stored identically to baseline scores — the only difference is `scenario_id IS NOT NULL`. The scenario result page reads these the same way the suitability page reads baseline scores.
- **Demo scenarios** are seeded by `seed_runner.py`, called at the end of `load.sh` (Stage 6) — after all ETL data is loaded — so the Celery worker can score them with complete data.

**New tables:** `suitability_score.scenario_id` (column added in Phase 3 migration 0001), `scenario.polygon_geom` + `scenario.overrides` + `scenario.task_id` + `scenario.status` + `scenario.scored_at` (added in migration 0002)

- [x] Alembic migration `0002_extend_scenario_for_phase4.py` — adds `polygon_geom`, `overrides`, `task_id`, `status`, `scored_at` to `scenario`
- [x] `docker-compose.yml` — added `redis` service (broker) and `celery_worker` service (runs `compute_scenario_scores`)
- [x] `agritwin_app/tasks.py` — `compute_scenario_scores` Celery task: loads polygon cells, applies override deltas, calls ETL scoring engine, bulk-inserts `suitability_score` rows, marks scenario `completed` or `failed`
- [x] `agritwin_app/seed.py` + `seed_runner.py` — idempotent seeding of 4 demo scenarios (by name); dispatches Celery tasks; called from `load.sh` Stage 6
- [x] `agritwin_app/api/scenario.py` — 7 endpoints:
  - `POST /api/scenarios` — create scenario (name, WKT polygon, overrides dict); validates polygon; dispatches Celery task
  - `GET /api/scenarios` — list all scenarios ordered by `created_at DESC`
  - `GET /api/scenarios/<id>/status` — poll task status + `scored_at`
  - `DELETE /api/scenarios/<id>` — delete scenario + cascaded scores
  - `GET /api/scenarios/<id>/cells?bbox=...&crop=...` — GeoJSON FeatureCollection of scenario scores
  - `GET /api/scenarios/<id>/cells/<h3_id>` — baseline vs. scenario score for all 8 crops for one cell
  - `GET /api/scenarios/<id>/cells/<h3_id>/requirements?crop=...` — monthly baseline + scenario values vs. crop requirements (feeds the override chart)
- [x] `agritwin_app/views/scenario.py` — three view routes: `/scenarios`, `/scenarios/new`, `/scenarios/<id>`
- [x] `scenario_list.html` — table of scenarios with status badge, progress bar, live polling every 3 s for pending/running rows
- [x] `scenario_new.html` + `scenario_new.js` — split layout (60/40): MapLibre map with MapboxGL Draw polygon tool (left) + scenario name + override delta fields + submit (right); polygon validated against MAX_CELLS limit before submit
- [x] `scenario_result.html` + `scenario_result.js` — dual-map layout (baseline left, scenario right) synced on pan/zoom; right sidebar: crop score comparison (baseline vs. scenario score per crop) + monthly requirement chart (baseline line, scenario line, ideal band) for each active override
- [x] `tests/test_api_scenario.py` — covers scenario CRUD, status polling, cell GeoJSON, and per-cell score endpoints

## Things to avoid

- Don't add ingest logic, Parquet writing, or `agritwin-etl` CLI commands here.
- Don't run Alembic against ETL-owned tables.
- Don't add yield prediction or profit projection until scenario simulation is stable.
- Don't use React, Vue, or any JS framework — vanilla JS only.
- Don't use npm or a JS build step — MapLibre loaded from CDN.
- Don't add user authentication until it's explicitly needed.
- Don't compute baseline suitability scores here — baseline scores are computed by `agritwin-etl score` and loaded by the loader. Scenario re-scoring (with overrides applied) is the only scoring that happens in this repo, via `tasks.py`.
- Don't add a `scoring/` module to this repo — all baseline scoring logic lives in `agritwin-etl`. `compute_scenario_scores` calls `agritwin_etl.scoring.engine.score_cells` directly.
- Don't add additional Celery queues or workers — the single `celery_worker` service handles all scenario tasks.

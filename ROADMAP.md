# Roadmap

agritwin-app picks up where agritwin-etl left off. The data lake is built. This repo is responsible for Phase 2 onward.

---

## Phase 2 — Map + cell inspection (COMPLETE)

**Goal:** a working local web tool to visually browse the agriTwin data lake. No analysis, no scoring — just display.

**Stack:** Flask 3, MapLibre GL JS (CDN), vanilla JS, PostGIS

### Checklist

- [x] Flask app factory (`create_app`) + Pydantic config
- [x] SQLAlchemy session + read-only ETL models (`spatial_cell`, `feature`, `observation`, `crop`)
- [x] `GET /api/features` — feature list endpoint
- [x] `GET /api/cells?bbox=w,s,e,n[&feature=name]` — bbox-GeoJSON endpoint
- [x] `GET /api/cells/<h3_id>` — cell environmental profile endpoint
- [x] `GET /api/cells/<h3_id>/timeseries?feature=name` — timeseries endpoint
- [x] `GET /` → Jinja2 `map.html`, MapLibre map centered on Konya Province (lon 32.5, lat 38.0, zoom 9)
- [x] Left-side navigation bar (Monitoring active; Suitability/Scenarios as disabled placeholders)
- [x] Cells render as polygon fill layer, colored by a default feature (elevation)
- [x] Feature selector dropdown — switches color layer between elevation, ndvi, temperature_2m, soil_ph_0-5cm
- [x] Cell hover — tooltip shows h3_id + elevation + current feature value
- [x] Cell click → sidebar panel:
  - [x] Elevation, slope, aspect
  - [x] Latest value for every feature (grouped by category)
  - [x] NDVI timeseries line chart (Chart.js from CDN)
  - [x] Monthly temperature + precipitation bar/line chart
- [x] pytest suite covers all API endpoints with a test database
- [x] DB seeded — all tables loaded (29.5M observations)
- [x] Verify end-to-end: `docker compose up --build -d` → map → cell click → panel data

**Deliverable:** `flask run` → open browser → see the map → click a cell → see its data.

---

## Phase 2.5 — UI Polish + Multi-resolution map (COMPLETE)

**Goal:** fix rendering performance, improve usability, and add zoom-adaptive H3 resolution levels.

### Checklist

- [x] 5-level zoom-adaptive map: cluster (< 5) → res-6 (5–6) → res-7 (7–8) → res-8 (9–10) → res-9 (≥ 11)
- [x] `GET /api/cells?resolution=6|7|8|9` — multi-resolution cell endpoint
- [x] `GET /api/cells/centroids` — res-6 centroids for MapLibre clustering source
- [x] Weather features at res-7/8/9 resolved to res-6 parent at query time (no ERA5 duplication)
- [x] Light basemap default (CARTO Voyager) + dark/light toggle button
- [x] Feature color selector moved from toolbar dropdown → left sidebar radio buttons (all features)
- [x] Grid fill opacity 0.45 so underlying map detail is always visible
- [x] Right panel: two tabs (Latest default / Historic)
- [x] Latest tab: 4 ordered sections — Terrain → Weather → Soil → Vegetation
- [x] Historic tab: NDVI History chart + Temperature & Precipitation chart
- [x] Right panel: drag-to-resize handle (min 300px, max 900px, width persisted to localStorage)
- [x] Feature names: human-readable display names (e.g. "Temperature (2m)", "Organic Carbon (0–5cm)")
- [x] Resolution badge overlay (bottom-left of map) shows current H3 resolution
- [x] Duplicate fetch bug fixed: `_zoomFetched` flag suppresses the `moveend` that MapLibre fires after every `zoomend`

---

## Phase 3 — Crop suitability scoring (COMPLETE ✅ 2026-06-25)

**Goal:** color cells by how suitable they are for a user-selected crop, based on observed environmental conditions vs. agronomic requirements from `crop_requirement`.

**New tables:** `suitability_score`

**Architecture:** Scores are computed in `agritwin-etl` (`agritwin-etl score` → `suitability_score/data.parquet`); this app is read-only. Suitability lives on its own page (`GET /suitability`) with its own map, sidebar, and JS files — zero changes to the monitoring map/panel.

### Checklist

- [x] `suitability_score` SQLAlchemy model + Alembic migration (0001_create_app_tables.py)
- [x] Scoring computed in ETL repo: monthly trapezoidal fuzzy membership; 2.77M rows (346,787 cells × 8 crops); score range 0.049–0.921
- [x] `GET /api/suitability/cells?bbox=w,s,e,n&crop=<name>` — GeoJSON FeatureCollection with `score` per cell
- [x] `GET /api/suitability/cells/<h3_id>` — all 8 crop scores for one cell
- [x] `GET /api/suitability/cells/<h3_id>/monthly?crop=<name>` — monthly actual climate vs. crop requirement for Tab 2 chart
- [x] `GET /suitability` — dedicated suitability page (own navbar item)
- [x] `suitability_map.js` — MapLibre choropleth at res-9; score color ramp (red→yellow→green); bbox fetch on moveend
- [x] `suitability_panel.js` — Tab 1: 8 crop radio buttons + CSS progress bars (clicking radio recolors map); Tab 2: Chart.js band chart (shaded ideal range + actual line) with feature selector
- [x] `base.html` — "Suitability" navbar link added
- [x] `load.sh` — Stage 4 loads baseline scores (~2.77M rows) after spatial cells and before raw observations
- [x] pytest covers all three suitability API endpoints

---

## Phase 4 — Scenario simulation (COMPLETE ✅ 2026-06-26)

**Goal:** let the user draw a polygon on the map, apply additive environmental overrides (precipitation, temperature, soil pH), re-score all res-9 cells within the polygon asynchronously via Celery, and compare scenario scores against the baseline.

**New infrastructure:** Redis (Celery broker), `celery_worker` Docker service

**Schema changes:** `scenario` extended with `polygon_geom`, `overrides` (JSONB), `task_id`, `status`, `scored_at` (migration 0002); `suitability_score.scenario_id` FK was added in Phase 3 migration 0001

### Checklist

- [x] Alembic migration `0002_extend_scenario_for_phase4.py` — extends `scenario` table for polygon + override storage
- [x] `docker-compose.yml` — `redis` + `celery_worker` services added (6 services total)
- [x] `agritwin_app/tasks.py` — `compute_scenario_scores` Celery task: loads polygon cells, applies override deltas to weather/soil observations, re-scores via ETL engine, bulk-inserts scenario `suitability_score` rows
- [x] Scenario creation: `POST /api/scenarios` (WKT polygon + overrides dict → dispatches task); `GET /scenarios/new` → draw-polygon UI with MapboxGL Draw; override delta fields for precipitation, temperature, min temperature, soil pH
- [x] Async status polling: `GET /api/scenarios/<id>/status` — scenario list page polls every 3 s for pending/running rows
- [x] Scenario result page: `GET /scenarios/<id>` → dual-map layout (baseline left, scenario right, synced pan/zoom); sidebar with per-crop baseline vs. scenario score comparison and monthly requirement chart for each active override
- [x] Scenario list: `GET /api/scenarios` ordered by recency; delete with cascade via `DELETE /api/scenarios/<id>`
- [x] Demo scenario seed: 4 pre-built scenarios seeded by `seed_runner.py` at end of `load.sh` (Stage 6), after all ETL data is loaded
- [x] `tests/test_api_scenario.py` — scenario CRUD, status, cell GeoJSON, and per-cell score endpoints

---

## Phase 5 — Yield prediction

**Goal:** translate suitability scores into predicted yield estimates per cell and crop, calibrated against historical FAOSTAT QCL data.

**New tables:** `yield_prediction`

### Checklist

- [ ] Simple yield model: `yield = regional_average_yield × suitability_score × calibration_factor`
- [ ] Calibrate `calibration_factor` per crop against FAOSTAT QCL `yield_value` for Turkey
- [ ] `yield_prediction` model + Alembic migration
- [ ] Task to compute and store predictions for each (cell, crop, scenario)
- [ ] `GET /api/yield?crop=wheat&bbox=...` → yield per cell as GeoJSON
- [ ] Yield map layer

---

## Phase 6 — Economic simulation

**Goal:** convert yield into gross revenue, subtract input costs, and show net profit per cell and crop.

**New tables:** `profit_projection`

### Checklist

- [ ] Revenue = `predicted_yield × commodity_price` (latest from `commodity_price` table)
- [ ] Cost = sum of `production_cost` rows for the crop (per ha)
- [ ] Net profit = revenue − cost
- [ ] `profit_projection` model + Alembic migration
- [ ] `GET /api/profit?crop=wheat&bbox=...` → profit per cell as GeoJSON
- [ ] Profit map layer
- [ ] Crop comparison view: for a clicked cell, which crop yields the highest net profit?

---

## Explicitly deferred (not in this repo's scope)

- Multi-region expansion (beyond Konya Province) — requires re-running agritwin-etl for a larger boundary
- User accounts or multi-tenancy
- Real-time or near-real-time data ingestion
- Export / report generation

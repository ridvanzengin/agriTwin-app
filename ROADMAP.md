# Roadmap

agritwin-app picks up where agritwin-etl left off. The data lake is built. This repo is responsible for Phase 2 onward.

---

## Phase 2 — Map + cell inspection (current sprint)

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
- [ ] DB seeded — `agritwin-etl db-load` in progress; spatial_cell loading (346k rows)
- [ ] Verify end-to-end: `flask run` → map → cell click → panel data

**Deliverable:** `flask run` → open browser → see the map → click a cell → see its data.

---

## Phase 3 — Crop suitability scoring

**Goal:** color cells by how suitable they are for a user-selected crop, based on observed environmental conditions vs. agronomic requirements from `crop_requirement`.

**New tables:** `suitability_score`

### Checklist

- [ ] `suitability_score` SQLAlchemy model + Alembic migration
- [ ] Scoring function: for each cell × crop, compute weighted distance from optimal value per feature
- [ ] CLI command or background task to score all cells × all crops → write `suitability_score` rows
- [ ] `GET /api/suitability?crop=wheat&bbox=w,s,e,n` — returns GeoJSON with score per cell
- [ ] Suitability map layer with graduated color scale (green = suitable → red = unsuitable)
- [ ] Crop selector in UI

---

## Phase 4 — Scenario simulation

**Goal:** let the user override one or more environmental feature values for a set of cells, re-run suitability scoring with those overrides, and compare the result against the baseline.

**New tables:** `scenario`, `scenario_override`

### Checklist

- [ ] `scenario` + `scenario_override` models + Alembic migration
- [ ] Extend `suitability_score` with `scenario_id` FK
- [ ] Scenario creation UI: draw a region, pick a feature, enter an override value (e.g. "irrigation adds 200 mm precipitation")
- [ ] Re-score with overrides applied to selected cells
- [ ] Side-by-side baseline vs. scenario view on the map
- [ ] Scenario list: save, reload, delete

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

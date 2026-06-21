# Schema

## ETL-owned tables (read-only from this repo)

These tables are created and migrated by `agritwin-etl`. This repo reads them via SQLAlchemy models but never migrates them. See `agritwin-etl/docs/SCHEMA.md` for column-level detail and `agritwin-etl/agritwin_etl/db/models.py` for the ORM definitions to copy or import.

| Table | What it holds | Phase 2 use |
|---|---|---|
| `spatial_cell` | 346,787 H3 res-9 cells; h3_id, geometry, elevation, slope, aspect | bbox query, cell profile |
| `feature` | One row per measurable variable (name, category, unit) | feature list, label lookup |
| `observation` | 163.7M rows: (h3_id, feature_id, timestamp, value) — TimescaleDB hypertable | latest values, timeseries |
| `crop` | 8 crops: wheat, barley, sugar beet, sunflower, maize, chickpea, lentil, cotton | Phase 3+ |
| `crop_requirement` | Agronomic min/optimal/max/weight per feature per crop | Phase 3+ |
| `crop_statistics` | FAOSTAT annual yield/harvest area/production, Turkey 2000–2023 | Phase 5+ |
| `commodity_price` | FAOSTAT PP producer prices per crop, 2000–2023 | Phase 6+ |
| `production_cost` | TAGEM input costs per crop (seed, fertilizer, pesticide, machinery, labor, irrigation) | Phase 6+ |
| `data_source` | Provenance of each ingested dataset | reference only |
| `ingestion_run` | ETL run status per source | reference only |

### Key feature names in `observation`

| feature name | category | unit | source |
|---|---|---|---|
| `temperature_2m` | weather | °C | ERA5-Land |
| `precipitation` | weather | mm | ERA5-Land |
| `dewpoint_2m` | weather | °C | ERA5-Land |
| `wind_u_10m` | weather | m/s | ERA5-Land |
| `wind_v_10m` | weather | m/s | ERA5-Land |
| `solar_radiation` | weather | MJ/m² | ERA5-Land |
| `ndvi` | vegetation | — | MODIS |
| `soil_ph_0-5cm` | soil | — | SoilGrids |
| `soil_ph_5-15cm` | soil | — | SoilGrids |
| `soil_organic_carbon_0-5cm` | soil | g/kg | SoilGrids |
| `soil_organic_carbon_5-15cm` | soil | g/kg | SoilGrids |
| `soil_clay_0-5cm` | soil | g/kg | SoilGrids |
| `soil_clay_5-15cm` | soil | g/kg | SoilGrids |
| `soil_sand_0-5cm` | soil | g/kg | SoilGrids |
| `soil_sand_5-15cm` | soil | g/kg | SoilGrids |
| `soil_silt_0-5cm` | soil | g/kg | SoilGrids |
| `soil_silt_5-15cm` | soil | g/kg | SoilGrids |
| `soil_bulk_density_0-5cm` | soil | cg/cm³ | SoilGrids |
| `soil_bulk_density_5-15cm` | soil | cg/cm³ | SoilGrids |
| `soil_cec_0-5cm` | soil | mmol(c)/kg | SoilGrids |
| `soil_cec_5-15cm` | soil | mmol(c)/kg | SoilGrids |
| `soil_nitrogen_0-5cm` | soil | cg/kg | SoilGrids |
| `soil_nitrogen_5-15cm` | soil | cg/kg | SoilGrids |

---

## App-owned tables

Created and migrated by this repo's Alembic chain (`alembic_version_app`).

### Phase 2 — none

Phase 2 is entirely read-only. No migrations needed.

### Phase 3 — suitability scoring

#### scenario

| column | type | notes |
|---|---|---|
| scenario_id | serial PK | |
| name | text NOT NULL | user-defined label |
| description | text | |
| created_at | timestamptz | default now() |

#### scenario_override

| column | type | notes |
|---|---|---|
| override_id | serial PK | |
| scenario_id | FK → scenario | |
| h3_id | text FK → spatial_cell | |
| feature_name | text | which feature is overridden (matches `feature.name`) |
| override_value | float | replacement value applied before scoring |

#### suitability_score

| column | type | notes |
|---|---|---|
| score_id | serial PK | |
| h3_id | text FK → spatial_cell | |
| crop_id | int FK → crop | |
| scenario_id | int FK → scenario, nullable | null = baseline (no overrides) |
| score | float | 0–1; weighted average of per-feature suitability |
| scored_at | timestamptz | |

Unique constraint on `(h3_id, crop_id, scenario_id)`.

### Phase 5 — yield prediction

#### yield_prediction

| column | type | notes |
|---|---|---|
| prediction_id | serial PK | |
| h3_id | text FK → spatial_cell | |
| crop_id | int FK → crop | |
| scenario_id | int FK → scenario, nullable | |
| predicted_yield | float | t/ha |
| predicted_at | timestamptz | |

### Phase 6 — economic simulation

#### profit_projection

| column | type | notes |
|---|---|---|
| projection_id | serial PK | |
| h3_id | text FK → spatial_cell | |
| crop_id | int FK → crop | |
| scenario_id | int FK → scenario, nullable | |
| gross_revenue | float | USD/ha |
| total_cost | float | USD/ha |
| net_profit | float | USD/ha |
| projected_at | timestamptz | |

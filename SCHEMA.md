# Schema

## ETL-owned tables (read-only from this repo)

These tables are created and migrated by `agritwin-etl`. This repo reads them via SQLAlchemy models but never migrates them. See `agritwin-etl/docs/SCHEMA.md` for column-level detail and `agritwin-etl/agritwin_etl/db/models.py` for the ORM definitions to copy or import.

| Table | What it holds | Phase 2 use |
|---|---|---|
| `spatial_cell` | H3 cells; h3_id, geometry, elevation, slope, aspect, resolution | bbox query, cell profile |
| `feature` | One row per measurable variable (name, category, unit) | feature list, label lookup |
| `observation` | 29.5M rows: (h3_id, feature_id, timestamp, value) — TimescaleDB hypertable | latest values, timeseries |

### spatial_cell — resolution column

`spatial_cell` contains cells at four H3 resolutions:

| resolution | count | source | data in `observation` |
|---|---|---|---|
| 6 | 1,115 | `build-era5-cells` (ERA5 grid) + `build-parent-cells` (res-9 parents) | ERA5 weather + aggregated soil/NDVI/ET |
| 7 | 7,343 | `build-parent-cells` from res-9 | aggregated soil/NDVI/ET (mean/mode) |
| 8 | 50,056 | `build-parent-cells` from res-9 | aggregated soil/NDVI/ET (mean/mode) |
| 9 | 346,787 | `build-cells` from Konya boundary | all raw observations |

ERA5-Land weather data is stored exclusively at res-6 (matches ERA5's ~9 km native grid). All other features (soil, NDVI, ET, land cover) are stored raw at res-9 and pre-aggregated to res-7/8/6 by `agritwin-etl aggregate`. Weather observations for a coarser-resolution cell are looked up by mapping it to its res-6 parent at query time (`h3.cell_to_parent(h3_id, 6)` in `api/cells.py`).
| `crop` | 8 crops: wheat, barley, sugar beet, sunflower, maize, chickpea, lentil, cotton | Phase 3+ |
| `crop_requirement` | Agronomic min/optimal/max/weight per feature per crop; `month` column (1–12, nullable) added for monthly weather requirements | Phase 3+ |
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
| `soil_bulk_density_0-5cm` | soil | kg/dm³ (= g/cm³) | SoilGrids |
| `soil_bulk_density_5-15cm` | soil | kg/dm³ (= g/cm³) | SoilGrids |
| `soil_cec_0-5cm` | soil | mmol/kg | SoilGrids |
| `soil_cec_5-15cm` | soil | mmol/kg | SoilGrids |
| `soil_nitrogen_0-5cm` | soil | g/kg | SoilGrids |
| `soil_nitrogen_5-15cm` | soil | g/kg | SoilGrids |

---

## App-owned tables

Created and migrated by this repo's Alembic chain (`alembic_version_app`).

### Phase 2 — none

Phase 2 is entirely read-only. No migrations needed.

### Phase 3 — suitability scoring

**Architecture note:** Scores are computed in the ETL repo (`agritwin-etl score` command), written to `suitability_score.parquet`, then loaded into this table by the loader. The app only queries — no background threads, no Flask scoring CLI. Suitability lives on its own page (`GET /suitability`) with its own map and sidebar, separate from the monitoring map.

**Scoring approach:** Monthly comparison — for weather features, each month's cell mean (averaged across the 2018–2023 ERA5 record) is compared against that month's crop requirement. For soil/terrain features, a single year-round comparison is used. Final cell-crop score = weighted mean of per-feature scores using trapezoidal fuzzy membership (0 = outside tolerable range, 1 = at optimal).

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

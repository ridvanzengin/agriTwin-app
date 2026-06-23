# Data Analysis — agriTwin Pilot Data Lake

Real numbers pulled directly from the live PostgreSQL database. Updated after Phase 1+ enrichment (2026-06-23). Use these figures for schema decisions, query design, and scoring engine development.

## Canonical grid

**346,787 H3 resolution-9 cells** covering Konya Province (TR52).
**1,007 H3 resolution-6 cells** covering the same boundary — ERA5-Land weather data is stored here (see Issue 1).
All other sources store at resolution 9.

---

## Feature inventory

42 observable features live in the `observation` table. Terrain (elevation/slope/aspect) lives in `spatial_cell` columns.

### Weather — ERA5-Land (resolution 6, 1,007 cells)

| Feature | Unit | Timestamps | Date range | Rows |
|---|---|---|---|---|
| temperature_2m | °C | 72 | 2018-01 → 2023-12 | 72,504 |
| temperature_2m_min | °C | 72 | 2018-01 → 2023-12 | 72,504 |
| precipitation | mm | 72 | 2018-01 → 2023-12 | 72,504 |
| dewpoint_2m | °C | 72 | 2018-01 → 2023-12 | 72,504 |
| solar_radiation | MJ/m² | 72 | 2018-01 → 2023-12 | 72,504 |
| wind_u_10m | m/s | 72 | 2018-01 → 2023-12 | 72,504 |
| wind_v_10m | m/s | 72 | 2018-01 → 2023-12 | 72,504 |

All 7 weather features share 1,007 res-6 cells × 72 monthly timestamps = **72,504 rows each, 507,528 total**.
App resolves res-9 → res-6 via `h3.cell_to_parent(h3_id, 6)` at query time.

`temperature_2m_min` added in Phase 1+: monthly mean of the daily minimum, used as frost-risk proxy in crop scoring.

### Vegetation — MODIS MOD13A2 (resolution 9)

| Feature | Unit | Cells covered | Coverage | Timestamps | Date range | Rows |
|---|---|---|---|---|---|---|
| ndvi | index | 346,746 | 99.99% | 72 | 2018-01 → 2023-12 | 23,761,220 |

41 cells with no NDVI (permanent water or cloud shadow). Treat as NULL in the app.

### Water — MODIS MOD16A2 (resolution 9) *(Phase 1+)*

| Feature | Unit | Cells covered | Coverage | Timestamps | Date range | Rows |
|---|---|---|---|---|---|---|
| actual_et | mm/month | 333,956 | 96.3% | 36 | 2021-01 → 2023-12 | 12,022,416 |

Actual evapotranspiration from MOD16A2 v061, 8-day composites summed to monthly totals. 3-year window (2021–2023) vs ERA5's 6-year window (2018–2023). Used as water-stress proxy in crop scoring.

### Land cover — MODIS MCD12Q1 (resolution 9) *(Phase 1+)*

| Feature | Unit | Cells covered | Coverage | Timestamps | Date range | Rows |
|---|---|---|---|---|---|---|
| land_cover_type | IGBP class | 346,787 | 100% | 1 | 2020-01-01 | 346,787 |

IGBP integer classes 0–17. Classes to exclude from suitability scoring: 0 (water), 13 (urban), 15 (snow/ice), 16 (barren). Single 2020 snapshot.

### Soil — SoilGrids v2.0 (resolution 9, static 2017-01-01)

333,841 cells with soil data (96.3% of 346,787). 12,946 cells with no soil observations (cliff faces, lake beds, rock outcrops). Now at **4 depth layers**: 0-5 cm, 5-15 cm, 15-30 cm, 30-60 cm.

| Property | Unit | 0-5cm | 5-15cm | 15-30cm | 30-60cm | Cells/layer |
|---|---|---|---|---|---|---|
| soil_ph | pH | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_clay | g/kg | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_sand | g/kg | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_silt | g/kg | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_cec | mmol/kg | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_nitrogen | g/kg | ✓ | ✓ | ✓ | ✓ | 333,841 |
| soil_organic_carbon | g/kg | ✓ | ✓ | ✓ | ✓ | 333,839 |
| soil_bulk_density | kg/dm³ | ✓ | ✓ | ✓ | ✓ | 333,839 |

32 soil features total (8 properties × 4 depths). Phase 1+ added the 15-30 cm and 30-60 cm layers.
Row count: 8 × 4 × ~333,840 = **10,683,936** (up from 5,341,448 at 2 depths).

The scoring engine uses the 0-5 cm layer for all soil parameters (topsoil drives germination).

### Terrain — SRTM GL1 (spatial_cell columns, resolution 9)

| Column | Unit | Cells | Coverage | Range |
|---|---|---|---|---|
| elevation | m | 346,787 | 100% | 806 – 3,398 m |
| slope | ° | 346,787 | 100% | 0.0 – 77.2° |
| aspect | ° | 346,787 | 100% | — |

Stored as columns on `spatial_cell`, not in `observation`. No `feature_id` — query directly from the cell row.

---

## Observation row counts by source

| Source | Phase 1 | Phase 1+ (current) | Change |
|---|---|---|---|
| ERA5-Land (6 features) | ~432,000 | 507,528 | +75,528 (added temperature_2m_min) |
| MODIS NDVI | 23,761,220 | 23,761,220 | — |
| MODIS ET | — | 12,022,416 | new Phase 1+ |
| MODIS Land Cover | — | 346,787 | new Phase 1+ |
| SoilGrids (2 depths) | 5,341,448 | 10,683,936 | ×2 (added 15-30, 30-60 cm) |
| **Total** | **~29.5M** | **47,320,847** | **+18M rows** |

> **Historical note:** ERA5 was originally stored at res-9 producing 149.8M rows (803× redundancy). The move to res-6 happened in Phase 1. See Issue 1 below.

---

## Non-observation tables

| Table | Rows | Notes |
|---|---|---|
| `spatial_cell` (res-9) | 346,787 | elevation 806–3,398 m; 0 NULL cells |
| `spatial_cell` (res-6) | 1,007 | ERA5-Land parent cells |
| `crop` | 8 | Wheat, Barley, Sugar Beet, Sunflower, Maize, Chickpea, Lentil, Cotton |
| `crop_requirement` | 66 | 8 crops × 7–10 parameters each (see breakdown below) |
| `crop_statistics` | 512 | Turkey, 8 crops, 1961–2024 (FAOSTAT QCL) |
| `commodity_price` | 1,772 | 7 crops (no chickpea price in FAOSTAT PP), 1991–2025 |
| `production_cost` | 48 | 8 crops × 6 cost types, 2022 reference year |

### crop_requirement breakdown (Phase 1+)

| Crop | Parameters | Count |
|---|---|---|
| Wheat | elevation, precipitation, slope, soil_clay_0-5cm, soil_nitrogen_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, temperature_2m | 8 |
| Barley | elevation, precipitation, slope, soil_clay_0-5cm, soil_nitrogen_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, temperature_2m | 8 |
| Sugar Beet | elevation, precipitation, slope, soil_clay_0-5cm, soil_nitrogen_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, solar_radiation, temperature_2m | 9 |
| Sunflower | elevation, precipitation, slope, soil_clay_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, solar_radiation, temperature_2m | 8 |
| Maize | elevation, precipitation, slope, soil_clay_0-5cm, soil_nitrogen_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, solar_radiation, temperature_2m, temperature_2m_min | 10 |
| Chickpea | elevation, precipitation, slope, soil_clay_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, temperature_2m | 7 |
| Lentil | elevation, precipitation, slope, soil_clay_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, temperature_2m | 7 |
| Cotton | elevation, precipitation, slope, soil_clay_0-5cm, soil_organic_carbon_0-5cm, soil_ph_0-5cm, solar_radiation, temperature_2m, temperature_2m_min | 9 |

`temperature_2m_min` only for frost-sensitive crops (Maize, Cotton). `solar_radiation` only for high-radiation-demand crops (Sugar Beet, Sunflower, Maize, Cotton). `soil_nitrogen` only where nitrogen uptake differentiates yield (Wheat, Barley, Sugar Beet, Maize, Wheat).

---

## Cell completeness profiles

A cell has a "complete" profile if it has observations for all relevant feature categories:

| Category | Complete cells | Coverage |
|---|---|---|
| Weather (all 7 ERA5 features via res-6 parent) | 346,787 | 100% |
| NDVI | 346,746 | 99.99% |
| Actual ET (2021–2023) | 333,956 | 96.3% |
| Land cover | 346,787 | 100% |
| Soil (at least 0-5 cm layer) | 333,841 | 96.3% |
| Terrain (elevation/slope/aspect) | 346,787 | 100% |

Cells with **full coverage across all categories**: ~333,841 (96.3%) — limited by soil/ET data gaps which concentrate at cliff faces, lake beds, and rocky outcrops near the province boundary.

---

## Issues found and decisions made

### Issue 1 — ERA5 resolution mismatch → stored at res-6 *(resolved in Phase 1)*

**Before:** ERA5-Land (~90 km² native grid) stored at H3 res-9 (~0.105 km²). Every res-9 cell within the same ERA5 grid square got an identical value. Redundancy factor: ~803×. Total rows: 149.8M.

**Why res-5 would be wrong:** H3 res-5 cells are ~252 km² — larger than ERA5's ~90 km² native cells. Storing at res-5 would average multiple ERA5 grid points together, discarding real spatial variation.

**Why res-6 is correct:** H3 res-6 cells are ~36 km². Each ERA5 grid point maps to ~2.5 res-6 cells — minimal redundancy, zero information loss. 1,007 res-6 cells cover Konya Province.

**Decision: store ERA5 at res-6.** Row count drops from 149.8M → 507,528 (295× reduction including Phase 1+).

**App impact:** Map displays res-9 cells. When a user clicks a res-9 cell, the app calls `h3.cell_to_parent(h3_id, 6)` to get the ERA5 parent cell and fetches weather data. The user sees weather values in the sidebar — no visible change.

---

### Issue 2 — MODIS covered only 20.2% of cells → KDTree assignment *(resolved in Phase 1)*

**Before:** Each valid MODIS pixel's centre was mapped to one H3 cell via `latlng_to_cell`. A 1 km² pixel covers ~9 H3 res-9 cells but only 1 received the value. Result: 69,927 cells with NDVI, 276,860 without.

**Decision: KDTree nearest-pixel assignment.** For each of the 346,787 H3 cell centroids, find the nearest valid MODIS pixel. If within 0.009° (~1 km = one MODIS pixel), assign its value.

**Also decided: aggregate 16-day composites to monthly means.** Aligns NDVI temporal frequency with ERA5 (both monthly, 72 timestamps, 2018-01 to 2023-12).

**Result:** 346,746 cells with NDVI (99.99%). 41 cells permanently missing (water/cloud shadow).

---

### Issue 3 — ERA5 timestamp was timezone-naive → fixed *(resolved in Phase 1)*

ERA5 `timestamp` was `datetime64[ns]` (no timezone). MODIS and SoilGrids were `datetime64[us, UTC]`. PostgreSQL's `timestamptz` requires timezone-aware values. Fix: `.dt.tz_localize("UTC")` in `sources/era5/parse.py`.

---

### Issue 4 — Chickpea missing from crop_statistics → fixed *(resolved in Phase 1)*

FAOSTAT raw file uses item name `"Chick peas, dry"` but `parse.py` mapped `"Chickpeas"` (wrong key — silently dropped). Fix: updated key in `CROP_NAME_MAP`. All 8 crops now present; crop_statistics has 512 rows covering 1961–2024.

---

## App query implications

### Fetching weather for a res-9 cell
```python
import h3
era5_h3 = h3.cell_to_parent(res9_h3_id, 6)
# Query observation WHERE h3_id = era5_h3 AND feature_id IN (...)
```

### Fetching soil/NDVI/ET for a res-9 cell
```python
# Query observation WHERE h3_id = res9_h3_id AND feature_id IN (...)
# Handle NULL — ~3.7% of cells have no soil/ET data; 0.01% have no NDVI
```

### Fetching land cover for a cell
```python
# land_cover_type has exactly 1 timestamp (2020-01-01); no ORDER BY needed
# SELECT value FROM observation WHERE h3_id = :h3_id AND feature_id = :land_cover_fid
# IGBP classes 0, 13, 15, 16 → exclude from suitability scoring
```

### Scoring engine feature resolution
All `crop_requirement.parameter` values map to features available in the DB:
- `temperature_2m` → ERA5, res-6 parent
- `temperature_2m_min` → ERA5, res-6 parent
- `precipitation` → ERA5, res-6 parent
- `solar_radiation` → ERA5, res-6 parent
- `soil_*_0-5cm` → SoilGrids, res-9 direct
- `elevation`, `slope` → `spatial_cell` columns, not observation table

---

## Re-ingest commands

```bash
# Phase 1 sources (already loaded — idempotent, safe to re-run)
agritwin-etl build-era5-cells        # 1,007 res-6 cells → spatial_cell/era5_cells.parquet
agritwin-etl ingest era5             # 6 features × 1,007 cells × 72 months
agritwin-etl ingest era5-tmin        # temperature_2m_min × 1,007 cells × 72 months
agritwin-etl ingest modis            # NDVI, monthly, 346,746 cells
agritwin-etl ingest soilgrids        # 8 properties × 4 depths × 333,841 cells
agritwin-etl ingest land-cover       # IGBP 2020, 346,787 cells
agritwin-etl ingest modis-et         # actual_et, 36 months, 333,956 cells
agritwin-etl ingest faostat          # 512 rows, 8 crops, 1961–2024
agritwin-etl ingest prices           # commodity prices + production costs
agritwin-etl ingest crop-reference   # 66 crop_requirement rows
agritwin-etl db-load                 # bulk-load all Parquet → PostgreSQL
```

SRTM (elevation/slope/aspect) and spatial cells (build-cells): unchanged, no re-ingest needed.

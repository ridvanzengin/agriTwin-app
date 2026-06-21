# Data Analysis — agriTwin Pilot Data Lake

Real numbers from the Parquet files produced by Phase 1 ingestion. Decisions made here inform the agritwin-app schema and query design.

## Canonical grid

**346,787 H3 resolution-9 cells** covering Konya Province (TR52).
All spatial sources use resolution 9. ERA5 is stored at resolution 6 (see Issue 1 below).

---

## Feature inventory

All sources use the same `observation` table schema: `(h3_id, feature_name, timestamp, value)`.

| Feature | Source | Category | H3 res stored | Temporal freq | Date range | Timestamps | Cells covered | Coverage |
|---|---|---|---|---|---|---|---|---|
| temperature_2m | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| precipitation | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| dewpoint_2m | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| wind_u_10m | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| wind_v_10m | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| solar_radiation | ERA5-Land | weather | **6** | Monthly | 2018-01 → 2023-12 | 72 | ~1,080 res-6 cells | 100% of boundary |
| ndvi | MODIS MOD13A2 | vegetation | 9 | Monthly | 2018-01 → 2023-12 | 72 | Up to 346,787 | High (after fix) |
| soil_ph_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_ph_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_organic_carbon_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,839 | 96.3% |
| soil_organic_carbon_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,839 | 96.3% |
| soil_clay_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_clay_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_sand_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_sand_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_silt_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_silt_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_bulk_density_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,839 | 96.3% |
| soil_bulk_density_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,839 | 96.3% |
| soil_cec_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_cec_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_nitrogen_0-5cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| soil_nitrogen_5-15cm | SoilGrids v2.0 | soil | 9 | Static | 2017-01-01 | 1 | 333,841 | 96.3% |
| elevation | SRTM GL1 | terrain | 9 | Static | — | — | 346,787 | 100% |
| slope | SRTM GL1 | terrain | 9 | Static | — | — | 346,787 | 100% |
| aspect | SRTM GL1 | terrain | 9 | Static | — | — | 346,787 | 100% |

**Terrain data** (elevation, slope, aspect) lives in `spatial_cell` columns, not in `observation`.

---

## Observation row counts (before and after fixes)

| Source | Before | After | Change |
|---|---|---|---|
| ERA5-Land | 149,811,984 | ~467,000 | −99.7% (res-9 → res-6, zero info loss) |
| MODIS | 8,591,920 | TBD after re-ingest | +coverage, −timestamps (monthly vs 16-day) |
| SoilGrids | 5,341,448 | 5,341,448 | unchanged |
| **Total** | **163,745,352** | **~6M–10M** | drastically reduced |

---

## Non-observation tables

| Table | Rows | Time range | Notes |
|---|---|---|---|
| spatial_cell (res-9) | 346,787 | — | 0 nulls; elevation 806–3,398m |
| spatial_cell (res-6) | ~1,080 | — | ERA5 cells added after fix |
| crop | 8 | — | Wheat, Barley, Sugar Beet, Sunflower, Maize, Chickpea, Lentil, Cotton |
| crop_requirement | 40 | — | 8 crops × 5 parameters |
| crop_statistics | ~456 | 1961–2024 | 8 crops incl. Chickpea after fix |
| commodity_price | 1,772 | 1991–2025 | 7 crops (no chickpea price in FAOSTAT PP) |
| production_cost | 48 | 2022 ref year | 8 crops × 6 cost types |

---

## Issues found and decisions made

### Issue 1 — ERA5 resolution mismatch → stored at res-6

**Before:** ERA5-Land (~90 km² native grid) stored at H3 res-9 (~0.105 km²). Every res-9 cell within the same ERA5 grid square got an identical value. Redundancy factor: ~803×. Total rows: 149.8M.

**Why res-5 would be wrong:** H3 res-5 cells are ~252 km² — larger than ERA5's ~90 km² native cells. Storing at res-5 would average multiple ERA5 grid points together, discarding real spatial variation.

**Why res-6 is correct:** H3 res-6 cells are ~36 km². Each ERA5 grid point maps to ~2.5 res-6 cells — minimal redundancy, zero information loss. ~1,080 res-6 cells cover Konya Province.

**Decision: store ERA5 at res-6.** Row count drops from 149.8M → ~467K (320× reduction).

**App impact:** The map displays res-9 cells. When a user clicks a res-9 cell, the app calls `h3.cell_to_parent(h3_id, 6)` to get the ERA5 parent cell and fetches its weather data. The user sees weather values in the sidebar — no visible change.

---

### Issue 2 — MODIS covered only 20.2% of cells → KDTree assignment

**Before:** Each valid MODIS pixel's centre was mapped to one H3 cell via `latlng_to_cell`. A 1km² pixel covers ~9 H3 res-9 cells but only 1 received the value. Result: 69,927 cells with NDVI, 276,860 without.

**Decision: KDTree nearest-pixel assignment.** For each of the 346,787 H3 cell centroids, find the nearest valid MODIS pixel. If within 0.009° (~1 km = one MODIS pixel), assign its value. This achieves "all cells within a pixel get the pixel's value" without slow per-pixel polygon expansion.

**Also decided: aggregate 16-day composites to monthly means.** Aligns NDVI temporal frequency with ERA5 (both monthly, 72 timestamps, 2018-01 to 2023-12). Reduces granule noise and makes per-cell timeseries easier to plot.

**App impact:** NDVI available for most cells. Gracefully handle remaining missing values (cells in permanent cloud shadow or water bodies may still lack NDVI — show "NDVI unavailable" in sidebar).

---

### Issue 3 — ERA5 timestamp was timezone-naive → fixed

ERA5 `timestamp` was `datetime64[ns]` (no timezone). MODIS and SoilGrids were `datetime64[us, UTC]`. PostgreSQL's `timestamptz` requires timezone-aware values. Fix: add `.dt.tz_localize("UTC")` in `sources/era5/parse.py`.

---

### Issue 4 — Chickpea missing from crop_statistics → fixed

FAOSTAT raw file uses item name `"Chick peas, dry"` but `parse.py` mapped `"Chickpeas"` (wrong key — silently dropped). Fix: updated the key in `CROP_NAME_MAP`.

---

## App query implications

### Fetching weather for a res-9 cell
```python
import h3
era5_h3 = h3.cell_to_parent(res9_h3_id, 6)
# Query observation WHERE h3_id = era5_h3 AND feature_name IN (...)
```

### Fetching soil/NDVI for a res-9 cell
```python
# Query observation WHERE h3_id = res9_h3_id AND feature_name IN (...)
# Handle NULL gracefully — ~3.7% of cells have no soil data, some cells no NDVI
```

### Cells with complete data profiles
A cell has a "complete" profile if it has:
- All 6 weather features (ERA5 via res-6 parent) — 100% of cells
- At least 1 soil feature — 96.3% of cells
- NDVI observations — high % after re-ingest (exact number TBD)
- Elevation/slope/aspect — 100% of cells

---

## Re-ingest commands (run after code changes)

```bash
agritwin-etl build-era5-cells        # ~1,080 res-6 cells → spatial_cell/era5_cells.parquet
agritwin-etl ingest era5             # ERA5-Land.parquet at res-6 (~467K rows)
agritwin-etl ingest modis            # MODIS.parquet monthly, full coverage, 2018–2023
agritwin-etl ingest faostat          # crop_statistics with Chickpea
```

SoilGrids, SRTM, prices, crop-reference: unchanged, no re-ingest needed.

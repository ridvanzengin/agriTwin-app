# API Reference — Phase 2 + Phase 3

All `/api/*` endpoints return JSON or GeoJSON. No authentication. No pagination in Phase 2 (bbox limits response size for cells; timeseries and feature list are naturally bounded).

---

## GET /api/features

Returns all available feature names, categories, and units. Used by the frontend to populate the feature selector dropdown and label chart axes.

### Response

```json
[
  {
    "name": "temperature_2m",
    "category": "weather",
    "unit": "°C",
    "description": "2m air temperature monthly mean"
  },
  {
    "name": "precipitation",
    "category": "weather",
    "unit": "mm",
    "description": "Total precipitation monthly sum"
  },
  {
    "name": "ndvi",
    "category": "vegetation",
    "unit": "",
    "description": "Normalized Difference Vegetation Index 16-day composite"
  },
  {
    "name": "soil_ph_0-5cm",
    "category": "soil",
    "unit": "",
    "description": "Soil pH 0–5 cm depth"
  }
]
```

---

## GET /api/cells

Returns a GeoJSON FeatureCollection of H3 cells whose geometry intersects the given bounding box. Called by `map.js` on every `moveend` and on zoom-level changes.

### Query parameters

| param | required | type | description |
|---|---|---|---|
| `bbox` | yes | string | `west,south,east,north` in WGS84 decimal degrees |
| `resolution` | no | int | H3 resolution: 6, 7, 8, or 9 (default: 9) |
| `feature` | no | string | feature name — adds `value` and `value_unit` properties to each cell |

### Resolution and feature availability

| resolution | cells | weather features | soil/NDVI/ET features | terrain (elevation/slope/aspect) |
|---|---|---|---|---|
| 6 | 1,115 | ✓ direct (ERA5 stored at res-6) | ✓ aggregated from res-9 | null (ERA5 cells have no SRTM data) |
| 7 | 7,343 | ✓ via res-6 parent lookup | ✓ aggregated from res-9 | ✓ mean of res-9 children |
| 8 | 50,056 | ✓ via res-6 parent lookup | ✓ aggregated from res-9 | ✓ mean of res-9 children |
| 9 | 346,787 | ✓ via res-6 parent lookup | ✓ raw observations | ✓ from SRTM |

Weather features (category `weather`) are stored at res-6. For res-7/8/9 cells, the API maps each cell to its res-6 ancestor via `h3.cell_to_parent` and joins from there — no data duplication, just a query-time lookup.

### Example

```
GET /api/cells?bbox=31.8,37.2,34.2,39.4&feature=ndvi&resolution=7
```

### Response — GeoJSON FeatureCollection

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[32.41, 37.88], [32.42, 37.88], [32.42, 37.89], [32.41, 37.89], [32.41, 37.88]]]
      },
      "properties": {
        "h3_id": "891f1d48003ffff",
        "elevation": 1043.2,
        "slope": 4.1,
        "aspect": 187.3,
        "value": 0.421,
        "value_unit": ""
      }
    }
  ]
}
```

When `feature` is not supplied, `value` and `value_unit` are absent from `properties`.

**Terrain features:** `elevation`, `slope`, and `aspect` are read directly from the `spatial_cell` table (not from `observation`). Requesting `?feature=elevation` returns `value` = the cell's elevation in metres and `value_unit` = `"m"`. These are handled as a special case in `api/cells.py` via a `TERRAIN_FEATURES` dict; they do not appear in `GET /api/features` (which lists observation-backed features only).

### Error responses

| status | condition |
|---|---|
| 400 | `bbox` missing or not parseable as four floats |
| 400 | `resolution` not in (6, 7, 8, 9) |
| 400 | Bounding box covers more than the full extent of Konya Province (sanity limit) |

---

## GET /api/cells/centroids

Returns all res-6 cell centroids as a Point GeoJSON FeatureCollection. Loaded once on startup by `map.js` and used as the source for MapLibre's client-side clustering at low zoom levels.

### Response

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [32.41, 37.88] },
      "properties": { "h3_id": "862d16267ffffff" }
    }
  ]
}
```

No query parameters. Always returns all 1,115 res-6 centroids.

---

## GET /api/cells/\<h3_id\>

Returns the full environmental profile for a single H3 cell: static attributes from `spatial_cell` plus the latest observed value for every feature available for that cell.

### Example

```
GET /api/cells/891f1d48003ffff
```

### Response

```json
{
  "h3_id": "891f1d48003ffff",
  "elevation": 1043.2,
  "slope": 4.1,
  "aspect": 187.3,
  "features": [
    {
      "name": "temperature_2m",
      "category": "weather",
      "unit": "°C",
      "latest_value": 12.4,
      "latest_timestamp": "2023-12-01T00:00:00+00:00"
    },
    {
      "name": "precipitation",
      "category": "weather",
      "unit": "mm",
      "latest_value": 38.1,
      "latest_timestamp": "2023-12-01T00:00:00+00:00"
    },
    {
      "name": "ndvi",
      "category": "vegetation",
      "unit": "",
      "latest_value": 0.421,
      "latest_timestamp": "2023-12-02T00:00:00+00:00"
    },
    {
      "name": "soil_ph_0-5cm",
      "category": "soil",
      "unit": "",
      "latest_value": 7.3,
      "latest_timestamp": "2017-01-01T00:00:00+00:00"
    }
  ]
}
```

`features` is sorted by `category` then `name`. Soil features have a static `latest_timestamp` of `2017-01-01` (SoilGrids reference date). Features with no observations for this cell are omitted.

### Error responses

| status | condition |
|---|---|
| 404 | `h3_id` not found in `spatial_cell` |

---

## GET /api/cells/\<h3_id\>/timeseries

Returns the full observation history for one cell and one feature. Used by `panel.js` to render time-series charts.

### Query parameters

| param | required | type | description |
|---|---|---|---|
| `feature` | yes | string | feature name (e.g. `ndvi`, `temperature_2m`) |
| `start` | no | string | ISO 8601 date — filter observations on or after this date |
| `end` | no | string | ISO 8601 date — filter observations on or before this date |

### Example

```
GET /api/cells/891f1d48003ffff/timeseries?feature=ndvi&start=2022-01-01
```

### Response

```json
{
  "h3_id": "891f1d48003ffff",
  "feature": "ndvi",
  "unit": "",
  "data": [
    { "timestamp": "2022-01-01T00:00:00+00:00", "value": 0.312 },
    { "timestamp": "2022-01-17T00:00:00+00:00", "value": 0.289 },
    { "timestamp": "2022-02-02T00:00:00+00:00", "value": 0.305 }
  ]
}
```

`data` is sorted ascending by `timestamp`. An empty `data` array (no observations) is a valid response, not a 404.

### Error responses

| status | condition |
|---|---|
| 400 | `feature` param missing |
| 400 | `start` or `end` not parseable as a date |
| 404 | `h3_id` not found in `spatial_cell` |
| 404 | `feature` name not found in `feature` table |

---

## HTML routes (views Blueprint)

| route | description |
|---|---|
| `GET /` | Monitoring map — renders `map.html` with MapLibre centered on Konya Province |
| `GET /suitability` | Suitability page — renders `suitability.html` with choropleth map and crop scoring panel |

---

## GET /api/suitability/cells

Returns a GeoJSON FeatureCollection of res-9 H3 cells in the viewport, colored by suitability score for the given crop. Called by `suitability_map.js` on every `moveend`.

### Query parameters

| param | required | type | description |
|---|---|---|---|
| `bbox` | yes | string | `west,south,east,north` in WGS84 decimal degrees |
| `crop` | yes | string | crop name (e.g. `wheat`, `barley`, `cotton`) |

### Response — GeoJSON FeatureCollection

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[32.41, 37.88], [32.42, 37.88], [32.42, 37.89], [32.41, 37.88]]]
      },
      "properties": {
        "h3_id": "891f1d48003ffff",
        "score": 0.72
      }
    }
  ]
}
```

Cells with no score row (scenario_id IS NULL) are omitted. Score is null-safe — cells missing from `suitability_score` do not appear in the response.

### Error responses

| status | condition |
|---|---|
| 400 | `bbox` missing or not parseable as four floats |
| 400 | `crop` missing or not found in `crop` table |

---

## GET /api/suitability/cells/\<h3_id\>

Returns the baseline suitability score for all 8 crops for a single cell. Used by Tab 1 of the suitability sidebar.

### Example

```
GET /api/suitability/cells/891f1d48003ffff
```

### Response

```json
[
  { "crop_name": "wheat",      "score": 0.82, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "barley",     "score": 0.79, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "chickpea",   "score": 0.61, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "lentil",     "score": 0.68, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "sunflower",  "score": 0.44, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "sugar_beet", "score": 0.38, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "maize",      "score": 0.35, "scored_at": "2026-06-23T00:00:00+00:00" },
  { "crop_name": "cotton",     "score": 0.19, "scored_at": "2026-06-23T00:00:00+00:00" }
]
```

Sorted descending by score. Only baseline rows (`scenario_id IS NULL`) are returned.

### Error responses

| status | condition |
|---|---|
| 404 | `h3_id` not found in `spatial_cell` |

---

## GET /api/suitability/cells/\<h3_id\>/monthly

Returns the monthly actual climate values alongside the crop's monthly requirements for all scored weather features. Used by Tab 2 (monthly chart) of the suitability sidebar.

### Query parameters

| param | required | type | description |
|---|---|---|---|
| `crop` | yes | string | crop name |

### Example

```
GET /api/suitability/cells/891f1d48003ffff/monthly?crop=wheat
```

### Response

```json
{
  "h3_id": "891f1d48003ffff",
  "crop": "wheat",
  "features": [
    {
      "feature": "temperature_2m",
      "unit": "°C",
      "months": [
        { "month": 10, "actual": 13.2, "req_min": 5,  "req_optimal": 12, "req_max": 22 },
        { "month": 11, "actual": 7.1,  "req_min": -2, "req_optimal": 6,  "req_max": 15 },
        { "month": 5,  "actual": 17.8, "req_min": 12, "req_optimal": 18, "req_max": 28 }
      ]
    },
    {
      "feature": "precipitation",
      "unit": "mm",
      "months": [...]
    }
  ]
}
```

`actual` is the mean across years 2018–2023 for that (h3_id → res-6 parent, month) pair. ERA5 weather is fetched from the res-6 parent cell. Only months where a `crop_requirement` row exists are included. Features with no requirements for the crop are omitted.

### Error responses

| status | condition |
|---|---|
| 400 | `crop` param missing |
| 404 | `h3_id` not found in `spatial_cell` |
| 404 | `crop` not found in `crop` table |

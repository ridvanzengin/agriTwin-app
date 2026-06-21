# API Reference — Phase 2

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

Returns a GeoJSON FeatureCollection of H3 cells whose geometry intersects the given bounding box. Called by `map.js` on every `moveend` event.

### Query parameters

| param | required | type | description |
|---|---|---|---|
| `bbox` | yes | string | `west,south,east,north` in WGS84 decimal degrees |
| `feature` | no | string | feature name — adds `value` and `value_unit` properties to each cell using the latest observed value |

### Example

```
GET /api/cells?bbox=31.8,37.2,34.2,39.4&feature=ndvi
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

### Error responses

| status | condition |
|---|---|
| 400 | `bbox` missing or not parseable as four floats |
| 400 | Bounding box covers more than the full extent of Konya Province (sanity limit) |

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
| `GET /` | Map page — renders `map.html` with MapLibre centered on Konya Province |

No other HTML routes in Phase 2.

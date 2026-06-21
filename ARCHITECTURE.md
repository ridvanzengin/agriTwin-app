# Architecture

## System overview

```
Browser
  │
  │  HTTP
  ▼
Flask (agritwin-app)
  ├── GET /                → views/map.py → Jinja2 map.html
  └── GET /api/*           → api/cells.py, api/features.py → JSON / GeoJSON
            │
            │  SQLAlchemy + GeoAlchemy2
            ▼
PostgreSQL + PostGIS + TimescaleDB
  ├── ETL tables (agritwin-etl owns, migrations): spatial_cell, observation, feature, crop, …
  └── App tables (agritwin-app owns, migrations): scenario, suitability_score, …  [Phase 3+]
```

No external services are called at query time. All data is pre-loaded into PostgreSQL by `agritwin-etl db-load`. Phase 2 reads only.

## Map rendering

MapLibre GL JS runs in the browser. Flask serves the HTML shell page and the data API — it does not generate map tiles. MapLibre loads from a CDN link in `base.html`.

### Phase 2: bbox-GeoJSON source

`map.js` initializes a MapLibre `geojson` source pointed at `/api/cells`:

```javascript
map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

map.on('moveend', fetchCells);

function fetchCells() {
  const b = map.getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  fetch(`/api/cells?bbox=${bbox}&feature=${selectedFeature}`)
    .then(r => r.json())
    .then(geojson => map.getSource('cells').setData(geojson));
}
```

The layer is a `fill` layer with `fill-color` driven by the `value` property using a stepped or interpolated color expression. A second `line` layer draws cell boundaries.

**Why bbox-GeoJSON, not vector tiles:** simplest to implement and debug; 2,000–8,000 cells per viewport is fast enough for local single-user dev. If rendering performance degrades at tight zoom (many cells) or with slow initial loads, the upgrade path is to pre-generate a PMTiles file with `tippecanoe` and serve it via Flask's `send_from_directory`. That upgrade is self-contained and doesn't change the API contract or data model.

## Key database queries

### Cells in viewport with optional feature value

The core Phase 2 query. Uses the PostGIS spatial index on `spatial_cell.geometry` (`&&` bbox intersection) and a `LATERAL` subquery to get the latest observed value per cell without a full join across 163M observation rows.

```sql
SELECT sc.h3_id,
       ST_AsGeoJSON(sc.geometry)::json AS geometry,
       sc.elevation,
       sc.slope,
       sc.aspect,
       lat.value,
       f.unit AS value_unit
FROM spatial_cell sc
LEFT JOIN LATERAL (
    SELECT o.value
    FROM observation o
    WHERE o.h3_id = sc.h3_id
      AND o.feature_id = (SELECT feature_id FROM feature WHERE name = :feature_name)
    ORDER BY o.timestamp DESC
    LIMIT 1
) lat ON true
LEFT JOIN feature f ON f.name = :feature_name
WHERE sc.geometry && ST_MakeEnvelope(:west, :south, :east, :north, 4326);
```

When `feature_name` is not supplied, omit the `LATERAL` and `feature` joins.

### Full environmental profile for one cell

```sql
SELECT f.name, f.category, f.unit, o.value, o.timestamp
FROM observation o
JOIN feature f ON o.feature_id = f.feature_id
WHERE o.h3_id = :h3_id
  AND o.observation_id = (
      SELECT observation_id FROM observation o2
      WHERE o2.h3_id = o.h3_id AND o2.feature_id = o.feature_id
      ORDER BY o2.timestamp DESC
      LIMIT 1
  )
ORDER BY f.category, f.name;
```

Combined in the API response with the `elevation`, `slope`, `aspect` columns from `spatial_cell`.

### Timeseries for one cell and feature

```sql
SELECT o.timestamp, o.value
FROM observation o
JOIN feature f ON o.feature_id = f.feature_id
WHERE o.h3_id = :h3_id
  AND f.name = :feature_name
ORDER BY o.timestamp;
```

TimescaleDB partition pruning limits the scan to relevant chunks even across 163M rows.

## Request / response flow for cell click

1. User clicks a cell polygon on the map.
2. MapLibre fires a `click` event on the `cells-fill` layer; `panel.js` reads `e.features[0].properties.h3_id`.
3. `panel.js` issues two parallel `fetch` calls:
   - `GET /api/cells/{h3_id}` — static attributes + all feature latest values
   - `GET /api/cells/{h3_id}/timeseries?feature=ndvi` — NDVI history
4. Sidebar renders: table of static + latest values; Chart.js line chart for NDVI.
5. A second chart (temperature + precipitation) is fetched on demand or alongside.

## Alembic setup

Two Alembic chains share one database. Avoid table-name collision by renaming this repo's version table:

```python
# agritwin-app/alembic/env.py
context.configure(
    connection=connection,
    target_metadata=target_metadata,
    version_table="alembic_version_app",   # <-- key line
)
```

Never run `agritwin-etl`'s Alembic from this repo and vice versa.

## Phase 3+ additions (not built yet)

| Phase | Addition | New tables |
|---|---|---|
| 3 | Crop suitability scoring (background task, reads observation + crop_requirement) | `suitability_score` |
| 4 | Scenario simulation (user overrides + re-score) | `scenario`, `scenario_override` |
| 5 | Yield prediction (statistical model from QCL historical data + scores) | `yield_prediction` |
| 6 | Economic simulation (yield × price − costs) | `profit_projection` |

None of these require ETL schema changes or `agritwin-etl` migrations.

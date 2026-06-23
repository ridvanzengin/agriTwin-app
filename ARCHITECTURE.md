# Architecture

## System overview

```
Browser
  │
  │  HTTP
  ▼
Flask (agritwin-app)  ─── port 5001 (Docker) / 5000 (host)
  ├── GET /                → views/map.py → Jinja2 map.html
  └── GET /api/*           → api/cells.py, api/features.py → JSON / GeoJSON
            │
            │  SQLAlchemy + GeoAlchemy2
            ▼
PostgreSQL + PostGIS + TimescaleDB  ─── port 5433
  ├── ETL tables (agritwin-etl owns, migrations): spatial_cell, observation, feature, crop, …
  └── App tables (agritwin-app owns, migrations): scenario, suitability_score, …  [Phase 3+]
```

No external services are called at query time. All data is pre-loaded into PostgreSQL by `agritwin-etl db-load`. Phase 2 reads only.

## Docker service architecture

`docker compose up --build -d` starts four services in dependency order:

```
db (healthy?)
    │
    ▼
migrate  ──────────────────┐
 (runs both Alembic chains, │
  then exits)               │
    │                       │
    ├──────────────┐        │
    ▼              ▼        │
   web           loader     │
(Flask, stays  (COPY FROM   │
   up)          STDIN, exits)
```

| Service | Image | Purpose | Exit? |
|---|---|---|---|
| `db` | `timescale/timescaledb-ha:pg16` | PostgreSQL + PostGIS + TimescaleDB | stays up |
| `migrate` | built from `Dockerfile` | Runs ETL Alembic chain, then app Alembic chain | exits 0 |
| `web` | built from `Dockerfile` | Flask app, waits for `migrate` to succeed | stays up |
| `loader` | built from `Dockerfile` | Bulk-loads all Parquet tables via COPY FROM STDIN | exits 0 |

`web` and `loader` both depend on `migrate: condition: service_completed_successfully`, so they never start against an unschema'd database. The Flask app is usable immediately after `migrate` finishes — the map renders with whatever data has loaded so far.

### Build context and volumes

The Dockerfile `build: context: ..` (parent of both repos) so the image can bake in the ETL source:

```dockerfile
COPY agriTwin-etl/agritwin_etl  /agritwin-etl/agritwin_etl
COPY agriTwin-etl/alembic       /agritwin-etl/alembic
# …
COPY agriTwin-app/. /app
```

Only `data/processed/` (the Parquet files, ~several GB) is volume-mounted at runtime — not baked in, to keep image size manageable:

```yaml
volumes:
  - ../agriTwin-etl/data/processed:/agritwin-etl/data/processed:ro
```

This means both repos must be siblings under the same parent directory for `docker compose up` to work.

## Map rendering

MapLibre GL JS runs in the browser. Flask serves the HTML shell page and the data API — it does not generate map tiles. MapLibre loads from a CDN link in `base.html`.

### Zoom-adaptive multi-resolution rendering

The map operates in five modes determined by MapLibre zoom level:

| zoom | mode | resolution | API call | typical cells in viewport |
|---|---|---|---|---|
| < 5 | cluster | — | `/api/cells/centroids` (once, cached) | MapLibre client-side clusters |
| 5–6 | res-6 | 6 | `/api/cells?resolution=6` | ~1,000 large hexagons |
| 7–8 | res-7 | 7 | `/api/cells?resolution=7` | ~500–2,000 hexagons |
| 9–10 | res-8 | 8 | `/api/cells?resolution=8` | ~2,000–8,000 hexagons |
| ≥ 11 | res-9 | 9 | `/api/cells?resolution=9` | ~2,000–8,000 hexagons |

`map.js` listens to `zoomend` (to switch resolution mode) and `moveend` (to reload cells for new viewport). A `_zoomFetched` flag prevents the `moveend` that MapLibre always fires immediately after `zoomend` from issuing a duplicate request.

The polygon layers (`cells-fill`, `cells-outline`, `cells-hover`) share a single GeoJSON source that is replaced on each fetch. The cluster layer uses a separate source loaded from `/api/cells/centroids` once on startup.

**Why bbox-GeoJSON, not vector tiles:** simplest to implement and debug; payload is manageable at each zoom level. If rendering performance degrades, the upgrade path is PMTiles via `tippecanoe` — self-contained, no API contract change.

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
WHERE sc.geometry && ST_MakeEnvelope(:west, :south, :east, :north, 4326)
  AND sc.resolution = :resolution;  -- 6 / 7 / 8 / 9 driven by map zoom level
```

When `feature_name` is not supplied, omit the `LATERAL` and `feature` joins.

**Weather features exception:** ERA5 weather is stored at res-6. For res-7/8/9 cells, `api/cells.py` first fetches the viewport cells, then maps each `h3_id` to its res-6 parent via `h3.cell_to_parent(h3_id, 6)` and joins the observation table using those parent IDs. This avoids duplicating ERA5 data at every resolution.

**Terrain features exception:** `elevation`, `slope`, and `aspect` are stored directly in `spatial_cell`, not in `observation`. When `feature_name` is one of these, the query reads `sc.elevation` / `sc.slope` / `sc.aspect` directly and skips the `LATERAL` subquery entirely. These columns are populated for res-7/8/9 (averaged from res-9 SRTM data) and are null at res-6 (ERA5 cells have no terrain data).

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

/* global maplibregl, SCENARIO_ID, POLYGON_BOUNDS, POLYGON_GEOJSON */

const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const LIGHT_STYLE = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
        'carto-basemap': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: TILE_ATTR,
        },
    },
    layers: [{ id: 'background', type: 'raster', source: 'carto-basemap' }],
};

window.currentCrop = 'Wheat';

let map;
let fetchController = null;
let tooltip = null;

function buildScenarioUrl() {
    const b = map.getBounds();
    return `/api/scenarios/${SCENARIO_ID}/cells?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&crop=${encodeURIComponent(window.currentCrop)}`;
}

async function fetchScenarioCells() {
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    try {
        const resp = await fetch(buildScenarioUrl(), { signal: fetchController.signal });
        const data = await resp.json();
        map.getSource('scenario-cells')?.setData(data);
    } catch (err) {
        if (err.name !== 'AbortError') console.error('fetchScenarioCells failed:', err);
    }
}

window.refetchScenarioCells = fetchScenarioCells;

map = new maplibregl.Map({
    container: 'scenario-map',
    style: LIGHT_STYLE,
    center: [32.5, 37.87],
    zoom: 9,
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

// Tooltip div
tooltip = document.createElement('div');
tooltip.style.cssText = 'position:absolute;background:#1e293b;color:#e2e8f0;padding:6px 10px;border-radius:5px;font-size:12px;pointer-events:none;display:none;border:1px solid #334155;z-index:10;';
document.getElementById('scenario-map').appendChild(tooltip);

map.on('load', () => {
    // ── Scenario cells source ─────────────────────────────────────────────────
    map.addSource('scenario-cells', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
        id: 'scenario-fill',
        type: 'fill',
        source: 'scenario-cells',
        paint: {
            'fill-color': [
                'case',
                ['==', ['get', 'score'], null], '#cbd5e1',
                ['interpolate', ['linear'], ['get', 'score'],
                    0.0, '#d73027',
                    0.5, '#ffffbf',
                    1.0, '#1a9850',
                ],
            ],
            'fill-opacity': 0.65,
        },
    });

    map.addLayer({
        id: 'scenario-outline',
        type: 'line',
        source: 'scenario-cells',
        paint: { 'line-color': '#334155', 'line-width': 0.5 },
    });

    map.addLayer({
        id: 'scenario-selected',
        type: 'line',
        source: 'scenario-cells',
        filter: ['==', ['get', 'h3_id'], ''],
        paint: { 'line-color': '#22c55e', 'line-width': 2.5 },
    });

    // ── Polygon boundary layer ────────────────────────────────────────────────
    if (POLYGON_GEOJSON) {
        map.addSource('scenario-polygon', {
            type: 'geojson',
            data: { type: 'Feature', geometry: JSON.parse(POLYGON_GEOJSON), properties: {} },
        });
        map.addLayer({
            id: 'scenario-polygon-outline',
            type: 'line',
            source: 'scenario-polygon',
            paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2] },
        });
    }

    // Fit map to polygon bounds
    if (POLYGON_BOUNDS && POLYGON_BOUNDS.length === 2) {
        map.fitBounds(POLYGON_BOUNDS, { padding: 60, maxZoom: 14 });
    }

    fetchScenarioCells();
});

map.on('moveend', fetchScenarioCells);

// ── Cell click ───────────────────────────────────────────────────────────────
map.on('click', 'scenario-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const h3Id = feature.properties.h3_id;
    map.setFilter('scenario-selected', ['==', ['get', 'h3_id'], h3Id]);
    if (typeof window.loadScenarioPanel === 'function') window.loadScenarioPanel(h3Id);
});

map.on('mouseenter', 'scenario-fill', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const feature = e.features?.[0];
    if (!feature) return;
    const score = feature.properties.score;
    const scoreStr = score !== null && score !== undefined ? score.toFixed(2) : '—';
    tooltip.innerHTML = `<strong>${window.currentCrop}</strong> &nbsp; Score: ${scoreStr}`;
    tooltip.style.display = 'block';
});

map.on('mousemove', 'scenario-fill', (e) => {
    const pt = e.point;
    tooltip.style.left = (pt.x + 12) + 'px';
    tooltip.style.top  = (pt.y - 8) + 'px';
});

map.on('mouseleave', 'scenario-fill', () => {
    map.getCanvas().style.cursor = '';
    tooltip.style.display = 'none';
});

/* global maplibregl */

const TURKEY_CENTER      = [35.5, 39.0];
const INITIAL_ZOOM       = 6;
const SUIT_ZOOM_THRESHOLD = 11;   // below → clusters; at/above → res-9 polygons

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
let currentMode = 'cluster';   // 'cluster' | 'polygons'
let fetchController = null;
let _zoomFetched = false;

function calcMode() {
    return map.getZoom() >= SUIT_ZOOM_THRESHOLD ? 'polygons' : 'cluster';
}

function buildSuitabilityUrl() {
    const b = map.getBounds();
    return `/api/suitability/cells?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&crop=${encodeURIComponent(window.currentCrop)}`;
}

async function fetchSuitabilityCells() {
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    try {
        const resp = await fetch(buildSuitabilityUrl(), { signal: fetchController.signal });
        const data = await resp.json();
        map.getSource('suitability')?.setData(data);
    } catch (err) {
        if (err.name !== 'AbortError') console.error('fetchSuitabilityCells failed:', err);
    }
}

window.refetchSuitabilityCells = fetchSuitabilityCells;

function applyModeVisibility(mode) {
    const clusterVis = mode === 'cluster' ? 'visible' : 'none';
    const polyVis    = mode === 'polygons' ? 'visible' : 'none';
    ['suit-clusters', 'suit-cluster-count', 'suit-unclustered'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', clusterVis);
    });
    ['suitability-fill', 'suitability-outline', 'suitability-selected'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', polyVis);
    });
}

function setMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    applyModeVisibility(mode);
    if (mode === 'polygons') fetchSuitabilityCells();
}

map = new maplibregl.Map({
    container: 'suitability-map',
    style: LIGHT_STYLE,
    center: TURKEY_CENTER,
    zoom: INITIAL_ZOOM,
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

map.on('load', () => {
    // ── Cluster source: res-6 centroids (all cells, loaded once) ─────────────
    map.addSource('suit-centroids', {
        type: 'geojson',
        data: '/api/cells/centroids',
        cluster: true,
        clusterMaxZoom: SUIT_ZOOM_THRESHOLD - 1,
        clusterRadius: 60,
    });

    map.addLayer({
        id: 'suit-clusters',
        type: 'circle',
        source: 'suit-centroids',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': [
                'step', ['get', 'point_count'],
                '#22c55e',
                100, '#eab308',
                500, '#f97316',
                1000, '#ef4444',
            ],
            'circle-radius': ['step', ['get', 'point_count'], 18, 100, 24, 500, 30, 1000, 38],
            'circle-opacity': 0.85,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
        },
    });

    map.addLayer({
        id: 'suit-cluster-count',
        type: 'symbol',
        source: 'suit-centroids',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1,
        },
    });

    map.addLayer({
        id: 'suit-unclustered',
        type: 'circle',
        source: 'suit-centroids',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': '#22c55e',
            'circle-radius': 7,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff',
        },
    });

    // ── Polygon source: res-9 suitability cells (bbox-filtered) ──────────────
    map.addSource('suitability', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
        id: 'suitability-fill',
        type: 'fill',
        source: 'suitability',
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
        id: 'suitability-outline',
        type: 'line',
        source: 'suitability',
        paint: { 'line-color': '#334155', 'line-width': 0.5 },
    });

    map.addLayer({
        id: 'suitability-selected',
        type: 'line',
        source: 'suitability',
        filter: ['==', ['get', 'h3_id'], ''],
        paint: { 'line-color': '#22c55e', 'line-width': 2.5 },
    });

    // Start in cluster mode
    applyModeVisibility('cluster');
});

map.on('zoomend', () => {
    _zoomFetched = true;
    setMode(calcMode());
});

map.on('moveend', () => {
    if (currentMode === 'polygons') {
        if (_zoomFetched) { _zoomFetched = false; return; }
        fetchSuitabilityCells();
    }
});

map.on('click', 'suitability-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const h3Id = feature.properties.h3_id;
    map.setFilter('suitability-selected', ['==', ['get', 'h3_id'], h3Id]);
    if (typeof window.loadCellPanel === 'function') window.loadCellPanel(h3Id);
});

map.on('mouseenter', 'suitability-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'suitability-fill', () => { map.getCanvas().style.cursor = ''; });

// Cluster click: zoom to expansion zoom
map.on('click', 'suit-clusters', e => {
    const clusterId = e.features[0].properties.cluster_id;
    map.getSource('suit-centroids').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (!err) map.easeTo({ center: e.features[0].geometry.coordinates, zoom: zoom + 0.5 });
    });
});
map.on('mouseenter', 'suit-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'suit-clusters', () => { map.getCanvas().style.cursor = ''; });

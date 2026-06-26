/* global maplibregl */

const YP_TURKEY_CENTER   = [35.5, 39.0];
const YP_INITIAL_ZOOM    = 6;
const YP_ZOOM_THRESHOLD  = 11;

const YP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const YP_LIGHT_STYLE = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
        'carto-basemap': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: YP_TILE_ATTR,
        },
    },
    layers: [{ id: 'background', type: 'raster', source: 'carto-basemap' }],
};

window.ypCurrentCrop = 'Wheat';

let ypMap;
let ypCurrentMode   = 'cluster';
let ypFetchCtrl     = null;
let ypZoomFetched   = false;

function ypCalcMode() {
    return ypMap.getZoom() >= YP_ZOOM_THRESHOLD ? 'polygons' : 'cluster';
}

function ypBuildUrl() {
    const b = ypMap.getBounds();
    return `/api/yield-profit/cells?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&crop=${encodeURIComponent(window.ypCurrentCrop)}`;
}

async function ypFetchCells() {
    if (ypFetchCtrl) ypFetchCtrl.abort();
    ypFetchCtrl = new AbortController();
    try {
        const resp = await fetch(ypBuildUrl(), { signal: ypFetchCtrl.signal });
        const data = await resp.json();
        ypMap.getSource('yp-cells')?.setData(data);
    } catch (err) {
        if (err.name !== 'AbortError') console.error('ypFetchCells failed:', err);
    }
}

window.ypRefetchCells = ypFetchCells;

function ypApplyModeVisibility(mode) {
    const clusterVis = mode === 'cluster'   ? 'visible' : 'none';
    const polyVis    = mode === 'polygons'  ? 'visible' : 'none';
    ['yp-clusters', 'yp-cluster-count', 'yp-unclustered'].forEach(id => {
        if (ypMap.getLayer(id)) ypMap.setLayoutProperty(id, 'visibility', clusterVis);
    });
    ['yp-fill', 'yp-outline', 'yp-selected'].forEach(id => {
        if (ypMap.getLayer(id)) ypMap.setLayoutProperty(id, 'visibility', polyVis);
    });
}

function ypSetMode(mode) {
    if (mode === ypCurrentMode) return;
    ypCurrentMode = mode;
    ypApplyModeVisibility(mode);
    if (mode === 'polygons') ypFetchCells();
}

ypMap = new maplibregl.Map({
    container: 'yp-map',
    style: YP_LIGHT_STYLE,
    center: YP_TURKEY_CENTER,
    zoom: YP_INITIAL_ZOOM,
});

ypMap.addControl(new maplibregl.NavigationControl(), 'bottom-right');
ypMap.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

ypMap.on('load', () => {
    // ── Cluster source ────────────────────────────────────────────────────────
    ypMap.addSource('yp-centroids', {
        type: 'geojson',
        data: '/api/cells/centroids',
        cluster: true,
        clusterMaxZoom: YP_ZOOM_THRESHOLD - 1,
        clusterRadius: 60,
    });

    ypMap.addLayer({
        id: 'yp-clusters',
        type: 'circle',
        source: 'yp-centroids',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': ['step', ['get', 'point_count'],
                '#22c55e', 100, '#eab308', 500, '#f97316', 1000, '#ef4444'],
            'circle-radius': ['step', ['get', 'point_count'], 18, 100, 24, 500, 30, 1000, 38],
            'circle-opacity': 0.85,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
        },
    });

    ypMap.addLayer({
        id: 'yp-cluster-count',
        type: 'symbol',
        source: 'yp-centroids',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1 },
    });

    ypMap.addLayer({
        id: 'yp-unclustered',
        type: 'circle',
        source: 'yp-centroids',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#22c55e', 'circle-radius': 7,
                 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' },
    });

    // ── Polygon source: net_profit color ramp (USD/ha) ────────────────────────
    ypMap.addSource('yp-cells', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
    });

    ypMap.addLayer({
        id: 'yp-fill',
        type: 'fill',
        source: 'yp-cells',
        paint: {
            'fill-color': [
                'case',
                ['==', ['get', 'net_profit'], null], '#cbd5e1',
                ['interpolate', ['linear'], ['get', 'net_profit'],
                    -500,  '#d73027',   // loss → red
                       0,  '#ffffbf',   // break-even → yellow
                     500,  '#1a9850',   // profitable → green
                ],
            ],
            'fill-opacity': 0.65,
        },
    });

    ypMap.addLayer({
        id: 'yp-outline',
        type: 'line',
        source: 'yp-cells',
        paint: { 'line-color': '#334155', 'line-width': 0.5 },
    });

    ypMap.addLayer({
        id: 'yp-selected',
        type: 'line',
        source: 'yp-cells',
        filter: ['==', ['get', 'h3_id'], ''],
        paint: { 'line-color': '#22c55e', 'line-width': 2.5 },
    });

    ypApplyModeVisibility('cluster');
});

ypMap.on('zoomend', () => {
    ypZoomFetched = true;
    ypSetMode(ypCalcMode());
});

ypMap.on('moveend', () => {
    if (ypCurrentMode === 'polygons') {
        if (ypZoomFetched) { ypZoomFetched = false; return; }
        ypFetchCells();
    }
});

ypMap.on('click', 'yp-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const h3Id = feature.properties.h3_id;
    ypMap.setFilter('yp-selected', ['==', ['get', 'h3_id'], h3Id]);
    if (typeof window.loadYPPanel === 'function') window.loadYPPanel(h3Id);
});

ypMap.on('mouseenter', 'yp-fill', () => { ypMap.getCanvas().style.cursor = 'pointer'; });
ypMap.on('mouseleave', 'yp-fill', () => { ypMap.getCanvas().style.cursor = ''; });

ypMap.on('click', 'yp-clusters', e => {
    const clusterId = e.features[0].properties.cluster_id;
    ypMap.getSource('yp-centroids').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (!err) ypMap.easeTo({ center: e.features[0].geometry.coordinates, zoom: zoom + 0.5 });
    });
});
ypMap.on('mouseenter', 'yp-clusters', () => { ypMap.getCanvas().style.cursor = 'pointer'; });
ypMap.on('mouseleave', 'yp-clusters', () => { ypMap.getCanvas().style.cursor = ''; });

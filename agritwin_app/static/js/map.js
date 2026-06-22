/* global maplibregl, formatFeatureName, WEATHER_FEATURE_NAMES, TERRAIN_FEATURE_NAMES_SET */

// ── Constants ──────────────────────────────────────────────────────────────
const CLUSTER_THRESHOLD   = 7;    // zoom < 8  → cluster mode
const ZOOM_THRESHOLD      = 11;   // zoom 8–10 → res-6, ≥ 11 → res-9
const TURKEY_CENTER       = [35.5, 39.0];
const INITIAL_ZOOM        = 6;

const CELL_SOURCE         = 'cells';
const CENTROID_SOURCE     = 'cell-centroids';
const FILL_LAYER          = 'cells-fill';
const OUTLINE_LAYER       = 'cells-outline';
const HOVER_LAYER         = 'cells-hover';
const CLUSTER_LAYER       = 'clusters';
const CLUSTER_COUNT_LAYER = 'cluster-count';
const UNCLUSTERED_LAYER   = 'unclustered-point';

const DEFAULT_FEATURE_RES9 = 'elevation';
const DEFAULT_FEATURE_RES6 = 'temperature_2m';

// ── State ──────────────────────────────────────────────────────────────────
let map;
let currentMode       = 'cluster';  // 'cluster' | 'res6' | 'res9'
let currentFeature    = DEFAULT_FEATURE_RES9;
let currentResolution = 9;
let currentTheme      = localStorage.getItem('mapTheme') ?? 'light';
let hoveredH3Id       = null;
let fetchController   = null;

// ── Basemap styles ─────────────────────────────────────────────────────────
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const BASEMAP_TILES = {
  light: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  dark:  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
};

function makeStyle(theme) {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'carto-basemap': {
        type: 'raster',
        tiles: [BASEMAP_TILES[theme]],
        tileSize: 256,
        attribution: TILE_ATTR,
      },
    },
    layers: [{ id: 'background', type: 'raster', source: 'carto-basemap' }],
  };
}

// ── Color ramps ────────────────────────────────────────────────────────────
const COLOR_RAMPS = {
  elevation:       { property: 'elevation', stops: [[700,'#1a9641'],[1000,'#a6d96a'],[1300,'#ffffbf'],[1700,'#fdae61'],[2200,'#d7191c']] },
  slope:           { property: 'slope',     stops: [[0,'#f7fcf5'],[10,'#c7e9c0'],[20,'#74c476'],[35,'#238b45'],[60,'#00441b']] },
  aspect:          { property: 'aspect',    stops: [[0,'#e66101'],[90,'#fdb863'],[180,'#f7f7f7'],[270,'#92c5de'],[360,'#0571b0']] },
  ndvi:            { property: 'value', stops: [[0.0,'#d73027'],[0.2,'#fc8d59'],[0.4,'#fee08b'],[0.6,'#d9ef8b'],[0.8,'#1a9850']] },
  temperature_2m:  { property: 'value', stops: [[-5,'#2166ac'],[5,'#74add1'],[15,'#fee090'],[25,'#f46d43'],[35,'#a50026']] },
  precipitation:   { property: 'value', stops: [[0,'#f7fbff'],[20,'#c6dbef'],[50,'#6baed6'],[100,'#2171b5'],[200,'#08306b']] },
  dewpoint_2m:     { property: 'value', stops: [[-10,'#f7fcfd'],[0,'#99d8c9'],[10,'#41ae76'],[20,'#006d2c'],[30,'#00441b']] },
  solar_radiation: { property: 'value', stops: [[0,'#ffffd4'],[5,'#fed98e'],[10,'#fe9929'],[20,'#d95f0e'],[30,'#993404']] },
  'soil_ph_0-5cm': { property: 'value', stops: [[5.0,'#d73027'],[6.0,'#fc8d59'],[6.5,'#fee090'],[7.5,'#91bfdb'],[9.0,'#4575b4']] },
  'soil_ph_5-15cm':{ property: 'value', stops: [[5.0,'#d73027'],[6.0,'#fc8d59'],[6.5,'#fee090'],[7.5,'#91bfdb'],[9.0,'#4575b4']] },
  _soil:           { property: 'value', stops: [[0,'#fff7bc'],[2,'#fee391'],[5,'#fec44f'],[10,'#fe9929'],[20,'#cc4c02']] },
  _generic:        { property: 'value', stops: [[0,'#f7f7f7'],[25,'#d9d9d9'],[50,'#969696'],[75,'#525252'],[100,'#252525']] },
};

function buildColorExpression(featureName) {
  let ramp = COLOR_RAMPS[featureName];
  if (!ramp) ramp = featureName.startsWith('soil_') ? COLOR_RAMPS._soil : COLOR_RAMPS._generic;
  const { property: prop, stops } = ramp;
  return [
    'interpolate', ['linear'],
    ['coalesce', ['get', prop], stops[0][0]],
    ...stops.flatMap(([v, c]) => [v, c]),
  ];
}

// ── Layer setup — called on initial load and after setStyle ────────────────
function setupLayers() {
  // ── Polygon source (bbox-filtered, updated on move) ──────────────────────
  if (!map.getSource(CELL_SOURCE)) {
    map.addSource(CELL_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  // ── Centroid source (all res-6 Points, loaded once, clustered by MapLibre) ─
  if (!map.getSource(CENTROID_SOURCE)) {
    map.addSource(CENTROID_SOURCE, {
      type: 'geojson',
      data: '/api/cells/centroids',
      cluster: true,
      clusterMaxZoom: CLUSTER_THRESHOLD - 1,  // cluster up to zoom 7; at 8+ show dots
      clusterRadius: 60,
    });
  }

  // ── Cluster layers ────────────────────────────────────────────────────────
  if (!map.getLayer(CLUSTER_LAYER)) {
    map.addLayer({
      id: CLUSTER_LAYER,
      type: 'circle',
      source: CENTROID_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#22c55e',        // green:  0 – 99
          100,  '#eab308',  // yellow: 100 – 499
          500,  '#f97316',  // orange: 500 – 999
          1000, '#ef4444',  // red:    1000+
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          18, 100, 24, 500, 30, 1000, 38,
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
      },
    });

    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: CENTROID_SOURCE,
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
      id: UNCLUSTERED_LAYER,
      type: 'circle',
      source: CENTROID_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#22c55e',
        'circle-radius': 7,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff',
      },
    });
  }

  // ── Polygon layers ────────────────────────────────────────────────────────
  if (!map.getLayer(FILL_LAYER)) {
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: CELL_SOURCE,
      paint: {
        'fill-color': buildColorExpression(currentFeature),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.75, 0.45],
      },
    });

    const outlineColor = currentTheme === 'dark' ? '#ffffff' : '#334155';
    map.addLayer({
      id: OUTLINE_LAYER,
      type: 'line',
      source: CELL_SOURCE,
      paint: {
        'line-color': outlineColor,
        'line-width': ['case', ['boolean', ['feature-state', 'hovered'], false], 1.8, 0.3],
        'line-opacity': 0.5,
      },
    });

    map.addLayer({
      id: HOVER_LAYER,
      type: 'fill',
      source: CELL_SOURCE,
      paint: { 'fill-color': 'transparent', 'fill-opacity': 0 },
    });
  }

  // Apply the mode appropriate for the current zoom level
  const initialMode = calcMode();
  currentMode = initialMode;
  currentResolution = initialMode === 'res9' ? 9 : 6;
  updateResolutionBadge();
  updateRadioAvailability();
  applyModeVisibility(initialMode);

  if (initialMode !== 'cluster') {
    if (initialMode === 'res6' && TERRAIN_FEATURE_NAMES_SET.has(currentFeature)) {
      setFeature(DEFAULT_FEATURE_RES6);  // setFeature calls fetchCells
    } else {
      fetchCells();
    }
  }
}

// ── Mode helpers ───────────────────────────────────────────────────────────
function calcMode() {
  const z = map.getZoom();
  if (z < CLUSTER_THRESHOLD) return 'cluster';
  if (z < ZOOM_THRESHOLD)    return 'res6';
  return 'res9';
}

function applyModeVisibility(mode) {
  const clusterVis = mode === 'cluster' ? 'visible' : 'none';
  const polyVis    = mode !== 'cluster'  ? 'visible' : 'none';
  [CLUSTER_LAYER, CLUSTER_COUNT_LAYER, UNCLUSTERED_LAYER].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', clusterVis);
  });
  [FILL_LAYER, OUTLINE_LAYER, HOVER_LAYER].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', polyVis);
  });
}

function setMode(newMode) {
  if (newMode === currentMode) return;
  currentMode = newMode;
  currentResolution = newMode === 'res9' ? 9 : 6;
  updateResolutionBadge();
  applyModeVisibility(newMode);

  if (newMode === 'cluster') return;  // centroid source auto-renders; no fetch needed

  updateRadioAvailability();
  if (currentResolution === 6 && TERRAIN_FEATURE_NAMES_SET.has(currentFeature)) {
    setFeature(DEFAULT_FEATURE_RES6);  // setFeature calls fetchCells
    return;
  }
  fetchCells();
}

// ── Resolution/radio helpers ───────────────────────────────────────────────
function updateRadioAvailability() {
  document.querySelectorAll('input[name="colorFeature"]').forEach(radio => {
    radio.disabled = currentResolution !== 9 && !WEATHER_FEATURE_NAMES.has(radio.value);
  });
}

function updateResolutionBadge() {
  const badge = document.getElementById('resolution-badge');
  if (badge) badge.textContent = currentMode === 'cluster' ? 'H3 cluster' : `H3 res-${currentResolution}`;
}

// ── Feature selector (exposed on window so panel.js can call it) ───────────
function setFeature(name) {
  currentFeature = name;
  const radio = document.querySelector(`input[name="colorFeature"][value="${CSS.escape(name)}"]`);
  if (radio) radio.checked = true;
  if (map.getLayer(FILL_LAYER)) {
    map.setPaintProperty(FILL_LAYER, 'fill-color', buildColorExpression(name));
  }
  fetchCells();
}

// ── Map event handlers ─────────────────────────────────────────────────────
function onZoomEnd() {
  setMode(calcMode());
}

function onMouseMove(e) {
  map.getCanvas().style.cursor = 'pointer';
  const feat = e.features?.[0];
  if (!feat) return;

  const h3id = feat.properties.h3_id;
  if (h3id !== hoveredH3Id) {
    if (hoveredH3Id !== null) {
      map.setFeatureState({ source: CELL_SOURCE, id: hoveredH3Id }, { hovered: false });
    }
    hoveredH3Id = h3id;
    map.setFeatureState({ source: CELL_SOURCE, id: h3id }, { hovered: true });
  }

  const tooltip = document.getElementById('map-tooltip');
  const elev = feat.properties.elevation != null
    ? `${Number(feat.properties.elevation).toFixed(0)} m` : '—';
  const val = feat.properties.value != null
    ? `${Number(feat.properties.value).toFixed(3)} ${feat.properties.value_unit ?? ''}`.trim() : '';

  tooltip.hidden = false;
  tooltip.style.left = `${e.point.x + 14}px`;
  tooltip.style.top = `${e.point.y - 10}px`;
  tooltip.innerHTML = `
    <div class="tooltip-id">${h3id}</div>
    <div class="tooltip-row"><span>Elevation</span><span>${elev}</span></div>
    ${val ? `<div class="tooltip-row"><span>${formatFeatureName(currentFeature)}</span><span>${val}</span></div>` : ''}
  `;
}

function onMouseLeave() {
  map.getCanvas().style.cursor = '';
  if (hoveredH3Id !== null) {
    map.setFeatureState({ source: CELL_SOURCE, id: hoveredH3Id }, { hovered: false });
    hoveredH3Id = null;
  }
  document.getElementById('map-tooltip').hidden = true;
}

function onCellClick(e) {
  const feat = e.features?.[0];
  if (feat) window.openCellPanel(feat.properties.h3_id);
}

// ── Data fetching ──────────────────────────────────────────────────────────
function getBbox() {
  const b = map.getBounds();
  return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
}

async function fetchCells() {
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  const url = `/api/cells?bbox=${getBbox()}&feature=${encodeURIComponent(currentFeature)}&resolution=${currentResolution}`;

  try {
    const resp = await fetch(url, { signal: fetchController.signal });
    if (!resp.ok) { console.warn('fetchCells failed', resp.status, url); return; }
    const geojson = await resp.json();

    console.debug(`fetchCells res-${currentResolution} ${currentFeature}: ${geojson.features.length} cells`);
    geojson.features.forEach((f, i) => { f.id = i; });
    window._h3ToId = {};
    geojson.features.forEach(f => { window._h3ToId[f.properties.h3_id] = f.id; });

    map.getSource(CELL_SOURCE)?.setData(geojson);
  } catch (err) {
    if (err.name !== 'AbortError') console.error('fetchCells error:', err);
  }
}

// ── Theme toggle ───────────────────────────────────────────────────────────
function updateThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.textContent = currentTheme === 'dark' ? '☀' : '🌙';
  btn.title = currentTheme === 'dark' ? 'Switch to light map' : 'Switch to dark map';
}

function switchTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('mapTheme', theme);
  updateThemeButton();
  map.setStyle(makeStyle(theme));
  map.once('style.load', setupLayers);
}

// ── Init ──────────────────────────────────────────────────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: makeStyle(currentTheme),
    center: TURKEY_CENTER,
    zoom: INITIAL_ZOOM,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  map.on('load', () => { setupLayers(); });

  // moveend: only re-fetch polygon cells; cluster source auto-updates
  map.on('moveend', () => { if (currentMode !== 'cluster') fetchCells(); });
  map.on('zoomend', onZoomEnd);
  map.on('mousemove', HOVER_LAYER, onMouseMove);
  map.on('mouseleave', HOVER_LAYER, onMouseLeave);
  map.on('click', HOVER_LAYER, onCellClick);

  // Cluster click: zoom to expansion zoom
  map.on('click', CLUSTER_LAYER, e => {
    const clusterId = e.features[0].properties.cluster_id;
    map.getSource(CENTROID_SOURCE).getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (!err) map.easeTo({ center: e.features[0].geometry.coordinates, zoom: zoom + 0.5 });
    });
  });
  map.on('mouseenter', CLUSTER_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', CLUSTER_LAYER, () => { map.getCanvas().style.cursor = ''; });
}

// Exposed for panel.js to call after building radios
window.setFeature = setFeature;
window.getCurrentFeature = () => currentFeature;
window.getCurrentResolution = () => currentResolution;
window.updateRadioAvailability = updateRadioAvailability;

document.addEventListener('DOMContentLoaded', () => {
  updateThemeButton();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    switchTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });
  initMap();
});

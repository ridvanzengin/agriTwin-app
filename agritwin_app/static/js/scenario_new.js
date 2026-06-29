/* global maplibregl, MapboxDraw */

const KONYA_CENTER = [32.5, 37.87];
const INITIAL_ZOOM = 9;

const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const LIGHT_STYLE = {
    version: 8,
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

// H3 res-9 cell area in km² (global average)
const H3_RES9_AREA_KM2 = 0.105;
const MAX_CELLS        = 30_000;
const WARN_CELLS       = 10_000;

const map = new maplibregl.Map({
    container: 'draw-map',
    style: LIGHT_STYLE,
    center: KONYA_CENTER,
    zoom: INITIAL_ZOOM,
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

// ── MapLibre GL Draw ──────────────────────────────────────────────────────────
const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true },
    defaultMode: 'draw_polygon',
});
map.addControl(draw);

const polygonWktInput   = document.getElementById('polygon-wkt');
const polygonStatus     = document.getElementById('polygon-status');
const redrawBtn         = document.getElementById('redraw-btn');
const submitBtn         = document.getElementById('submit-btn');
const scenarioNameInput = document.getElementById('scenario-name');
const submitError       = document.getElementById('submit-error');

function ringToWkt(coords) {
    const ring = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
    return `POLYGON((${ring}))`;
}

// Shoelace formula in km² using per-polygon centre latitude for accuracy.
function approxAreaKm2(ringCoords) {
    const avgLat = ringCoords.reduce((s, c) => s + c[1], 0) / ringCoords.length;
    const kmPerLng = Math.cos(avgLat * Math.PI / 180) * 111.32;
    const kmPerLat = 110.54;
    let area = 0;
    const n = ringCoords.length;
    for (let i = 0; i < n - 1; i++) {
        area += (ringCoords[i][0] * kmPerLng)     * (ringCoords[i + 1][1] * kmPerLat)
              - (ringCoords[i + 1][0] * kmPerLng) * (ringCoords[i][1] * kmPerLat);
    }
    return Math.abs(area) / 2;
}

function estimateCells(ringCoords) {
    return Math.round(approxAreaKm2(ringCoords) / H3_RES9_AREA_KM2);
}

let polygonTooLarge = false;

function onPolygonChange() {
    const poly = draw.getAll().features.find(f => f.geometry.type === 'Polygon');
    polygonTooLarge = false;

    if (poly) {
        redrawBtn.style.display = 'flex';
        const wkt       = ringToWkt(poly.geometry.coordinates[0]);
        const cellCount = estimateCells(poly.geometry.coordinates[0]);
        const cellStr   = cellCount.toLocaleString();
        polygonWktInput.value = wkt;

        if (cellCount > MAX_CELLS) {
            polygonTooLarge = true;
            polygonStatus.className = 'polygon-status error';
            polygonStatus.querySelector('.status-icon').innerHTML = svgAlert();
            polygonStatus.querySelector('.status-text').textContent =
                `Too large (~${cellStr} cells). Draw a smaller polygon — limit is 30,000 grids.`;
        } else if (cellCount > WARN_CELLS) {
            polygonStatus.className = 'polygon-status warning';
            polygonStatus.querySelector('.status-icon').innerHTML = svgWarn();
            polygonStatus.querySelector('.status-text').textContent =
                `Large area (~${cellStr} grids). Simulation may take a few minutes.`;
        } else {
            polygonStatus.className = 'polygon-status ready';
            polygonStatus.querySelector('.status-icon').innerHTML = svgOk();
            polygonStatus.querySelector('.status-text').textContent =
                `Polygon ready (~${cellStr} grids)`;
        }
    } else {
        redrawBtn.style.display = 'none';
        polygonWktInput.value = '';
        polygonStatus.className = 'polygon-status empty';
        polygonStatus.querySelector('.status-icon').innerHTML = svgShield();
        polygonStatus.querySelector('.status-text').textContent =
            'No polygon drawn yet — use the polygon tool on the map';
    }

    validateForm();
}

function validateForm() {
    const hasPolygon = polygonWktInput.value.trim() !== '';
    const hasName    = scenarioNameInput.value.trim() !== '';
    submitBtn.disabled = !(hasPolygon && hasName && !polygonTooLarge);
}

// ── Polygon lifecycle ─────────────────────────────────────────────────────────

// Prevents re-entrant calls when draw.deleteAll() fires draw.delete /
// draw.selectionchange as side-effects of our own clearPolygon().
let _clearing = false;

function clearPolygon() {
    if (_clearing) return;
    _clearing = true;
    draw.deleteAll();
    onPolygonChange();
    // Defer mode switch: Draw's internal event handlers run synchronously
    // after draw.create / draw.delete; changeMode called here would be
    // overridden by Draw's own cleanup.  setTimeout lets Draw finish first.
    setTimeout(() => {
        draw.changeMode('draw_polygon');
        _clearing = false;
    }, 0);
}

// After draw.create Draw resets the mode internally.  We defer our
// simple_select switch so it runs after Draw's own post-create handling.
map.on('draw.create', (e) => {
    onPolygonChange();
    const id = e.features[0].id;
    setTimeout(() => {
        draw.changeMode('simple_select', { featureIds: [id] });
    }, 0);
});

map.on('draw.update', onPolygonChange);

// Fired by trash icon and Delete/Backspace key (NOT by draw.deleteAll()).
map.on('draw.delete', () => {
    if (_clearing) return;
    onPolygonChange();
    setTimeout(() => draw.changeMode('draw_polygon'), 0);
});

// Clicking outside the selected polygon deselects it → selection becomes
// empty → treat as cancel and clear the polygon.
let _ignoreSelChange = false;
map.on('draw.selectionchange', (e) => {
    if (_ignoreSelChange || _clearing) return;
    if (e.features.length === 0 && draw.getAll().features.length > 0) {
        _ignoreSelChange = true;
        clearPolygon();
        setTimeout(() => { _ignoreSelChange = false; }, 50);
    }
});

// Right-click: Draw intercepts the contextmenu event at the canvas level
// before it reaches MapLibre's event bus.  Listen directly on the canvas.
map.getCanvas().addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (draw.getAll().features.length > 0) {
        clearPolygon();
    }
});

// Explicit "Redraw" button in the form panel — always-works fallback.
redrawBtn.addEventListener('click', clearPolygon);

scenarioNameInput.addEventListener('input', validateForm);

// ── Form submission ───────────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
    if (!SCENARIO_CREATION_ENABLED) {
        const notice = document.getElementById('demo-notice');
        if (notice) {
            notice.hidden = false;
            notice.classList.remove('demo-notice-hide');
            clearTimeout(notice._hideTimer);
            notice._hideTimer = setTimeout(() => {
                notice.classList.add('demo-notice-hide');
                notice.addEventListener('animationend', () => {
                    notice.hidden = true;
                    notice.classList.remove('demo-notice-hide');
                }, { once: true });
            }, 6000);
        }
        return;
    }

    submitError.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const payload = {
        name:     scenarioNameInput.value.trim(),
        polygon:  polygonWktInput.value,
        overrides: {
            precipitation:      parseFloat(document.getElementById('ov-precip').value) || 0,
            temperature_2m:     parseFloat(document.getElementById('ov-temp').value) || 0,
            temperature_2m_min: parseFloat(document.getElementById('ov-tmin').value) || 0,
            'soil_ph_0-5cm':    parseFloat(document.getElementById('ov-ph').value) || 0,
        },
    };

    try {
        const resp = await fetch('/api/scenarios', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        if (resp.status === 201) {
            window.location.href = '/scenarios';
        } else {
            const err = await resp.json();
            submitError.textContent = err.error || 'Unknown error';
            submitError.style.display = 'block';
            submitBtn.textContent = 'Create Simulation';
            validateForm();
        }
    } catch (e) {
        submitError.textContent = 'Network error — please try again.';
        submitError.style.display = 'block';
        submitBtn.textContent = 'Create Simulation';
        validateForm();
    }
});

// ── SVG helpers ───────────────────────────────────────────────────────────────
function svgShield() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
}
function svgOk() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
}
function svgWarn() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
}
function svgAlert() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}

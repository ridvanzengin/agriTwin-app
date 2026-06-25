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

const polygonWktInput  = document.getElementById('polygon-wkt');
const polygonStatus    = document.getElementById('polygon-status');
const submitBtn        = document.getElementById('submit-btn');
const scenarioNameInput = document.getElementById('scenario-name');
const submitError      = document.getElementById('submit-error');

function ringToWkt(coords) {
    const ring = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
    return `POLYGON((${ring}))`;
}

function onPolygonChange() {
    const data = draw.getAll();
    const poly = data.features.find(f => f.geometry.type === 'Polygon');
    if (poly) {
        const wkt = ringToWkt(poly.geometry.coordinates[0]);
        polygonWktInput.value = wkt;
        polygonStatus.className = 'polygon-status ready';
        polygonStatus.querySelector('span').textContent = 'Polygon drawn — ready';
    } else {
        polygonWktInput.value = '';
        polygonStatus.className = 'polygon-status empty';
        polygonStatus.querySelector('span').textContent = 'No polygon drawn yet';
    }
    validateForm();
}

function validateForm() {
    const hasPolygon = polygonWktInput.value.trim() !== '';
    const hasName    = scenarioNameInput.value.trim() !== '';
    submitBtn.disabled = !(hasPolygon && hasName);
}

map.on('draw.create',  onPolygonChange);
map.on('draw.update',  onPolygonChange);
map.on('draw.delete',  onPolygonChange);
scenarioNameInput.addEventListener('input', validateForm);

// ── Form submission ───────────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
    submitError.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const payload = {
        name:     scenarioNameInput.value.trim(),
        polygon:  polygonWktInput.value,
        overrides: {
            precipitation:       parseFloat(document.getElementById('ov-precip').value) || 0,
            temperature_2m:      parseFloat(document.getElementById('ov-temp').value) || 0,
            temperature_2m_min:  parseFloat(document.getElementById('ov-tmin').value) || 0,
            'soil_ph_0-5cm':     parseFloat(document.getElementById('ov-ph').value) || 0,
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

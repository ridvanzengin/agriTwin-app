/* global Chart, formatFeatureName */

// ── State ──────────────────────────────────────────────────────────────────
let ndviChart = null;
let weatherChart = null;
let suitabilityChart = null;
let isResizing = false;
let cachedFeatures = null;  // populated once from GET /api/features
let currentPanelH3Id = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(value, unit) {
  if (value == null) return '—';
  const rounded = Number(value).toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${rounded} ${unit}` : rounded;
}

function destroyChart(chartRef) {
  chartRef?.destroy();
  return null;
}

// ── Tab switching ─────────────────────────────────────────────────────────
function activateTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.panel-tab-content').forEach(div => {
    div.classList.toggle('active', div.id === `tab-${tabName}`);
  });
  if (tabName === 'historic') {
    ndviChart?.resize();
    weatherChart?.resize();
  }
  if (tabName === 'suitability' && currentPanelH3Id) {
    loadSuitabilityTab(currentPanelH3Id);
  }
}

// ── Latest tab — 4 ordered sections ───────────────────────────────────────
function populateTerrain(cell) {
  document.getElementById('attr-elevation').textContent =
    cell.elevation != null ? `${Number(cell.elevation).toFixed(1)} m` : '—';
  document.getElementById('attr-slope').textContent =
    cell.slope != null ? `${Number(cell.slope).toFixed(2)}°` : '—';
  document.getElementById('attr-aspect').textContent =
    cell.aspect != null ? `${Number(cell.aspect).toFixed(1)}°` : '—';
}

function populateSection(sectionId, attrsId, features) {
  const section = document.getElementById(sectionId);
  const attrsEl = document.getElementById(attrsId);
  if (!section || !attrsEl) return;
  section.hidden = false;
  if (!features.length) {
    attrsEl.innerHTML = '<dt class="no-data-note" style="grid-column:1/-1">No data for this cell</dt>';
    return;
  }
  attrsEl.innerHTML = features.map(f => `
    <dt><label class="feat-label">
      <input type="radio" name="colorFeature" value="${f.name}">
      ${formatFeatureName(f.name)}
    </label></dt><dd>${fmt(f.latest_value, f.unit)}</dd>
  `).join('');
}

function buildLatestTab(cell, resolution) {
  populateTerrain(cell);

  const byCategory = { weather: [], soil: [], vegetation: [] };
  for (const f of (cell.features ?? [])) {
    if (byCategory[f.category] !== undefined) byCategory[f.category].push(f);
  }

  // At res-6, soil/vegetation have no observations. Inject placeholder rows from
  // the cached feature catalogue so the user sees the feature names (disabled,
  // "—" values) instead of "No data for this cell".
  if (resolution === 6 && cachedFeatures) {
    if (!byCategory.soil.length)
      byCategory.soil = cachedFeatures
        .filter(f => f.category === 'soil')
        .map(f => ({ ...f, latest_value: null, latest_timestamp: null }));
    if (!byCategory.vegetation.length)
      byCategory.vegetation = cachedFeatures
        .filter(f => f.category === 'vegetation')
        .map(f => ({ ...f, latest_value: null, latest_timestamp: null }));
  }

  populateSection('section-weather',    'attrs-weather',    byCategory.weather);
  populateSection('section-soil',       'attrs-soil',       byCategory.soil);
  populateSection('section-vegetation', 'attrs-vegetation', byCategory.vegetation);
}

// ── Historic tab — charts ─────────────────────────────────────────────────
const CHART_GRID = '#1e293b';
const CHART_TICK = '#94a3b8';

function renderNdviChart(data) {
  ndviChart = destroyChart(ndviChart);
  const card = document.getElementById('card-ndvi');
  const canvas = document.getElementById('chart-ndvi');
  if (!data?.data?.length) { card.hidden = true; return; }
  card.hidden = false;

  ndviChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.data.map(d => d.timestamp.slice(0, 10)),
      datasets: [{
        label: 'NDVI',
        data: data.data.map(d => d.value),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.12)',
        borderWidth: 1.5, pointRadius: 2, fill: true, tension: 0.3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_TICK, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_TICK }, grid: { color: CHART_GRID } },
      },
    },
  });
}

function renderWeatherChart(tempData, precipData) {
  weatherChart = destroyChart(weatherChart);
  const card = document.getElementById('card-weather-chart');
  const canvas = document.getElementById('chart-weather');
  const hasTemp = tempData?.data?.length > 0;
  const hasPrec = precipData?.data?.length > 0;
  if (!hasTemp && !hasPrec) { card.hidden = true; return; }
  card.hidden = false;

  const source = hasTemp ? tempData : precipData;
  const labels = source.data.map(d => d.timestamp.slice(0, 7));
  const datasets = [];

  if (hasTemp) datasets.push({
    label: 'Temp (°C)', type: 'line',
    data: tempData.data.map(d => d.value),
    borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)',
    borderWidth: 1.5, pointRadius: 1.5, fill: false, tension: 0.3, yAxisID: 'y',
  });
  if (hasPrec) datasets.push({
    label: 'Precip (mm)', type: 'bar',
    data: precipData.data.map(d => d.value),
    borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.2)',
    borderWidth: 1.5, yAxisID: 'y1',
  });

  weatherChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: CHART_TICK, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x:  { ticks: { color: CHART_TICK, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: CHART_GRID } },
        y:  { position: 'left',  ticks: { color: '#f97316' }, grid: { color: CHART_GRID } },
        y1: { position: 'right', ticks: { color: '#38bdf8' }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

// ── Suitability tab ───────────────────────────────────────────────────────
function scoreToColor(score) {
  if (score == null) return '#cccccc';
  if (score >= 0.75) return '#1a9850';
  if (score >= 0.5)  return '#d9ef8b';
  if (score >= 0.25) return '#fee08b';
  if (score > 0)     return '#fc8d59';
  return '#d73027';
}

async function loadSuitabilityTab(h3Id) {
  const list = document.getElementById('suitability-scores-list');
  if (!list) return;
  list.innerHTML = '<p class="no-data-note">Loading…</p>';

  try {
    const resp = await fetch(`/api/cells/${encodeURIComponent(h3Id)}/scores`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.scores || !data.scores.length) {
      list.innerHTML = '<p class="no-data-note">No scores yet — run scoring first.</p>';
      return;
    }

    suitabilityChart = destroyChart(suitabilityChart);

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-suitability';
    list.innerHTML = '';
    list.appendChild(canvas);

    const labels = data.scores.map(s => s.crop_name);
    const values = data.scores.map(s => s.score ?? 0);
    const colors = data.scores.map(s => scoreToColor(s.score));

    suitabilityChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Suitability score',
          data: values,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            min: 0, max: 1,
            ticks: { color: CHART_TICK },
            grid: { color: CHART_GRID },
          },
          y: { ticks: { color: CHART_TICK }, grid: { color: CHART_GRID } },
        },
      },
    });
  } catch (e) {
    list.innerHTML = '<p class="no-data-note">Failed to load scores.</p>';
    console.error('loadSuitabilityTab error:', e);
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────
async function fetchTimeseries(h3Id, featureName) {
  const resp = await fetch(
    `/api/cells/${encodeURIComponent(h3Id)}/timeseries?feature=${encodeURIComponent(featureName)}&start=2020-01-01`
  );
  return resp.ok ? resp.json() : null;
}

// ── Panel open ────────────────────────────────────────────────────────────
async function openCellPanel(h3Id) {
  currentPanelH3Id = h3Id;
  const panel = document.getElementById('cell-panel');
  const wasHidden = panel.hidden;
  panel.hidden = false;
  document.getElementById('panel-h3id').textContent = h3Id;
  if (wasHidden) activateTab('latest');

  // Loading state
  ['attr-elevation', 'attr-slope', 'attr-aspect'].forEach(id => {
    document.getElementById(id).textContent = '…';
  });
  ['section-weather', 'section-soil', 'section-vegetation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });

  const [cellData, ndviTs, tempTs, precipTs] = await Promise.all([
    fetch(`/api/cells/${encodeURIComponent(h3Id)}`).then(r => r.json()),
    fetchTimeseries(h3Id, 'ndvi'),
    fetchTimeseries(h3Id, 'temperature_2m'),
    fetchTimeseries(h3Id, 'precipitation'),
  ]);

  const resolution = window.getCurrentResolution?.() ?? 9;
  buildLatestTab(cellData, resolution);
  renderNdviChart(ndviTs);
  renderWeatherChart(tempTs, precipTs);

  // Sync the checked radio with whatever feature the map is currently coloring
  const feat = window.getCurrentFeature?.() ?? 'elevation';
  const active = panel.querySelector(`input[name="colorFeature"][value="${CSS.escape(feat)}"]`);
  if (active) active.checked = true;
  window.updateRadioAvailability?.();
}

// ── Resize handle ─────────────────────────────────────────────────────────
function initResizeHandle() {
  const panel = document.getElementById('cell-panel');
  const handle = document.getElementById('panel-resize-handle');
  if (!handle || !panel) return;

  const savedWidth = localStorage.getItem('panelWidth');
  if (savedWidth) {
    const w = Math.max(300, Math.min(900, parseInt(savedWidth, 10)));
    panel.style.width = `${w}px`;
    document.documentElement.style.setProperty('--panel-width', `${w}px`);
  }

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    isResizing = true;
    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const newWidth = Math.max(300, Math.min(900, window.innerWidth - e.clientX));
    panel.style.width = `${newWidth}px`;
    document.documentElement.style.setProperty('--panel-width', `${newWidth}px`);
    ndviChart?.resize();
    weatherChart?.resize();
    suitabilityChart?.resize();
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = parseInt(panel.style.width, 10);
    if (w) localStorage.setItem('panelWidth', String(w));
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Pre-fetch feature catalogue so res-6 panel can show placeholder rows for soil/veg
  fetch('/api/features')
    .then(r => r.ok ? r.json() : [])
    .then(list => { cachedFeatures = list; })
    .catch(() => {});

  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  document.getElementById('panel-close').addEventListener('click', () => {
    document.getElementById('cell-panel').hidden = true;
    currentPanelH3Id = null;
    ndviChart = destroyChart(ndviChart);
    weatherChart = destroyChart(weatherChart);
    suitabilityChart = destroyChart(suitabilityChart);
  });

  // Delegate radio changes: any colorFeature radio click updates the map color
  document.getElementById('cell-panel').addEventListener('change', e => {
    if (e.target.matches('input[name="colorFeature"]') && e.target.checked) {
      window.setFeature?.(e.target.value);
    }
  });

  initResizeHandle();
});

window.openCellPanel = openCellPanel;

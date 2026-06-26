/* global SCENARIO_ID, SCENARIO_OVERRIDES, Chart */

const CROP_ORDER = ['Wheat', 'Barley', 'Sugar Beet', 'Sunflower', 'Maize', 'Chickpea', 'Lentil', 'Cotton'];

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const OVERRIDE_META = {
    precipitation:      { label: 'Precipitation',    unit: 'mm/month' },
    temperature_2m:     { label: 'Mean Temp',         unit: '°C' },
    temperature_2m_min: { label: 'Min Temp',          unit: '°C' },
    'soil_ph_0-5cm':    { label: 'Soil pH',           unit: '' },
};

const panel    = document.getElementById('scen-panel');
const closeBtn = document.getElementById('scen-panel-close');
const cellIdEl = document.getElementById('scen-cell-id');

function scoreColor(s) {
    if (s === null || s === undefined) return '#475569';
    if (s >= 0.7) return '#22c55e';
    if (s >= 0.4) return '#f59e0b';
    return '#ef4444';
}

function trapScore(value, min, optimal, max) {
    if (value === null || min === null || max === null) return 0;
    if (value <= min || value >= max) return 0;
    if (optimal !== null) {
        if (value < optimal) return (value - min) / (optimal - min || 1);
        if (value > optimal) return (max - value) / (max - optimal || 1);
        return 1;
    }
    return (value - min) / (max - min || 1);
}

// ── Panel close ───────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

// ── Resize handle ─────────────────────────────────────────────────────────────
(function () {
    const handle      = document.getElementById('scen-resize-handle');
    const STORAGE_KEY = 'scen-panel-width';
    let startX, startW;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) panel.style.width = saved + 'px';

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = panel.offsetWidth;
        handle.classList.add('resizing');
        function onMove(ev) {
            const newW = Math.max(300, Math.min(680, startW + (startX - ev.clientX)));
            panel.style.width = newW + 'px';
        }
        function onUp() {
            handle.classList.remove('resizing');
            localStorage.setItem(STORAGE_KEY, panel.offsetWidth);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}());

// ── Override chips (rendered once when panel first opens) ─────────────────────
let _overridesRendered = false;
function renderOverrideChips() {
    const bar = document.getElementById('scen-overrides-bar');
    const entries = Object.entries(SCENARIO_OVERRIDES);
    if (entries.length === 0) return;

    bar.innerHTML = '';
    entries.forEach(([key, delta]) => {
        const meta = OVERRIDE_META[key];
        if (!meta) return;
        const sign = delta > 0 ? '+' : '';
        const unitStr = meta.unit ? ` ${meta.unit}` : '';
        const chip = document.createElement('span');
        chip.className = 'scen-override-chip';
        chip.textContent = `${meta.label}: ${sign}${delta}${unitStr}`;
        bar.appendChild(chip);
    });
    bar.style.display = 'flex';
}

// ── Requirement charts ────────────────────────────────────────────────────────
// Keyed by feature name so state survives crop/cell switches.
const _openDrawers      = new Set();   // feature names whose drawer is open
const _reqChartInstances = {};          // feature_name → Chart instance

function _destroyAllCharts() {
    Object.values(_reqChartInstances).forEach(c => c.destroy());
    Object.keys(_reqChartInstances).forEach(k => delete _reqChartInstances[k]);
}

function _avgScore(months, valueKey) {
    const valid = months.filter(m => m[valueKey] !== null && m.req_min !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s, m) => s + trapScore(m[valueKey], m.req_min, m.req_optimal, m.req_max), 0) / valid.length;
}

function _buildReqChart(feature, req) {
    if (_reqChartInstances[feature]) {
        _reqChartInstances[feature].destroy();
        delete _reqChartInstances[feature];
    }
    const canvas = document.getElementById(`scen-req-canvas-${feature}`);
    if (!canvas) return;

    const { unit, months } = req;

    // Chart shows only the ideal range band — spanGaps: true connects across
    // off-season null months, producing a continuous year-long green area.
    // Convention mirrors suitability_panel.js: fill: '+1' on reqMin.
    _reqChartInstances[feature] = new Chart(canvas, {
        type: 'line',
        data: {
            labels: MONTH_LABELS,
            datasets: [
                {
                    data: months.map(m => m.req_min),
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.18)',
                    borderWidth: 0,
                    fill: '+1',
                    pointRadius: 0,
                    tension: 0.3,
                    spanGaps: true,
                },
                {
                    data: months.map(m => m.req_max),
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.18)',
                    borderWidth: 0,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.3,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 2, right: 2, bottom: 2, left: 2 } },
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    grid:  { color: 'rgba(148,163,184,0.08)' },
                },
                y: {
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    grid:  { color: 'rgba(148,163,184,0.08)' },
                    title: unit ? { display: true, text: unit, color: '#94a3b8', font: { size: 10 } } : { display: false },
                },
            },
        },
    });
}

// ── Requirements section ──────────────────────────────────────────────────────
let _currentReqH3Id = null;

async function loadRequirementsSection(h3Id, cropName) {
    _currentReqH3Id = h3Id;
    const section = document.getElementById('scen-requirements-section');
    _destroyAllCharts();
    // Do NOT clear _openDrawers — drawer state persists across cell/crop switches.

    const crop = encodeURIComponent(cropName || window.currentCrop || 'Wheat');
    const resp = await fetch(`/api/scenarios/${SCENARIO_ID}/cells/${encodeURIComponent(h3Id)}/requirements?crop=${crop}`);
    if (!resp.ok) { section.innerHTML = ''; return; }
    const data = await resp.json();
    if (data.length === 0) { section.innerHTML = ''; return; }

    section.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = 'Parameter Scores — Before / After';
    card.appendChild(title);

    data.forEach((req) => {
        const { feature, label, unit, delta, months } = req;

        const beforeScore = _avgScore(months, 'baseline_value');
        const afterScore  = _avgScore(months, 'scenario_value');

        const beforeStr = beforeScore !== null ? beforeScore.toFixed(2) : '—';
        const afterStr  = afterScore  !== null ? afterScore.toFixed(2)  : '—';
        const diff      = beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null;
        const barWidth  = afterScore  !== null ? (afterScore * 100).toFixed(1) + '%' : '0%';
        const barColor  = scoreColor(afterScore);

        const wrapId   = `scen-req-wrap-${feature}`;
        const canvasId = `scen-req-canvas-${feature}`;

        const rowEl = document.createElement('div');
        rowEl.className = 'suit-crop-row';
        rowEl.innerHTML = `
            <div class="scen-req-item">
              <span class="suit-crop-name">${label}</span>
              <span class="scen-score-pair">
                <span class="scen-before">${beforeStr}</span>
                <span class="scen-arrow">→</span>
                <span class="scen-after" style="color:${barColor}">${afterStr}</span>
                ${diff !== null ? `<span class="scen-req-diff" style="color:${diff >= 0 ? '#22c55e' : '#ef4444'}">(${diff >= 0 ? '+' : ''}${diff.toFixed(2)})</span>` : ''}
              </span>
              <div class="suit-score-track">
                <div class="suit-score-bar" style="width:${barWidth}; background:${barColor};"></div>
              </div>
              <button class="scen-req-expand" aria-expanded="false" title="Show ideal range">▼</button>
            </div>
            <div class="scen-req-chart-wrap" id="${wrapId}" style="display:none">
              <canvas id="${canvasId}"></canvas>
            </div>`;
        card.appendChild(rowEl);

        const btn  = rowEl.querySelector('.scen-req-expand');
        const wrap = document.getElementById(wrapId);

        const autoOpening = _openDrawers.has(feature);
        if (autoOpening) {
            wrap.style.display = 'block';
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = '▲';
            _buildReqChart(feature, req);
        }

        btn.addEventListener('click', () => {
            const open = btn.getAttribute('aria-expanded') === 'true';
            if (open) {
                wrap.style.display = 'none';
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = '▼';
                _openDrawers.delete(feature);
                if (_reqChartInstances[feature]) {
                    _reqChartInstances[feature].destroy();
                    delete _reqChartInstances[feature];
                }
            } else {
                wrap.style.display = 'block';
                btn.setAttribute('aria-expanded', 'true');
                btn.textContent = '▲';
                _openDrawers.add(feature);
                _buildReqChart(feature, req);
                setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
            }
        });
    });

    section.appendChild(card);
}

// ── Public entry point (called by scenario_result_map.js) ─────────────────────
window.loadScenarioPanel = async function (h3Id) {
    cellIdEl.textContent = h3Id;
    panel.classList.remove('hidden');

    if (!_overridesRendered) {
        renderOverrideChips();
        _overridesRendered = true;
    }

    const cropsSection = document.getElementById('scen-crops-section');
    cropsSection.innerHTML = '<p style="color:#64748b;padding:0.5rem 0;font-size:0.8125rem">Loading…</p>';
    document.getElementById('scen-requirements-section').innerHTML = '';

    const [cropResp] = await Promise.all([
        fetch(`/api/scenarios/${SCENARIO_ID}/cells/${encodeURIComponent(h3Id)}`),
        loadRequirementsSection(h3Id, window.currentCrop || 'Wheat'),
    ]);

    if (!cropResp.ok) {
        cropsSection.innerHTML = '<p style="color:#ef4444;padding:0.5rem 0;font-size:0.8125rem">Failed to load cell data.</p>';
        return;
    }
    const data = await cropResp.json();
    const scoreMap = Object.fromEntries(data.map(r => [r.crop_name, r]));

    cropsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = 'Crop Comparison — Before / After';
    card.appendChild(title);

    for (const cropName of CROP_ORDER) {
        const row = scoreMap[cropName];
        const before = row?.baseline_score ?? null;
        const after  = row?.scenario_score ?? null;

        const beforeStr = before !== null ? before.toFixed(2) : '—';
        const afterStr  = after  !== null ? after.toFixed(2)  : '—';
        const barWidth  = after  !== null ? (after * 100).toFixed(1) + '%' : '0%';
        const barColor  = scoreColor(after);
        const isSelected = cropName === (window.currentCrop || 'Wheat');

        const rowEl = document.createElement('div');
        rowEl.className = 'suit-crop-row';
        rowEl.innerHTML = `
          <label class="suit-crop-label">
            <input type="radio" name="scenCrop" value="${cropName}"${isSelected ? ' checked' : ''}>
            <span class="suit-crop-name">${cropName}</span>
            <span class="scen-score-pair">
              <span class="scen-before" title="Baseline">${beforeStr}</span>
              <span class="scen-arrow">→</span>
              <span class="scen-after" style="color:${barColor}" title="Scenario">${afterStr}</span>
            </span>
            <div class="suit-score-track">
              <div class="suit-score-bar" style="width:${barWidth}; background:${barColor};"></div>
            </div>
          </label>`;
        card.appendChild(rowEl);
    }

    cropsSection.appendChild(card);

    cropsSection.querySelectorAll('input[name="scenCrop"]').forEach(radio => {
        radio.addEventListener('change', () => {
            window.currentCrop = radio.value;
            if (_currentReqH3Id) {
                loadRequirementsSection(_currentReqH3Id, radio.value);
            }
            if (typeof window.refetchScenarioCells === 'function') {
                window.refetchScenarioCells();
            }
        });
    });
};

const CROP_ORDER   = ['Wheat', 'Barley', 'Sugar Beet', 'Sunflower', 'Maize', 'Chickpea', 'Lentil', 'Cotton'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let currentH3Id    = null;
let chartInstances = {};   // feature key → Chart instance
let openDrawers    = new Set(['temperature_2m', 'precipitation']);
let autoOpening    = false;

const panel    = document.getElementById('suit-panel');
const closeBtn = document.getElementById('suit-panel-close');
const cellIdEl = document.getElementById('suit-cell-id');

// ── Trapezoidal fuzzy membership (mirrors the Python scoring engine) ──────────
function trapezoid(v, lo, op, hi) {
    if (v === null || v === undefined) return null;
    const loMissing = lo === null || lo === undefined;
    const hiMissing = hi === null || hi === undefined;
    if (op === null || op === undefined)
        op = loMissing ? hi : hiMissing ? lo : (lo + hi) / 2;
    if (!loMissing && v < lo) return 0;
    if (!hiMissing && v > hi) return 0;
    if (v < op) return (loMissing || op === lo) ? 1 : (v - lo) / (op - lo);
    return (hiMissing || hi === op) ? 1 : (hi - v) / (hi - op);
}

function scoreColor(s) {
    if (s === null || s === undefined) return '#475569';
    if (s >= 0.7) return '#22c55e';
    if (s >= 0.4) return '#f59e0b';
    return '#ef4444';
}

function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 1)   return v.toFixed(1);
    return v.toFixed(2);
}

// ── Panel close ───────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

// ── Resize handle ─────────────────────────────────────────────────────────────
(function () {
    const handle     = document.getElementById('suit-resize-handle');
    const STORAGE_KEY = 'suit-panel-width';
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

// ── Public entry point (called by suitability_map.js on cell click) ───────────
window.loadCellPanel = async function (h3Id) {
    currentH3Id = h3Id;

    // Destroy any open charts and clear feature section
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};
    document.getElementById('suit-features-section').innerHTML = '';

    cellIdEl.textContent = h3Id;
    panel.classList.remove('hidden');

    await loadCropScores(h3Id);
};

// ── Section 1: Crop scores ────────────────────────────────────────────────────
async function loadCropScores(h3Id) {
    const resp = await fetch(`/api/suitability/cells/${encodeURIComponent(h3Id)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const scoreMap = Object.fromEntries(data.map(r => [r.crop_name, r.score]));

    const section = document.getElementById('suit-crops-section');
    section.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = 'Crop Scores';
    card.appendChild(title);

    for (const cropName of CROP_ORDER) {
        const score        = scoreMap[cropName] ?? null;
        const scoreDisplay = score !== null ? score.toFixed(2) : '—';
        const barWidth     = score !== null ? (score * 100).toFixed(1) + '%' : '0%';
        const barColor     = scoreColor(score);
        const isSelected   = cropName === (window.currentCrop || 'Wheat');

        const row = document.createElement('div');
        row.className = 'suit-crop-row';
        row.innerHTML = `
          <label class="suit-crop-label">
            <input type="radio" name="suitCrop" value="${cropName}"${isSelected ? ' checked' : ''}>
            <span class="suit-crop-name">${cropName}</span>
            <div class="suit-score-track">
              <div class="suit-score-bar" style="width:${barWidth}; background:${barColor};"></div>
            </div>
            <span class="suit-score-value">${scoreDisplay}</span>
          </label>`;
        card.appendChild(row);
    }
    section.appendChild(card);

    // Crop radio → recolor map + reload feature breakdown
    section.querySelectorAll('input[name="suitCrop"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            window.currentCrop = radio.value;
            Object.values(chartInstances).forEach(c => c.destroy());
            chartInstances = {};
            if (typeof window.refetchSuitabilityCells === 'function') {
                window.refetchSuitabilityCells();
            }
            if (currentH3Id) await loadFeatureBreakdown(currentH3Id);
        });
    });

    // Load feature breakdown for default/current crop
    await loadFeatureBreakdown(h3Id);
}

// ── Section 2: Feature breakdown ──────────────────────────────────────────────
async function loadFeatureBreakdown(h3Id) {
    const crop = window.currentCrop || 'Wheat';
    const resp = await fetch(
        `/api/suitability/cells/${encodeURIComponent(h3Id)}/monthly?crop=${encodeURIComponent(crop)}`
    );
    if (!resp.ok) return;
    const data = await resp.json();

    const section = document.getElementById('suit-features-section');
    section.innerHTML = '';
    if (!data.length) return;

    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = `Requirements — ${crop}`;
    card.appendChild(title);

    const toOpen = [];
    for (const item of data) {
        const row = item.is_static ? buildStaticRow(item) : buildWeatherRow(item);
        card.appendChild(row);
        if (openDrawers.has(item.feature)) {
            toOpen.push(row.querySelector('.feat-expand-btn'));
        }
    }

    section.appendChild(card);

    autoOpening = true;
    toOpen.forEach(btn => btn.click());
    autoOpening = false;
}

// ── Weather feature row: score bar + expandable monthly chart drawer ───────────
function buildWeatherRow(item) {
    // Mean trapezoid score across growing-season months
    const scored = item.months.filter(m => m.actual !== null);
    const scores = scored.map(m => trapezoid(m.actual, m.req_min, m.req_optimal, m.req_max));
    const score  = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const color  = scoreColor(score);

    const inRange = item.months.filter(m =>
        m.actual !== null && m.req_min !== null &&
        m.actual >= m.req_min && (m.req_max === null || m.actual <= m.req_max)
    ).length;
    const total = item.months.filter(m => m.req_min !== null).length;

    const wrapper = document.createElement('div');
    wrapper.className = 'feat-row feat-weather';
    wrapper.innerHTML = `
      <div class="feat-header">
        <div class="feat-info">
          <span class="feat-name">${item.label}</span>
          <span class="feat-unit">${item.unit}</span>
        </div>
        <div class="feat-score-track">
          <div class="feat-score-bar" style="width:${score !== null ? (score*100).toFixed(1)+'%' : '0%'}; background:${color};"></div>
        </div>
        <span class="feat-score-val" style="color:${color}">${score !== null ? score.toFixed(2) : '—'}</span>
        <button class="feat-expand-btn" aria-label="Toggle chart" aria-expanded="false">
          <svg class="feat-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 6 8 10 12 6"/>
          </svg>
        </button>
      </div>
      <div class="feat-drawer" hidden>
        <div class="feat-chart-wrap">
          <canvas class="feat-chart-canvas"></canvas>
        </div>
      </div>`;

    const btn    = wrapper.querySelector('.feat-expand-btn');
    const drawer = wrapper.querySelector('.feat-drawer');
    const canvas = wrapper.querySelector('.feat-chart-canvas');

    btn.addEventListener('click', () => {
        const isOpen = !drawer.hidden;
        if (isOpen) {
            drawer.hidden = true;
            wrapper.classList.remove('expanded');
            btn.setAttribute('aria-expanded', 'false');
            openDrawers.delete(item.feature);
            if (chartInstances[item.feature]) {
                chartInstances[item.feature].destroy();
                delete chartInstances[item.feature];
            }
        } else {
            drawer.hidden = false;
            wrapper.classList.add('expanded');
            btn.setAttribute('aria-expanded', 'true');
            openDrawers.add(item.feature);
            chartInstances[item.feature] = renderMonthlyChart(canvas, item);
            if (!autoOpening) setTimeout(() => drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
    });

    return wrapper;
}

function renderMonthlyChart(canvas, featureData) {
    const reqMin      = Array(12).fill(null);
    const reqMax      = Array(12).fill(null);
    const actual      = Array(12).fill(null);
    const pointColors = Array(12).fill('rgba(0,0,0,0)');

    // For display, cap unbounded max at a reasonable visual ceiling
    const allActuals = featureData.months.map(m => m.actual).filter(v => v !== null);
    const maxActual  = allActuals.length ? Math.max(...allActuals) : 0;

    for (const m of featureData.months) {
        const idx   = m.month - 1;
        const dispMax = m.req_max ?? Math.max(maxActual * 1.3, m.req_optimal * 2.2);
        reqMin[idx] = m.req_min;
        reqMax[idx] = dispMax;
        actual[idx] = m.actual;
        if (m.actual !== null && m.req_min !== null) {
            const inRange = m.actual >= m.req_min && (m.req_max === null || m.actual <= m.req_max);
            pointColors[idx] = inRange ? '#22c55e' : '#ef4444';
        }
    }

    return new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: MONTH_LABELS,
            datasets: [
                {
                    label: 'Min req',
                    data: reqMin,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.13)',
                    fill: '+1',
                    pointRadius: 0,
                    tension: 0.3,
                    spanGaps: true,
                },
                {
                    label: 'Max req',
                    data: reqMax,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.13)',
                    fill: false,
                    pointRadius: 0,
                    tension: 0.3,
                    spanGaps: true,
                },
                {
                    label: 'Actual',
                    data: actual,
                    borderColor: '#64748b',
                    backgroundColor: 'transparent',
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: pointColors,
                    pointBorderColor: 'transparent',
                    tension: 0.3,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid:  { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    grace: '15%',
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid:  { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });
}

// ── Static feature row: score bar + expandable flat-line chart drawer ─────────
function buildStaticRow(item) {
    const score   = trapezoid(item.actual, item.req_min, item.req_optimal, item.req_max);
    const color   = scoreColor(score);
    const optLabel = item.req_optimal !== null
        ? `Optimal: ${fmtNum(item.req_optimal)} ${item.unit}`
        : '';

    const wrapper = document.createElement('div');
    wrapper.className = 'feat-row feat-static';
    wrapper.innerHTML = `
      <div class="feat-header">
        <div class="feat-info">
          <span class="feat-name">${item.label}</span>
          <span class="feat-unit">${item.unit}</span>
        </div>
        <div class="feat-score-track">
          <div class="feat-score-bar" style="width:${score !== null ? (score*100).toFixed(1)+'%' : '0%'}; background:${color};"></div>
        </div>
        <span class="feat-score-val" style="color:${color}">${score !== null ? score.toFixed(2) : '—'}</span>
        <button class="feat-expand-btn" aria-label="Toggle chart" aria-expanded="false">
          <svg class="feat-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 6 8 10 12 6"/>
          </svg>
        </button>
      </div>
      <div class="feat-drawer" hidden>
        <div class="feat-chart-wrap">
          ${optLabel ? `<span class="feat-chart-legend">${optLabel}</span>` : ''}
          <canvas class="feat-chart-canvas"></canvas>
        </div>
      </div>`;

    const btn    = wrapper.querySelector('.feat-expand-btn');
    const drawer = wrapper.querySelector('.feat-drawer');
    const canvas = wrapper.querySelector('.feat-chart-canvas');

    btn.addEventListener('click', () => {
        const isOpen = !drawer.hidden;
        if (isOpen) {
            drawer.hidden = true;
            wrapper.classList.remove('expanded');
            btn.setAttribute('aria-expanded', 'false');
            openDrawers.delete(item.feature);
            if (chartInstances[item.feature]) {
                chartInstances[item.feature].destroy();
                delete chartInstances[item.feature];
            }
        } else {
            drawer.hidden = false;
            wrapper.classList.add('expanded');
            btn.setAttribute('aria-expanded', 'true');
            openDrawers.add(item.feature);
            chartInstances[item.feature] = renderStaticChart(canvas, item, color);
            if (!autoOpening) setTimeout(() => drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
    });

    return wrapper;
}

function renderStaticChart(canvas, item, color) {
    const unbounded = item.req_max === null;
    const dispMax   = unbounded
        ? Math.max(
            item.actual !== null ? item.actual * 1.6 : item.req_optimal * 3,
            item.req_optimal * 2.5
          )
        : item.req_max;

    const flat = v => Array(12).fill(v);

    return new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: MONTH_LABELS,
            datasets: [
                {
                    label: '__band_lo',
                    data: flat(item.req_min ?? 0),
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.13)',
                    fill: '+1',
                    pointRadius: 0,
                    tension: 0,
                },
                {
                    label: '__band_hi',
                    data: flat(dispMax),
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(34,197,94,0.13)',
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                },
                {
                    label: `Optimal: ${fmtNum(item.req_optimal)} ${item.unit}`,
                    data: flat(item.req_optimal),
                    borderColor: 'rgba(34,197,94,0.6)',
                    borderWidth: 1.5,
                    borderDash: [4, 3],
                    backgroundColor: 'transparent',
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                },
                {
                    label: '__actual',
                    data: item.actual !== null ? flat(item.actual) : flat(null),
                    borderColor: color,
                    borderWidth: 2,
                    backgroundColor: 'transparent',
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend:  { display: false },
                tooltip: { enabled: false },
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid:  { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    grace: '15%',
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid:  { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });
}

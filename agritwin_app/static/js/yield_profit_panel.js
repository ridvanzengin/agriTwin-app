const YP_CROP_ORDER = ['Wheat', 'Barley', 'Sugar Beet', 'Sunflower', 'Maize', 'Chickpea', 'Lentil', 'Cotton'];

let ypCurrentH3Id   = null;
let ypCellData      = [];    // last fetched rows, keyed by crop_name
let ypBreakdownChart = null;

const ypPanel    = document.getElementById('yp-panel');
const ypCloseBtn = document.getElementById('yp-panel-close');
const ypCellIdEl = document.getElementById('yp-cell-id');
const ypCropsEl  = document.getElementById('yp-crops-section');
const ypBreakEl  = document.getElementById('yp-breakdown-section');

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabCrops     = document.getElementById('yp-tab-crops');
const tabBreakdown = document.getElementById('yp-tab-breakdown');

tabCrops.addEventListener('click', () => activateTab('crops'));
tabBreakdown.addEventListener('click', () => activateTab('breakdown'));

function activateTab(name) {
    const isCrops = name === 'crops';
    tabCrops.classList.toggle('active', isCrops);
    tabBreakdown.classList.toggle('active', !isCrops);
    ypCropsEl.style.display  = isCrops ? '' : 'none';
    ypBreakEl.style.display  = isCrops ? 'none' : '';
    if (!isCrops) renderBreakdown();
}

// ── Panel close ───────────────────────────────────────────────────────────────
ypCloseBtn.addEventListener('click', () => ypPanel.classList.add('hidden'));

// ── Resize handle ─────────────────────────────────────────────────────────────
(function () {
    const handle     = document.getElementById('yp-resize-handle');
    const STORAGE_KEY = 'yp-panel-width';
    let startX, startW;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) ypPanel.style.width = saved + 'px';

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = ypPanel.offsetWidth;
        handle.classList.add('resizing');
        function onMove(ev) {
            const newW = Math.max(300, Math.min(680, startW + (startX - ev.clientX)));
            ypPanel.style.width = newW + 'px';
        }
        function onUp() {
            handle.classList.remove('resizing');
            localStorage.setItem(STORAGE_KEY, ypPanel.offsetWidth);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}());

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtYield(v) {
    if (v === null || v === undefined) return '—';
    return v.toFixed(1) + ' t/ha';
}

function fmtProfit(v) {
    if (v === null || v === undefined) return '—';
    const sign = v >= 0 ? '+' : '';
    return sign + '$' + Math.round(v).toLocaleString() + '/ha';
}

function profitColor(v) {
    if (v === null || v === undefined) return '#475569';
    if (v >= 200) return '#22c55e';
    if (v >= 0)   return '#f59e0b';
    return '#ef4444';
}

// ── Public entry point ────────────────────────────────────────────────────────
window.loadYPPanel = async function (h3Id) {
    ypCurrentH3Id = h3Id;
    if (ypBreakdownChart) { ypBreakdownChart.destroy(); ypBreakdownChart = null; }
    ypCellIdEl.textContent = h3Id;
    ypPanel.classList.remove('hidden');

    activateTab('crops');

    const resp = await fetch(`/api/yield-profit/cells/${encodeURIComponent(h3Id)}`);
    if (!resp.ok) return;
    ypCellData = await resp.json();

    renderCropComparison();
};

// ── Tab 1: Crop Comparison ────────────────────────────────────────────────────
function renderCropComparison() {
    const dataMap = Object.fromEntries(ypCellData.map(r => [r.crop_name, r]));

    // Find max absolute net_profit for bar scaling
    const profits = ypCellData.map(r => r.net_profit).filter(v => v !== null && v !== undefined);
    const maxAbs  = profits.length ? Math.max(...profits.map(Math.abs), 1) : 1;

    ypCropsEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = 'Crop Comparison';
    card.appendChild(title);

    // Header row
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex; gap:4px; padding:0 0 6px 0; font-size:10px; color:var(--text-muted);';
    hdr.innerHTML = `
      <span style="width:16px;flex-shrink:0;"></span>
      <span style="width:88px;flex-shrink:0;">Crop</span>
      <span style="width:72px;flex-shrink:0;text-align:right;">Yield</span>
      <span style="flex:1;text-align:right;">Net Profit</span>`;
    card.appendChild(hdr);

    for (const cropName of YP_CROP_ORDER) {
        const row  = dataMap[cropName];
        const prof = row?.net_profit ?? null;
        const yld  = row?.predicted_yield ?? null;
        const color       = profitColor(prof);
        const barWidth    = prof !== null ? (Math.abs(prof) / maxAbs * 100).toFixed(1) + '%' : '0%';
        const isSelected  = cropName === (window.ypCurrentCrop || 'Wheat');

        const rowEl = document.createElement('div');
        rowEl.className = 'suit-crop-row';
        rowEl.innerHTML = `
          <label class="suit-crop-label" style="align-items:center;">
            <input type="radio" name="ypCrop" value="${cropName}"${isSelected ? ' checked' : ''}
                   style="flex-shrink:0; width:13px; height:13px; accent-color:var(--nav-accent); cursor:pointer;">
            <span class="suit-crop-name" style="width:88px;">${cropName}</span>
            <span style="width:72px; flex-shrink:0; text-align:right; font-size:11px; color:var(--text-muted); font-family:monospace;">
              ${fmtYield(yld)}
            </span>
            <div style="flex:1; display:flex; align-items:center; gap:6px; min-width:0;">
              <div class="suit-score-track" style="flex:1;">
                <div class="suit-score-bar" style="width:${barWidth}; background:${color};"></div>
              </div>
              <span class="suit-score-value" style="width:72px; text-align:right; color:${color};">
                ${fmtProfit(prof)}
              </span>
            </div>
          </label>`;

        rowEl.querySelector('input').addEventListener('change', () => {
            window.ypCurrentCrop = cropName;
            if (typeof window.ypRefetchCells === 'function') window.ypRefetchCells();
            if (ypBreakdownChart) { ypBreakdownChart.destroy(); ypBreakdownChart = null; }
            if (ypBreakEl.style.display !== 'none') renderBreakdown();
        });

        card.appendChild(rowEl);
    }

    ypCropsEl.appendChild(card);
}

// ── Tab 2: Cost Breakdown ─────────────────────────────────────────────────────
function renderBreakdown() {
    if (ypBreakdownChart) { ypBreakdownChart.destroy(); ypBreakdownChart = null; }

    const cropName = window.ypCurrentCrop || 'Wheat';
    const row = ypCellData.find(r => r.crop_name === cropName);

    ypBreakEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = `${cropName} — Cost Breakdown`;
    card.appendChild(card.appendChild(title));

    if (!row || row.gross_revenue === null || row.gross_revenue === undefined) {
        const msg = document.createElement('p');
        msg.style.cssText = 'font-size:12px; color:var(--text-muted); margin:16px 0;';
        msg.textContent = 'No price data available for this crop.';
        card.appendChild(msg);
        ypBreakEl.appendChild(card);
        return;
    }

    const COST_LABELS = {
        seed: 'Seed', fertilizer: 'Fertilizer', irrigation: 'Irrigation',
        labor: 'Labor', machinery: 'Machinery', pesticide: 'Pesticide',
    };

    const breakdown = (row.cost_breakdown || []).filter(c => c.cost > 0);
    const costTypes = breakdown.map(c => COST_LABELS[c.cost_type] || c.cost_type);
    const costVals  = breakdown.map(c => c.cost);

    // Summary line
    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex; justify-content:space-between; font-size:12px; margin-bottom:12px; gap:8px; flex-wrap:wrap;';
    summary.innerHTML = `
      <span style="color:var(--text-muted);">Gross Revenue <strong style="color:#22c55e;">$${Math.round(row.gross_revenue).toLocaleString()}/ha</strong></span>
      <span style="color:var(--text-muted);">Total Cost <strong style="color:#ef4444;">$${Math.round(row.total_cost).toLocaleString()}/ha</strong></span>
      <span style="color:var(--text-muted);">Net Profit <strong style="color:${profitColor(row.net_profit)};">${fmtProfit(row.net_profit)}</strong></span>`;
    card.appendChild(summary);

    // Chart.js horizontal bar chart
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; height:' + Math.max(160, breakdown.length * 28 + 20) + 'px;';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    card.appendChild(wrap);

    ypBreakEl.appendChild(card);

    ypBreakdownChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: costTypes,
            datasets: [{
                label: 'Cost (USD/ha)',
                data: costVals,
                backgroundColor: 'rgba(239,68,68,0.6)',
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: 3,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` $${ctx.parsed.x.toLocaleString()}/ha`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 10 }, callback: v => '$' + v.toLocaleString() },
                    grid:  { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    grid:  { display: false },
                },
            },
        },
    });
}

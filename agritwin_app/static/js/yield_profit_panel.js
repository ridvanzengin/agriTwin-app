const YP_CROP_ORDER = ['Wheat', 'Barley', 'Sugar Beet', 'Sunflower', 'Maize', 'Chickpea', 'Lentil', 'Cotton'];

// Confidence levels reflect model uncertainty for each crop.
// High (±20%): stable rainfed cereals with good TÜİK data coverage.
// Medium (±40%): irrigated or processing-dependent crops with more variables.
// Low (±60%): Cotton has very limited Konya area and poor reference yield coverage.
const YP_CONFIDENCE = {
    'Wheat':      { level: 'High',   badge: 'badge-success', label: '±20%' },
    'Barley':     { level: 'High',   badge: 'badge-success', label: '±20%' },
    'Sugar Beet': { level: 'Medium', badge: 'badge-warning', label: '±40%' },
    'Sunflower':  { level: 'Medium', badge: 'badge-warning', label: '±40%' },
    'Maize':      { level: 'Medium', badge: 'badge-warning', label: '±40%' },
    'Chickpea':   { level: 'Medium', badge: 'badge-warning', label: '±40%' },
    'Lentil':     { level: 'Medium', badge: 'badge-warning', label: '±40%' },
    'Cotton':     { level: 'Low',    badge: 'badge-neutral', label: '±60%' },
};

// Crops with strong economics but real-world constraints beyond the model.
const YP_INFO_CROPS = new Set(['Sugar Beet', 'Chickpea', 'Sunflower', 'Maize']);
const YP_INFO_TEXT  = 'Economically attractive but constrained by irrigation, rotation, and processing capacity.';

let ypCurrentH3Id = null;
let ypCellData    = [];

const ypPanel    = document.getElementById('yp-panel');
const ypCloseBtn = document.getElementById('yp-panel-close');
const ypCellIdEl = document.getElementById('yp-cell-id');
const ypCropsEl  = document.getElementById('yp-crops-section');
const ypBreakEl  = document.getElementById('yp-breakdown-section');

// ── Panel close ───────────────────────────────────────────────────────────────
ypCloseBtn.addEventListener('click', () => ypPanel.classList.add('hidden'));

// ── Resize handle ─────────────────────────────────────────────────────────────
(function () {
    const handle      = document.getElementById('yp-resize-handle');
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
    ypCellIdEl.textContent = h3Id;
    ypPanel.classList.remove('hidden');

    const resp = await fetch(`/api/yield-profit/cells/${encodeURIComponent(h3Id)}`);
    if (!resp.ok) return;
    ypCellData = await resp.json();

    renderCropComparison();
    renderBreakdown();
};

// ── Crop Comparison ───────────────────────────────────────────────────────────
function renderCropComparison() {
    const dataMap = Object.fromEntries(ypCellData.map(r => [r.crop_name, r]));

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
      <span style="width:76px;flex-shrink:0;text-align:right;">Est. Yield</span>
      <span style="width:44px;flex-shrink:0;text-align:center;">Conf.</span>
      <span style="flex:1;text-align:right;">Proj. Profit</span>
      <span style="width:16px;flex-shrink:0;"></span>`;
    card.appendChild(hdr);

    for (const cropName of YP_CROP_ORDER) {
        const row  = dataMap[cropName];
        const prof = row?.net_profit ?? null;
        const yld  = row?.predicted_yield ?? null;
        const color      = profitColor(prof);
        const conf       = YP_CONFIDENCE[cropName] || { badge: 'badge-neutral', label: '±?' };
        const isSelected = cropName === (window.ypCurrentCrop || 'Wheat');
        const infoHtml   = YP_INFO_CROPS.has(cropName)
            ? `<span class="yp-info-icon" title="${YP_INFO_TEXT}">ⓘ</span>`
            : '<span style="width:16px;flex-shrink:0;"></span>';

        const rowEl = document.createElement('div');
        rowEl.className = 'suit-crop-row';
        rowEl.innerHTML = `
          <label class="suit-crop-label" style="align-items:center;">
            <input type="radio" name="ypCrop" value="${cropName}"${isSelected ? ' checked' : ''}
                   style="flex-shrink:0; width:13px; height:13px; accent-color:var(--nav-accent); cursor:pointer;">
            <span class="suit-crop-name" style="width:88px;">${cropName}</span>
            <span style="width:76px; flex-shrink:0; text-align:right; font-size:11px; color:var(--text-muted); font-family:monospace;">
              ${fmtYield(yld)}
            </span>
            <span class="badge ${conf.badge}" style="flex-shrink:0; font-size:10px; padding:0.15em 0.45em;">
              ${conf.label}
            </span>
            <span style="flex:1; text-align:right; font-size:12px; font-family:monospace; color:${color}; font-weight:600;">
              ${fmtProfit(prof)}
            </span>
            ${infoHtml}
          </label>`;

        rowEl.querySelector('input').addEventListener('change', () => {
            window.ypCurrentCrop = cropName;
            if (typeof window.ypRefetchCells === 'function') window.ypRefetchCells();
            renderBreakdown();
        });

        card.appendChild(rowEl);
    }

    ypCropsEl.appendChild(card);
}

// ── Cost Breakdown (inline, below crop list) ──────────────────────────────────
const COST_LABELS = {
    seed: 'Seed', fertilizer: 'Fertilizer', irrigation: 'Irrigation',
    labor: 'Labor', machinery: 'Machinery', pesticide: 'Pesticide',
};

function renderBreakdown() {
    const cropName = window.ypCurrentCrop || 'Wheat';
    const row = ypCellData.find(r => r.crop_name === cropName);

    ypBreakEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel-card';

    const title = document.createElement('p');
    title.className = 'panel-card-title';
    title.textContent = `${cropName} — Cost Breakdown`;
    card.appendChild(title);

    if (!row || row.gross_revenue === null || row.gross_revenue === undefined) {
        const msg = document.createElement('p');
        msg.style.cssText = 'font-size:12px; color:var(--text-muted); margin:8px 0;';
        msg.textContent = 'No price data available for this crop.';
        card.appendChild(msg);
        ypBreakEl.appendChild(card);
        return;
    }

    // Revenue / cost / profit summary line
    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex; justify-content:space-between; font-size:12px; margin-bottom:10px; gap:8px; flex-wrap:wrap;';
    summary.innerHTML = `
      <span style="color:var(--text-muted);">Gross Revenue&nbsp;<strong style="color:#22c55e;">$${Math.round(row.gross_revenue).toLocaleString()}/ha</strong></span>
      <span style="color:var(--text-muted);">Proj. Profit&nbsp;<strong style="color:${profitColor(row.net_profit)};">${fmtProfit(row.net_profit)}</strong></span>`;
    card.appendChild(summary);

    // Cost rows
    const breakdown = (row.cost_breakdown || []).filter(c => c.cost > 0);
    const table = document.createElement('div');
    table.style.cssText = 'border-top:1px solid var(--panel-border); padding-top:8px;';

    for (const item of breakdown) {
        const label = COST_LABELS[item.cost_type] || item.cost_type;
        const pct   = row.total_cost > 0 ? (item.cost / row.total_cost * 100).toFixed(0) : 0;
        const lineEl = document.createElement('div');
        lineEl.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:5px;';
        lineEl.innerHTML = `
          <span style="width:80px; font-size:12px; color:var(--text-secondary); flex-shrink:0;">${label}</span>
          <div style="flex:1; background:rgba(239,68,68,0.12); border-radius:3px; height:6px;">
            <div style="width:${pct}%; background:#ef4444; border-radius:3px; height:6px;"></div>
          </div>
          <span style="width:52px; text-align:right; font-size:11px; color:var(--text-muted); font-family:monospace; flex-shrink:0;">
            $${Math.round(item.cost).toLocaleString()}
          </span>`;
        table.appendChild(lineEl);
    }

    // Total cost footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:space-between; border-top:1px solid var(--panel-border); padding-top:6px; margin-top:4px; font-size:12px;';
    footer.innerHTML = `
      <span style="color:var(--text-secondary);">Total Cost</span>
      <span style="color:#ef4444; font-family:monospace;">$${Math.round(row.total_cost).toLocaleString()}/ha</span>`;
    table.appendChild(footer);

    card.appendChild(table);
    ypBreakEl.appendChild(card);
}

/* global SCENARIO_ID */

const CROP_ORDER = ['Wheat', 'Barley', 'Sugar Beet', 'Sunflower', 'Maize', 'Chickpea', 'Lentil', 'Cotton'];

const panel    = document.getElementById('scen-panel');
const closeBtn = document.getElementById('scen-panel-close');
const cellIdEl = document.getElementById('scen-cell-id');

function scoreColor(s) {
    if (s === null || s === undefined) return '#475569';
    if (s >= 0.7) return '#22c55e';
    if (s >= 0.4) return '#f59e0b';
    return '#ef4444';
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

// ── Public entry point (called by scenario_result_map.js) ─────────────────────
window.loadScenarioPanel = async function (h3Id) {
    cellIdEl.textContent = h3Id;
    panel.classList.remove('hidden');

    const section = document.getElementById('scen-crops-section');
    section.innerHTML = '<p style="color:#64748b;padding:1rem;font-size:0.8125rem">Loading…</p>';

    const resp = await fetch(`/api/scenarios/${SCENARIO_ID}/cells/${encodeURIComponent(h3Id)}`);
    if (!resp.ok) {
        section.innerHTML = '<p style="color:#ef4444;padding:1rem;font-size:0.8125rem">Failed to load cell data.</p>';
        return;
    }
    const data = await resp.json();
    const scoreMap = Object.fromEntries(data.map(r => [r.crop_name, r]));

    section.innerHTML = '';
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

    section.appendChild(card);

    // Radio → recolor map
    section.querySelectorAll('input[name="scenCrop"]').forEach(radio => {
        radio.addEventListener('change', () => {
            window.currentCrop = radio.value;
            if (typeof window.refetchScenarioCells === 'function') {
                window.refetchScenarioCells();
            }
        });
    });
};

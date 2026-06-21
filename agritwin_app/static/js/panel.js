/* global Chart */

let ndviChart = null;
let weatherChart = null;

const CATEGORY_LABELS = {
  weather: "Weather",
  vegetation: "Vegetation",
  soil: "Soil",
};

function fmt(value, unit) {
  if (value == null) return "—";
  const rounded = Number(value).toFixed(3).replace(/\.?0+$/, "");
  return unit ? `${rounded} ${unit}` : rounded;
}

function buildFeatureGroups(features) {
  const groups = {};
  for (const f of features) {
    const cat = f.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  }

  const container = document.getElementById("feature-groups");
  container.innerHTML = "";

  for (const [cat, items] of Object.entries(groups)) {
    const heading = document.createElement("h4");
    heading.className = "feature-group-heading";
    heading.textContent = CATEGORY_LABELS[cat] ?? cat;
    container.appendChild(heading);

    const dl = document.createElement("dl");
    dl.className = "attr-grid";
    for (const item of items) {
      const dt = document.createElement("dt");
      dt.textContent = item.name.replace(/_/g, " ");
      const dd = document.createElement("dd");
      dd.textContent = fmt(item.latest_value, item.unit);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    container.appendChild(dl);
  }
}

async function fetchTimeseries(h3Id, featureName) {
  const resp = await fetch(
    `/api/cells/${encodeURIComponent(h3Id)}/timeseries?feature=${encodeURIComponent(featureName)}&start=2020-01-01`
  );
  if (!resp.ok) return null;
  return resp.json();
}

function destroyChart(chartRef) {
  if (chartRef) {
    chartRef.destroy();
    return null;
  }
  return null;
}

function renderNdviChart(data) {
  ndviChart = destroyChart(ndviChart);
  const canvas = document.getElementById("chart-ndvi");
  if (!data || !data.data.length) {
    canvas.closest(".panel-card").hidden = true;
    return;
  }
  canvas.closest(".panel-card").hidden = false;

  const labels = data.data.map((d) => d.timestamp.slice(0, 10));
  const values = data.data.map((d) => d.value);

  ndviChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "NDVI",
        data: values,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,0.12)",
        borderWidth: 1.5,
        pointRadius: 2,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 6, maxRotation: 0 },
          grid: { color: "#1e293b" },
        },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "#1e293b" },
        },
      },
    },
  });
}

function renderWeatherChart(tempData, precipData) {
  weatherChart = destroyChart(weatherChart);
  const canvas = document.getElementById("chart-weather");

  const hasTemp = tempData?.data?.length > 0;
  const hasPrec = precipData?.data?.length > 0;

  if (!hasTemp && !hasPrec) {
    canvas.closest(".panel-card").hidden = true;
    return;
  }
  canvas.closest(".panel-card").hidden = false;

  // Use temperature labels as x-axis (they're monthly)
  const source = hasTemp ? tempData : precipData;
  const labels = source.data.map((d) => d.timestamp.slice(0, 7));

  const datasets = [];
  if (hasTemp) {
    datasets.push({
      label: "Temp (°C)",
      data: tempData.data.map((d) => d.value),
      borderColor: "#f97316",
      backgroundColor: "rgba(249,115,22,0.1)",
      borderWidth: 1.5,
      pointRadius: 1.5,
      fill: false,
      tension: 0.3,
      yAxisID: "y",
    });
  }
  if (hasPrec) {
    datasets.push({
      label: "Precip (mm)",
      data: precipData.data.map((d) => d.value),
      borderColor: "#38bdf8",
      backgroundColor: "rgba(56,189,248,0.2)",
      borderWidth: 1.5,
      pointRadius: 1.5,
      fill: true,
      tension: 0.3,
      type: "bar",
      yAxisID: "y1",
    });
  }

  weatherChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: "#1e293b" },
        },
        y: {
          position: "left",
          ticks: { color: "#f97316" },
          grid: { color: "#1e293b" },
        },
        y1: {
          position: "right",
          ticks: { color: "#38bdf8" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

async function openCellPanel(h3Id) {
  const panel = document.getElementById("cell-panel");
  document.getElementById("panel-h3id").textContent = h3Id;
  panel.hidden = false;

  // Reset content while loading
  document.getElementById("attr-elevation").textContent = "…";
  document.getElementById("attr-slope").textContent = "…";
  document.getElementById("attr-aspect").textContent = "…";
  document.getElementById("feature-groups").innerHTML = "";

  const [cellResp, ndviTs, tempTs, precipTs] = await Promise.all([
    fetch(`/api/cells/${encodeURIComponent(h3Id)}`).then((r) => r.json()),
    fetchTimeseries(h3Id, "ndvi"),
    fetchTimeseries(h3Id, "temperature_2m"),
    fetchTimeseries(h3Id, "precipitation"),
  ]);

  document.getElementById("attr-elevation").textContent =
    cellResp.elevation != null ? `${Number(cellResp.elevation).toFixed(1)} m` : "—";
  document.getElementById("attr-slope").textContent =
    cellResp.slope != null ? `${Number(cellResp.slope).toFixed(2)}°` : "—";
  document.getElementById("attr-aspect").textContent =
    cellResp.aspect != null ? `${Number(cellResp.aspect).toFixed(1)}°` : "—";

  buildFeatureGroups(cellResp.features ?? []);
  renderNdviChart(ndviTs);
  renderWeatherChart(tempTs, precipTs);
}

// Close button
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("panel-close").addEventListener("click", () => {
    document.getElementById("cell-panel").hidden = true;
    ndviChart = destroyChart(ndviChart);
    weatherChart = destroyChart(weatherChart);
  });
});

// Expose so map.js can call it
window.openCellPanel = openCellPanel;

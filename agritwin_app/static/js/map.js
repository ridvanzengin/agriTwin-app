/* global maplibregl */

const KONYA_CENTER = [32.5, 38.0];
const INITIAL_ZOOM = 9;
const CELL_SOURCE = "cells";
const FILL_LAYER = "cells-fill";
const HOVER_LAYER = "cells-hover";
const OUTLINE_LAYER = "cells-outline";

let map;
let currentFeature = "elevation";
let hoveredH3Id = null;
let fetchController = null;

// Colour ramps keyed by feature name (min → max in domain)
const COLOR_RAMPS = {
  elevation: {
    property: "elevation",
    stops: [
      [700, "#1a9641"],
      [1000, "#a6d96a"],
      [1300, "#ffffbf"],
      [1700, "#fdae61"],
      [2200, "#d7191c"],
    ],
  },
  ndvi: {
    property: "value",
    stops: [
      [0.0, "#d73027"],
      [0.2, "#fc8d59"],
      [0.4, "#fee08b"],
      [0.6, "#d9ef8b"],
      [0.8, "#1a9850"],
    ],
  },
  "temperature_2m": {
    property: "value",
    stops: [
      [-5, "#2166ac"],
      [5, "#74add1"],
      [15, "#fee090"],
      [25, "#f46d43"],
      [35, "#a50026"],
    ],
  },
  "soil_ph_0-5cm": {
    property: "value",
    stops: [
      [5.0, "#d73027"],
      [6.0, "#fc8d59"],
      [6.5, "#fee090"],
      [7.5, "#91bfdb"],
      [9.0, "#4575b4"],
    ],
  },
};

function buildColorExpression(featureName) {
  const ramp = COLOR_RAMPS[featureName] ?? COLOR_RAMPS.elevation;
  const prop = ramp.property;
  const stops = ramp.stops;
  return [
    "interpolate", ["linear"],
    ["coalesce", ["get", prop], stops[0][0]],
    ...stops.flatMap(([val, color]) => [val, color]),
  ];
}

function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        "carto-dark": {
          type: "raster",
          tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        },
      },
      layers: [{ id: "background", type: "raster", source: "carto-dark" }],
    },
    center: KONYA_CENTER,
    zoom: INITIAL_ZOOM,
  });

  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

  map.on("load", () => {
    // Empty GeoJSON source — filled by fetchCells()
    map.addSource(CELL_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: FILL_LAYER,
      type: "fill",
      source: CELL_SOURCE,
      paint: {
        "fill-color": buildColorExpression(currentFeature),
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hovered"], false],
          0.85,
          0.55,
        ],
      },
    });

    map.addLayer({
      id: OUTLINE_LAYER,
      type: "line",
      source: CELL_SOURCE,
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hovered"], false],
          1.8,
          0.3,
        ],
        "line-opacity": 0.5,
      },
    });

    // Invisible hover hit layer (wider stroke for easier picking)
    map.addLayer({
      id: HOVER_LAYER,
      type: "fill",
      source: CELL_SOURCE,
      paint: { "fill-color": "transparent", "fill-opacity": 0 },
    });

    fetchCells();
  });

  map.on("moveend", fetchCells);

  // Hover behaviour
  const tooltip = document.getElementById("map-tooltip");

  map.on("mousemove", HOVER_LAYER, (e) => {
    map.getCanvas().style.cursor = "pointer";
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

    const elev = feat.properties.elevation != null
      ? `${Number(feat.properties.elevation).toFixed(0)} m`
      : "—";
    const val = feat.properties.value != null
      ? `${Number(feat.properties.value).toFixed(3)} ${feat.properties.value_unit ?? ""}`
      : "";

    tooltip.hidden = false;
    tooltip.style.left = `${e.point.x + 14}px`;
    tooltip.style.top = `${e.point.y - 10}px`;
    tooltip.innerHTML = `
      <div class="tooltip-id">${h3id}</div>
      <div class="tooltip-row"><span>Elevation</span><span>${elev}</span></div>
      ${val ? `<div class="tooltip-row"><span>${currentFeature.replace(/_/g, " ")}</span><span>${val}</span></div>` : ""}
    `;
  });

  map.on("mouseleave", HOVER_LAYER, () => {
    map.getCanvas().style.cursor = "";
    if (hoveredH3Id !== null) {
      map.setFeatureState({ source: CELL_SOURCE, id: hoveredH3Id }, { hovered: false });
      hoveredH3Id = null;
    }
    tooltip.hidden = true;
  });

  // Click → open panel
  map.on("click", HOVER_LAYER, (e) => {
    const feat = e.features?.[0];
    if (!feat) return;
    window.openCellPanel(feat.properties.h3_id);
  });

  // Feature selector
  document.getElementById("feature-select").addEventListener("change", (e) => {
    currentFeature = e.target.value;
    map.setPaintProperty(FILL_LAYER, "fill-color", buildColorExpression(currentFeature));
    fetchCells();
  });
}

function getBbox() {
  const b = map.getBounds();
  return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
}

async function fetchCells() {
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  const bbox = getBbox();
  const url = `/api/cells?bbox=${bbox}&feature=${encodeURIComponent(currentFeature)}`;

  try {
    const resp = await fetch(url, { signal: fetchController.signal });
    if (!resp.ok) return;
    const geojson = await resp.json();

    // MapLibre needs a stable numeric `id` for feature state
    geojson.features.forEach((f, i) => { f.id = i; });

    // Build a lookup so hover can find the id by h3_id
    window._h3ToId = {};
    geojson.features.forEach((f) => {
      window._h3ToId[f.properties.h3_id] = f.id;
    });

    map.getSource(CELL_SOURCE)?.setData(geojson);
  } catch (err) {
    if (err.name !== "AbortError") console.error("fetchCells error:", err);
  }
}

document.addEventListener("DOMContentLoaded", initMap);

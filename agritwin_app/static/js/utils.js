// Shared utilities — loaded before map.js and panel.js (plain script, no modules)

const FEATURE_NAMES = {
  elevation:                    'Elevation',
  slope:                        'Slope',
  aspect:                       'Aspect',
  temperature_2m:               'Temperature (2m)',
  precipitation:                'Precipitation',
  dewpoint_2m:                  'Dewpoint (2m)',
  wind_u_10m:                   'Wind U (10m)',
  wind_v_10m:                   'Wind V (10m)',
  solar_radiation:              'Solar Radiation',
  ndvi:                         'NDVI',
  'soil_ph_0-5cm':              'Soil pH (0–5cm)',
  'soil_ph_5-15cm':             'Soil pH (5–15cm)',
  'soil_organic_carbon_0-5cm':  'Organic Carbon (0–5cm)',
  'soil_organic_carbon_5-15cm': 'Organic Carbon (5–15cm)',
  'soil_clay_0-5cm':            'Clay Content (0–5cm)',
  'soil_clay_5-15cm':           'Clay Content (5–15cm)',
  'soil_sand_0-5cm':            'Sand Content (0–5cm)',
  'soil_sand_5-15cm':           'Sand Content (5–15cm)',
  'soil_silt_0-5cm':            'Silt Content (0–5cm)',
  'soil_silt_5-15cm':           'Silt Content (5–15cm)',
  'soil_bulk_density_0-5cm':    'Bulk Density (0–5cm)',
  'soil_bulk_density_5-15cm':   'Bulk Density (5–15cm)',
  'soil_cec_0-5cm':             'CEC (0–5cm)',
  'soil_cec_5-15cm':            'CEC (5–15cm)',
  'soil_nitrogen_0-5cm':        'Nitrogen (0–5cm)',
  'soil_nitrogen_5-15cm':       'Nitrogen (5–15cm)',
};

// Feature categories for radio button availability logic
const WEATHER_FEATURE_NAMES = new Set([
  'temperature_2m', 'precipitation', 'dewpoint_2m',
  'wind_u_10m', 'wind_v_10m', 'solar_radiation',
]);

const TERRAIN_FEATURE_NAMES_SET = new Set(['elevation', 'slope', 'aspect']);

function formatFeatureName(name) {
  return FEATURE_NAMES[name]
    ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

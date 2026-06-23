"""Pure unit tests for the scoring engine — no database, no fixtures."""
import pytest
from agritwin_app.scoring.engine import land_cover_gate, triangle_score, score_cell


# ── land_cover_gate ────────────────────────────────────────────────────────

def test_gate_cropland_passes():
    assert land_cover_gate(12) is True   # IGBP 12 = cropland (arable)

def test_gate_urban_blocks():
    assert land_cover_gate(13) is False  # IGBP 13 = urban

def test_gate_water_blocks():
    assert land_cover_gate(0) is False   # IGBP 0 = water

def test_gate_snow_blocks():
    assert land_cover_gate(15) is False  # IGBP 15 = snow/ice

def test_gate_barren_blocks():
    assert land_cover_gate(16) is False  # IGBP 16 = barren

def test_gate_none_passes():
    assert land_cover_gate(None) is True  # missing data → don't penalise


# ── triangle_score ──────────────────────────────────────────────────────────

def test_triangle_at_optimal():
    assert triangle_score(20.0, 10.0, 20.0, 30.0) == pytest.approx(1.0)

def test_triangle_below_min():
    assert triangle_score(5.0, 10.0, 20.0, 30.0) == pytest.approx(0.0)

def test_triangle_above_max():
    assert triangle_score(35.0, 10.0, 20.0, 30.0) == pytest.approx(0.0)

def test_triangle_midpoint_rising():
    # value=15 is halfway between min=10 and optimal=20 → score=0.5
    assert triangle_score(15.0, 10.0, 20.0, 30.0) == pytest.approx(0.5)

def test_triangle_midpoint_falling():
    # value=25 is halfway between optimal=20 and max=30 → score=0.5
    assert triangle_score(25.0, 10.0, 20.0, 30.0) == pytest.approx(0.5)

def test_triangle_null_value_returns_none():
    assert triangle_score(None, 10.0, 20.0, 30.0) is None

def test_triangle_null_max_no_upper_penalty():
    # With max_v=None, any value ≥ optimal scores 1.0
    assert triangle_score(999.0, 0.0, 5.0, None) == pytest.approx(1.0)

def test_triangle_at_min_boundary():
    assert triangle_score(10.0, 10.0, 20.0, 30.0) == pytest.approx(0.0)

def test_triangle_at_max_boundary():
    assert triangle_score(30.0, 10.0, 20.0, 30.0) == pytest.approx(0.0)


# ── score_cell ───────────────────────────────────────────────────────────────

_WHEAT_REQS = [
    {"parameter": "temperature_2m",     "min_value": 3.0,  "optimal_value": 15.0, "max_value": 28.0, "weight": 1.0},
    {"parameter": "precipitation",      "min_value": 250.0,"optimal_value": 500.0,"max_value": 800.0,"weight": 1.0},
]

def test_score_cell_non_arable_returns_zero():
    fv = {"land_cover_type": 13.0, "temperature_2m": 15.0, "precipitation": 500.0}
    assert score_cell(fv, _WHEAT_REQS) == pytest.approx(0.0)

def test_score_cell_optimal_values():
    fv = {"temperature_2m": 15.0, "precipitation": 500.0}
    assert score_cell(fv, _WHEAT_REQS) == pytest.approx(1.0)

def test_score_cell_weighted_average():
    # temp scores 1.0, precip scores 0.0 → mean = 0.5
    fv = {"temperature_2m": 15.0, "precipitation": 100.0}
    result = score_cell(fv, _WHEAT_REQS)
    assert result == pytest.approx(0.5)

def test_score_cell_missing_parameter_skipped():
    # Only temperature present → result is temperature score
    fv = {"temperature_2m": 15.0}
    result = score_cell(fv, _WHEAT_REQS)
    assert result == pytest.approx(1.0)

def test_score_cell_no_evaluable_params_returns_none():
    result = score_cell({}, _WHEAT_REQS)
    assert result is None

def test_score_cell_arable_land_cover_not_penalised():
    fv = {"land_cover_type": 12.0, "temperature_2m": 15.0, "precipitation": 500.0}
    assert score_cell(fv, _WHEAT_REQS) == pytest.approx(1.0)

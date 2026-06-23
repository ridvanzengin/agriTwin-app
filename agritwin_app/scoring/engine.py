"""Pure suitability scoring logic — no DB access, no Flask imports."""

# IGBP land cover classes that are non-arable (hard gate: score = 0).
# 0=Water, 13=Urban, 15=Permanent Snow/Ice, 16=Barren.
NON_ARABLE_IGBP = {0, 13, 15, 16}


def land_cover_gate(igbp_value: float | None) -> bool:
    """Return False if the cell is non-arable (should score 0 regardless of other features)."""
    if igbp_value is None:
        return True  # missing data: don't penalise
    return int(igbp_value) not in NON_ARABLE_IGBP


def triangle_score(
    value: float | None,
    min_v: float | None,
    optimal_v: float | None,
    max_v: float | None,
) -> float | None:
    """
    Triangle (fuzzy) membership function.

    Shape:
      min_v ──── optimal_v ──── max_v
        0           1              0

    - Returns None when value is None (missing data — caller decides how to handle).
    - NULL max_v means no upper bound: score stays at 1.0 once optimal is reached.
    - NULL min_v means no lower bound: score stays at 1.0 down to optimal.
    """
    if value is None:
        return None

    if min_v is not None and value < min_v:
        return 0.0
    if max_v is not None and value > max_v:
        return 0.0

    if optimal_v is None:
        return 1.0

    if value <= optimal_v:
        if min_v is None:
            return 1.0
        span = optimal_v - min_v
        return 1.0 if span == 0 else (value - min_v) / span
    else:
        if max_v is None:
            return 1.0  # no upper bound (e.g., soil organic carbon)
        span = max_v - optimal_v
        return 1.0 if span == 0 else (max_v - value) / span


def score_cell(
    feature_values: dict[str, float | None],
    requirements: list[dict],
) -> float | None:
    """
    Compute weighted suitability score (0–1) for one cell against one crop's requirements.

    Args:
        feature_values: {parameter_name: aggregated_value} for the cell.
        requirements: list of dicts with keys parameter, min_value, optimal_value,
                      max_value, weight.

    Returns:
        float 0–1, or None if no requirements could be evaluated (all values missing).

    land_cover_type is treated as a hard gate: if the cell is non-arable, returns 0.0
    immediately without evaluating other parameters.
    """
    if not land_cover_gate(feature_values.get("land_cover_type")):
        return 0.0

    total_weight = 0.0
    weighted_sum = 0.0

    for req in requirements:
        param = req["parameter"]
        if param == "land_cover_type":
            continue  # handled as gate above

        value = feature_values.get(param)
        s = triangle_score(value, req["min_value"], req["optimal_value"], req["max_value"])
        if s is None:
            continue  # skip missing-data parameters rather than penalise

        w = req["weight"] if req["weight"] is not None else 1.0
        weighted_sum += s * w
        total_weight += w

    if total_weight == 0:
        return None

    return round(weighted_sum / total_weight, 4)

KONYA_BBOX = "31.8,37.2,34.2,39.4"
SMALL_BBOX = "32.4,37.8,32.5,37.9"


def _get_res9_h3_id(client):
    """Fetch a real res-9 h3_id from the bbox endpoint."""
    resp = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}")
    features = resp.get_json().get("features", [])
    if not features:
        return None
    return features[0]["properties"]["h3_id"]


# ── GET /api/suitability/cells ───────────────────────────────────────────────

def test_suitability_cells_missing_bbox(client):
    resp = client.get("/api/suitability/cells")
    assert resp.status_code == 400


def test_suitability_cells_malformed_bbox(client):
    resp = client.get("/api/suitability/cells?bbox=bad")
    assert resp.status_code == 400


def test_suitability_cells_out_of_range_bbox(client):
    resp = client.get("/api/suitability/cells?bbox=-10,-10,10,10")
    assert resp.status_code == 400


def test_suitability_cells_returns_geojson(client):
    resp = client.get(f"/api/suitability/cells?bbox={KONYA_BBOX}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["type"] == "FeatureCollection"
    assert isinstance(data["features"], list)


def test_suitability_cells_properties(client):
    resp = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}")
    assert resp.status_code == 200
    data = resp.get_json()
    for feat in data["features"]:
        props = feat["properties"]
        assert "h3_id" in props
        assert "score" in props


def test_suitability_cells_crop_param(client):
    resp = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}&crop=Barley")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["type"] == "FeatureCollection"


def test_suitability_cells_default_crop(client):
    resp_wheat   = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}&crop=Wheat")
    resp_default = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}")
    assert resp_wheat.status_code == 200
    assert resp_default.status_code == 200
    wheat_scores   = {f["properties"]["h3_id"]: f["properties"]["score"]
                      for f in resp_wheat.get_json()["features"]}
    default_scores = {f["properties"]["h3_id"]: f["properties"]["score"]
                      for f in resp_default.get_json()["features"]}
    assert wheat_scores == default_scores


# ── GET /api/suitability/cells/<h3_id> ──────────────────────────────────────

def test_suitability_cell_not_found(client):
    resp = client.get("/api/suitability/cells/not-a-real-h3-id")
    assert resp.status_code == 404


def test_suitability_cell_returns_all_crops(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return  # No data in test DB — skip
    resp = client.get(f"/api/suitability/cells/{h3_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    assert len(data) == 8
    for row in data:
        assert "crop_name" in row
        assert "score" in row
        assert "scored_at" in row


def test_suitability_cell_sorted_desc(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/suitability/cells/{h3_id}")
    data = resp.get_json()
    scores = [r["score"] for r in data if r["score"] is not None]
    assert scores == sorted(scores, reverse=True)


def test_suitability_cell_score_range(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/suitability/cells/{h3_id}")
    for row in resp.get_json():
        if row["score"] is not None:
            assert 0.0 <= row["score"] <= 1.0


# ── GET /api/suitability/cells/<h3_id>/monthly ──────────────────────────────

def test_suitability_monthly_cell_not_found(client):
    resp = client.get("/api/suitability/cells/not-a-real-id/monthly")
    assert resp.status_code == 404


def test_suitability_monthly_unknown_crop(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/suitability/cells/{h3_id}/monthly?crop=NotACrop")
    assert resp.status_code == 404


def test_suitability_monthly_returns_list(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/suitability/cells/{h3_id}/monthly?crop=Wheat")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)


def test_suitability_monthly_schema(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/suitability/cells/{h3_id}/monthly?crop=Wheat")
    data = resp.get_json()
    for item in data:
        assert "feature" in item
        assert "label" in item
        assert "unit" in item
        assert "is_static" in item
        if item["is_static"]:
            # Static features carry a single actual + requirement triple
            assert "actual" in item
            assert "req_min" in item
            assert "req_optimal" in item
            assert "req_max" in item
        else:
            # Weather features carry a list of monthly observations
            assert isinstance(item["months"], list)
            for m in item["months"]:
                assert "month" in m
                assert 1 <= m["month"] <= 12
                assert "actual" in m
                assert "req_min" in m
                assert "req_optimal" in m
                assert "req_max" in m


def test_suitability_monthly_default_crop(client):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return
    resp_wheat   = client.get(f"/api/suitability/cells/{h3_id}/monthly?crop=Wheat")
    resp_default = client.get(f"/api/suitability/cells/{h3_id}/monthly")
    assert resp_wheat.status_code == 200
    assert resp_default.status_code == 200
    assert resp_wheat.get_json() == resp_default.get_json()

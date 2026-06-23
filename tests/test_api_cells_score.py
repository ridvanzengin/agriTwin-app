"""Integration tests for score mode in /api/cells and /api/cells/<h3_id>/scores."""

KONYA_BBOX = "31.8,37.2,34.2,39.4"
SMALL_BBOX = "32.4,37.8,32.5,37.9"


# ── /api/cells?mode=score ────────────────────────────────────────────────────

def test_cells_score_mode_missing_crop(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&mode=score")
    assert resp.status_code == 400
    assert "crop" in resp.get_json()["error"]


def test_cells_score_mode_unknown_crop(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&mode=score&crop=FakeCrop99")
    assert resp.status_code == 400


def test_cells_score_mode_returns_geojson(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&mode=score&crop=Wheat")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data


def test_cells_score_mode_properties(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&mode=score&crop=Wheat")
    data = resp.get_json()
    for feat in data["features"]:
        props = feat["properties"]
        assert "h3_id" in props
        assert "score" in props      # score may be null if not yet scored
        assert "crop" in props
        assert props["crop"] == "Wheat"


def test_cells_score_mode_only_res9(client):
    # resolution=6 should still work — cells.py forces res=9 in score mode
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&mode=score&crop=Wheat&resolution=6")
    assert resp.status_code == 200


# ── /api/cells/<h3_id>/scores ────────────────────────────────────────────────

def _get_a_cell_id(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    feats = resp.get_json()["features"]
    if feats:
        return feats[0]["properties"]["h3_id"]
    return None


def test_cell_scores_endpoint_returns_json(client):
    h3_id = _get_a_cell_id(client)
    if h3_id is None:
        return  # no cells in bbox — skip
    resp = client.get(f"/api/cells/{h3_id}/scores")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["h3_id"] == h3_id
    assert isinstance(data["scores"], list)


def test_cell_scores_unknown_id_returns_404(client):
    resp = client.get("/api/cells/000000000000000f/scores")
    assert resp.status_code == 404


def test_cell_scores_structure(client):
    h3_id = _get_a_cell_id(client)
    if h3_id is None:
        return
    resp = client.get(f"/api/cells/{h3_id}/scores")
    data = resp.get_json()
    for s in data["scores"]:
        assert "crop_id" in s
        assert "crop_name" in s
        assert "score" in s

KONYA_BBOX = "31.8,37.2,34.2,39.4"
SMALL_BBOX = "32.4,37.8,32.5,37.9"


# ── /api/cells ──────────────────────────────────────────────────────────────

def test_cells_missing_bbox(client):
    resp = client.get("/api/cells")
    assert resp.status_code == 400


def test_cells_malformed_bbox(client):
    resp = client.get("/api/cells?bbox=bad")
    assert resp.status_code == 400


def test_cells_out_of_range_bbox(client):
    resp = client.get("/api/cells?bbox=-10,-10,10,10")
    assert resp.status_code == 400


def test_cells_returns_geojson(client):
    resp = client.get(f"/api/cells?bbox={KONYA_BBOX}")
    assert resp.status_code == 200
    assert "geo+json" in resp.content_type or "json" in resp.content_type
    data = resp.get_json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data


def test_cells_feature_properties_present(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    data = resp.get_json()
    for feat in data["features"]:
        props = feat["properties"]
        assert "h3_id" in props
        assert "elevation" in props
        assert "slope" in props
        assert "aspect" in props
        assert "value" not in props  # no feature param supplied


def test_cells_with_feature_param(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&feature=elevation")
    assert resp.status_code == 200
    data = resp.get_json()
    for feat in data["features"]:
        assert "value" in feat["properties"]
        assert "value_unit" in feat["properties"]


def test_cells_unknown_feature_param(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}&feature=does_not_exist")
    assert resp.status_code == 400


# ── /api/cells/<h3_id> ──────────────────────────────────────────────────────

def test_cell_not_found(client):
    resp = client.get("/api/cells/not-a-real-h3-id")
    assert resp.status_code == 404


def test_cell_profile_schema(client):
    # First fetch a real h3_id from the bbox endpoint
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    features = resp.get_json()["features"]
    if not features:
        return  # No data in test DB — skip
    h3_id = features[0]["properties"]["h3_id"]

    resp2 = client.get(f"/api/cells/{h3_id}")
    assert resp2.status_code == 200
    data = resp2.get_json()
    assert data["h3_id"] == h3_id
    assert "elevation" in data
    assert "slope" in data
    assert "aspect" in data
    assert isinstance(data["features"], list)
    for f in data["features"]:
        assert "name" in f
        assert "category" in f
        assert "unit" in f
        assert "latest_value" in f
        assert "latest_timestamp" in f


# ── /api/cells/<h3_id>/timeseries ───────────────────────────────────────────

def test_timeseries_missing_feature(client):
    resp = client.get("/api/cells/someid/timeseries")
    assert resp.status_code == 400


def test_timeseries_bad_date(client):
    resp = client.get("/api/cells/someid/timeseries?feature=ndvi&start=not-a-date")
    assert resp.status_code == 400


def test_timeseries_cell_not_found(client):
    resp = client.get("/api/cells/not-a-real-id/timeseries?feature=ndvi")
    assert resp.status_code == 404


def test_timeseries_feature_not_found(client):
    # Need a real h3_id first
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    features = resp.get_json()["features"]
    if not features:
        return
    h3_id = features[0]["properties"]["h3_id"]

    resp2 = client.get(f"/api/cells/{h3_id}/timeseries?feature=no_such_feature")
    assert resp2.status_code == 404


def test_timeseries_schema(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    features = resp.get_json()["features"]
    if not features:
        return
    h3_id = features[0]["properties"]["h3_id"]

    resp2 = client.get(f"/api/cells/{h3_id}/timeseries?feature=ndvi")
    assert resp2.status_code == 200
    data = resp2.get_json()
    assert data["h3_id"] == h3_id
    assert data["feature"] == "ndvi"
    assert "unit" in data
    assert isinstance(data["data"], list)
    for point in data["data"]:
        assert "timestamp" in point
        assert "value" in point


def test_timeseries_date_filter(client):
    resp = client.get(f"/api/cells?bbox={SMALL_BBOX}")
    features = resp.get_json()["features"]
    if not features:
        return
    h3_id = features[0]["properties"]["h3_id"]

    resp2 = client.get(
        f"/api/cells/{h3_id}/timeseries?feature=ndvi&start=2023-01-01&end=2023-12-31"
    )
    assert resp2.status_code == 200
    data = resp2.get_json()
    for point in data["data"]:
        ts = point["timestamp"][:10]
        assert "2023-01-01" <= ts <= "2023-12-31"

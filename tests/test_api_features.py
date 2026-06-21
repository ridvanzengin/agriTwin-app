def test_features_returns_list(client):
    resp = client.get("/api/features")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)


def test_features_schema(client):
    resp = client.get("/api/features")
    data = resp.get_json()
    if not data:
        return  # Empty DB is acceptable for schema test
    for item in data:
        assert "name" in item
        assert "category" in item
        assert "unit" in item
        assert "description" in item


def test_features_sorted_by_category_then_name(client):
    resp = client.get("/api/features")
    data = resp.get_json()
    if len(data) < 2:
        return
    keys = [(f["category"], f["name"]) for f in data]
    assert keys == sorted(keys)

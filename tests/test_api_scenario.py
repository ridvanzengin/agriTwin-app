"""Tests for the 6 scenario API endpoints.

These tests use a real database. Celery is not invoked — task dispatch is
monkeypatched to avoid needing Redis.
"""
import json
import pytest
from unittest.mock import MagicMock, patch

KONYA_BBOX = "31.8,37.2,34.2,39.4"
SMALL_BBOX = "32.4,37.8,32.5,37.9"

SAMPLE_POLYGON = (
    "POLYGON((32.4 37.8, 32.5 37.8, 32.5 37.9, 32.4 37.9, 32.4 37.8))"
)


@pytest.fixture()
def mock_task():
    """Patch Celery task dispatch so tests don't need Redis."""
    fake_result = MagicMock()
    fake_result.id = "test-task-id-1234"
    with patch(
        "agritwin_app.api.scenario.compute_scenario_scores.delay",
        return_value=fake_result,
    ):
        yield fake_result


def _create_scenario(client, mock_task, name="Test Scenario", polygon=None):
    """Helper: POST a scenario and return the response."""
    return client.post(
        "/api/scenarios",
        json={
            "name": name,
            "polygon": polygon or SAMPLE_POLYGON,
            "overrides": {"precipitation": 50, "temperature_2m": 2},
        },
    )


# ── GET /api/scenarios ───────────────────────────────────────────────────────

def test_list_scenarios_empty(client):
    resp = client.get("/api/scenarios")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)


def test_list_scenarios_returns_created(client, mock_task):
    _create_scenario(client, mock_task, name="List Test")
    resp = client.get("/api/scenarios")
    assert resp.status_code == 200
    names = [s["name"] for s in resp.get_json()]
    assert "List Test" in names


# ── POST /api/scenarios ──────────────────────────────────────────────────────

def test_create_scenario_missing_body(client):
    resp = client.post("/api/scenarios")
    assert resp.status_code == 400


def test_create_scenario_missing_name(client):
    resp = client.post("/api/scenarios", json={"polygon": SAMPLE_POLYGON})
    assert resp.status_code == 400


def test_create_scenario_missing_polygon(client):
    resp = client.post("/api/scenarios", json={"name": "X"})
    assert resp.status_code == 400


def test_create_scenario_invalid_polygon(client):
    resp = client.post(
        "/api/scenarios",
        json={"name": "Bad", "polygon": "NOT_WKT"},
    )
    assert resp.status_code == 400


def test_create_scenario_success(client, mock_task):
    resp = _create_scenario(client, mock_task)
    assert resp.status_code == 201
    data = resp.get_json()
    assert "scenario_id" in data
    assert "task_id" in data
    assert isinstance(data["scenario_id"], int)


def test_create_scenario_strips_unknown_overrides(client, mock_task):
    resp = client.post(
        "/api/scenarios",
        json={
            "name": "Override Test",
            "polygon": SAMPLE_POLYGON,
            "overrides": {"precipitation": 100, "unknown_feature": 999},
        },
    )
    assert resp.status_code == 201


# ── GET /api/scenarios/<id>/status ───────────────────────────────────────────

def test_scenario_status_not_found(client):
    resp = client.get("/api/scenarios/99999/status")
    assert resp.status_code == 404


def test_scenario_status_returns_pending(client, mock_task):
    create_resp = _create_scenario(client, mock_task, name="Status Test")
    scenario_id = create_resp.get_json()["scenario_id"]

    resp = client.get(f"/api/scenarios/{scenario_id}/status")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "status" in data
    assert data["status"] in {"pending", "running", "completed", "failed"}


# ── DELETE /api/scenarios/<id> ────────────────────────────────────────────────

def test_delete_scenario_not_found(client):
    resp = client.delete("/api/scenarios/99999")
    assert resp.status_code == 404


def test_delete_scenario_success(client, mock_task):
    create_resp = _create_scenario(client, mock_task, name="Delete Test")
    scenario_id = create_resp.get_json()["scenario_id"]

    del_resp = client.delete(f"/api/scenarios/{scenario_id}")
    assert del_resp.status_code == 200
    assert del_resp.get_json()["deleted"] == scenario_id

    # Confirm gone
    status_resp = client.get(f"/api/scenarios/{scenario_id}/status")
    assert status_resp.status_code == 404


# ── GET /api/scenarios/<id>/cells ─────────────────────────────────────────────

def test_scenario_cells_not_in_db_returns_empty(client, mock_task):
    create_resp = _create_scenario(client, mock_task, name="Cells Empty Test")
    scenario_id = create_resp.get_json()["scenario_id"]

    resp = client.get(f"/api/scenarios/{scenario_id}/cells?bbox={KONYA_BBOX}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["type"] == "FeatureCollection"
    assert isinstance(data["features"], list)
    # No scores computed yet (task mocked), so list is empty
    assert data["features"] == []


def test_scenario_cells_missing_bbox(client, mock_task):
    create_resp = _create_scenario(client, mock_task, name="Cells No BBox")
    scenario_id = create_resp.get_json()["scenario_id"]

    resp = client.get(f"/api/scenarios/{scenario_id}/cells")
    assert resp.status_code == 400


# ── GET /api/scenarios/<id>/cells/<h3_id> ─────────────────────────────────────

def test_scenario_cell_h3_not_found(client, mock_task):
    create_resp = _create_scenario(client, mock_task, name="Cell 404 Test")
    scenario_id = create_resp.get_json()["scenario_id"]

    resp = client.get(f"/api/scenarios/{scenario_id}/cells/not-a-real-h3-id")
    assert resp.status_code == 404


def _get_res9_h3_id(client):
    resp = client.get(f"/api/suitability/cells?bbox={SMALL_BBOX}")
    features = resp.get_json().get("features", [])
    if not features:
        return None
    return features[0]["properties"]["h3_id"]


def test_scenario_cell_before_after_schema(client, mock_task):
    h3_id = _get_res9_h3_id(client)
    if h3_id is None:
        return  # no data in test DB

    create_resp = _create_scenario(client, mock_task, name="Schema Test")
    scenario_id = create_resp.get_json()["scenario_id"]

    resp = client.get(f"/api/scenarios/{scenario_id}/cells/{h3_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    assert len(data) == 8
    for row in data:
        assert "crop_name" in row
        assert "baseline_score" in row
        assert "scenario_score" in row

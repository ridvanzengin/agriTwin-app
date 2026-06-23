"""Integration tests for POST /api/score/run and GET /api/score/status/<id>.

Scoring is expensive (347K cells). A session-scoped fixture runs Wheat scoring
exactly once; status tests reuse that task_id so the full scoring task runs only
one time per pytest session.
"""
import pytest

FAST_CROP = "Wheat"


@pytest.fixture(scope="session")
def wheat_task_id(app):
    """Trigger Wheat scoring once per test session; return the dispatched task_id."""
    with app.test_client() as c:
        resp = c.post("/api/score/run", json={"crop": FAST_CROP})
        assert resp.status_code == 202
        return resp.get_json()["task_id"]


def test_score_run_dispatches(wheat_task_id):
    assert wheat_task_id is not None


def test_score_status_after_run(app, wheat_task_id):
    with app.test_client() as c:
        resp = c.get(f"/api/score/status/{wheat_task_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] in {"SUCCESS", "FAILURE", "STARTED", "PENDING"}


def test_score_status_success_has_result(app, wheat_task_id):
    with app.test_client() as c:
        resp = c.get(f"/api/score/status/{wheat_task_id}")
        data = resp.get_json()
        if data["status"] == "SUCCESS":
            assert "crops_scored" in data["result"]


def test_score_run_with_unknown_crop_still_dispatches(client):
    # Early crop check in task exits before running expensive feature collection
    resp = client.post("/api/score/run", json={"crop": "MadeUpCrop99"})
    assert resp.status_code == 202


def test_score_status_unknown_task_id(client):
    resp = client.get("/api/score/status/nonexistent-task-id-00000000")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "PENDING"


def test_crops_list(client):
    resp = client.get("/api/crops")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    if data:
        assert "crop_id" in data[0]
        assert "name" in data[0]
        assert "scientific_name" in data[0]

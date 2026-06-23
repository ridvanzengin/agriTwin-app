from flask import Blueprint, jsonify, request, current_app
from celery.result import AsyncResult

bp = Blueprint("score", __name__, url_prefix="/api")


@bp.post("/score/run")
def run_score():
    """Dispatch a background suitability scoring task.

    Optional JSON body: {"crop": "Wheat"}
    Returns: {"task_id": "..."}
    """
    from ..tasks import run_suitability_scoring

    data = request.get_json(silent=True) or {}
    crop_name = data.get("crop") or None

    task = run_suitability_scoring.delay(crop_name=crop_name)
    return jsonify({"task_id": task.id}), 202


@bp.get("/score/status/<task_id>")
def score_status(task_id: str):
    """Poll the status of a scoring task.

    Returns: {"status": "PENDING|STARTED|SUCCESS|FAILURE", "result": {...}, "error": null}
    """
    celery = current_app.extensions["celery"]
    result = AsyncResult(task_id, app=celery)

    response = {"status": result.state, "result": None, "error": None}
    if result.state == "SUCCESS":
        response["result"] = result.result
    elif result.state == "FAILURE":
        response["error"] = str(result.result)
    elif result.state == "STARTED":
        response["result"] = result.info  # progress meta dict

    return jsonify(response)

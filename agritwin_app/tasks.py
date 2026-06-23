"""Celery tasks for background scoring."""
from datetime import datetime, timezone

from celery import shared_task
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db.session import get_session
from .db.models import Crop, CropRequirement, SpatialCell, SuitabilityScore
from .scoring.aggregator import collect_feature_values
from .scoring.engine import score_cell


@shared_task(bind=True, name="agritwin_app.tasks.run_suitability_scoring")
def run_suitability_scoring(self, crop_name: str | None = None) -> dict:
    """
    Bulk-score all res-9 cells for all crops (or one crop if crop_name given).
    Upserts results into suitability_score with scenario_id=NULL (baseline).
    Returns {"crops_scored": n, "cells_scored": n}.
    """
    BATCH = 5_000
    scored_at = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC for DateTime column
    total_cells = 0

    with get_session() as session:
        # Resolve crops first — skip expensive feature collection for unknown crops
        crops = session.execute(select(Crop)).scalars().all()
        if crop_name:
            crops = [c for c in crops if c.name.lower() == crop_name.lower()]
            if not crops:
                return {"error": f"crop {crop_name!r} not found"}

        # Pre-fetch all feature values once (no per-cell queries)
        self.update_state(state="STARTED", meta={"step": "collecting feature values"})
        feature_map = collect_feature_values(session)
        self.update_state(state="STARTED", meta={"step": "scoring", "crops": len(crops)})

        for crop in crops:
            reqs = session.execute(
                select(CropRequirement).where(CropRequirement.crop_id == crop.crop_id)
            ).scalars().all()
            req_dicts = [
                {
                    "parameter": r.parameter,
                    "min_value": r.min_value,
                    "optimal_value": r.optimal_value,
                    "max_value": r.max_value,
                    "weight": r.weight,
                }
                for r in reqs
            ]

            h3_ids = session.execute(
                select(SpatialCell.h3_id).where(SpatialCell.resolution == 9)
            ).scalars().all()

            batch: list[dict] = []

            for h3_id in h3_ids:
                fv = feature_map.get(h3_id, {})
                score = score_cell(fv, req_dicts)
                if score is not None:
                    batch.append({
                        "h3_id": h3_id,
                        "crop_id": crop.crop_id,
                        "score": score,
                        "scored_at": scored_at,
                    })

                if len(batch) >= BATCH:
                    _upsert_scores(session, batch)
                    batch.clear()

            if batch:
                _upsert_scores(session, batch)

            session.commit()
            total_cells += len(h3_ids)

    return {"crops_scored": len(crops), "cells_scored": total_cells}


def _upsert_scores(session, batch: list[dict]) -> None:
    """INSERT … ON CONFLICT DO UPDATE for baseline suitability scores (scenario_id IS NULL)."""
    if not batch:
        return
    rows = [
        {"h3_id": r["h3_id"], "crop_id": r["crop_id"], "scenario_id": None,
         "score": r["score"], "scored_at": r["scored_at"]}
        for r in batch
    ]
    stmt = pg_insert(SuitabilityScore).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["h3_id", "crop_id"],
        index_where=text("scenario_id IS NULL"),
        set_={"score": stmt.excluded.score, "scored_at": stmt.excluded.scored_at},
    )
    session.execute(stmt)

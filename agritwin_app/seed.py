import json
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)

_DEFAULT_POLYGON = (
    "POLYGON((32.3 37.9, 32.6 37.9, 32.6 38.1, 32.3 38.1, 32.3 37.9))"
)

_DEMO_SCENARIOS = [
    {
        "name": "Multi Requirement Test",
        "overrides": {"precipitation": 50.0, "temperature_2m": 1.0, "soil_ph_0-5cm": 0.3},
    },
    {
        "name": "Liming Implementation",
        "overrides": {"soil_ph_0-5cm": 0.5},
    },
    {
        "name": "Climate Change +2C",
        "overrides": {"temperature_2m": 2.0, "temperature_2m_min": 2.0},
    },
    {
        "name": "Irrigation +100mm",
        "overrides": {"precipitation": 100.0},
    },
]

_DEMO_NAMES = {s["name"] for s in _DEMO_SCENARIOS}


def seed_demo_scenarios() -> None:
    """Insert the 4 demo scenarios if they don't already exist, then dispatch
    Celery scoring tasks for any that are pending without a task_id."""
    from .db.session import get_session
    from .tasks import compute_scenario_scores

    with get_session() as session:
        existing = {
            row[0]
            for row in session.execute(
                text("SELECT name FROM scenario WHERE name = ANY(:names)"),
                {"names": list(_DEMO_NAMES)},
            )
        }

        new_ids: list[int] = []
        for demo in _DEMO_SCENARIOS:
            if demo["name"] in existing:
                continue

            row = session.execute(
                text("""
                    INSERT INTO scenario (name, overrides, polygon_geom, status, created_at)
                    VALUES (
                        :name,
                        CAST(:overrides AS JSONB),
                        ST_SetSRID(ST_GeomFromText(:polygon), 4326),
                        'pending',
                        NOW()
                    )
                    RETURNING scenario_id
                """),
                {
                    "name": demo["name"],
                    "overrides": json.dumps(demo["overrides"]),
                    "polygon": _DEFAULT_POLYGON,
                },
            )
            scenario_id = row.scalar_one()
            new_ids.append(scenario_id)
            logger.info("Seeded demo scenario %r (id=%d)", demo["name"], scenario_id)

        session.commit()

    # Dispatch tasks for newly inserted scenarios
    _dispatch_tasks(new_ids, compute_scenario_scores)

    # Also re-queue any stranded demo scenarios (pending, no task_id)
    # that may have been left behind by a prior partial run.
    with get_session() as session:
        stranded = [
            row[0]
            for row in session.execute(
                text("""
                    SELECT scenario_id FROM scenario
                    WHERE name = ANY(:names)
                      AND status = 'pending'
                      AND task_id IS NULL
                """),
                {"names": list(_DEMO_NAMES)},
            )
        ]

    if stranded:
        logger.info("Re-queuing %d stranded demo scenario(s)", len(stranded))
        _dispatch_tasks(stranded, compute_scenario_scores)


def _dispatch_tasks(scenario_ids: list[int], task_fn) -> None:
    from .db.session import get_session

    for scenario_id in scenario_ids:
        task = task_fn.delay(scenario_id)
        with get_session() as session:
            session.execute(
                text("UPDATE scenario SET task_id = :tid WHERE scenario_id = :id"),
                {"tid": task.id, "id": scenario_id},
            )
            session.commit()
        logger.info("Dispatched scoring task %s for scenario_id=%d", task.id, scenario_id)

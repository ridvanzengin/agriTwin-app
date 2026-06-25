import os
import pandas as pd
from celery import Celery
from sqlalchemy import text

celery = Celery("agritwin_app")


def init_celery(broker_url: str, result_backend: str) -> None:
    celery.conf.update(broker_url=broker_url, result_backend=result_backend)


def _ensure_db() -> None:
    from agritwin_app.db.session import _SessionLocal, init_db
    if _SessionLocal is None:
        db_url = os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg://agritwin:agritwin@localhost:5432/agritwin",
        )
        init_db(db_url)


@celery.task(bind=True)
def compute_scenario_scores(self, scenario_id: int) -> dict:
    """Score all res-9 cells within the scenario polygon with overrides applied."""
    _ensure_db()

    from agritwin_app.db.session import get_session
    from agritwin_etl.scoring.engine import score_cells

    with get_session() as session:
        # ── 1. Load scenario ──────────────────────────────────────────────────
        row = session.execute(
            text("""
                SELECT ST_AsText(polygon_geom) AS wkt, overrides
                FROM scenario WHERE scenario_id = :id
            """),
            {"id": scenario_id},
        ).one_or_none()

        if row is None:
            return {"error": f"scenario {scenario_id} not found"}

        polygon_wkt: str = row.wkt
        overrides: dict = row.overrides or {}

        # Mark running
        session.execute(
            text("UPDATE scenario SET status = 'running' WHERE scenario_id = :id"),
            {"id": scenario_id},
        )
        session.commit()

    try:
        with get_session() as session:
            # ── 2. Cells within polygon ───────────────────────────────────────
            cell_rows = session.execute(
                text("""
                    SELECT h3_id, elevation, slope
                    FROM spatial_cell
                    WHERE resolution = 9
                      AND ST_Within(geometry, ST_SetSRID(ST_GeomFromText(:wkt), 4326))
                """),
                {"wkt": polygon_wkt},
            ).mappings().all()

            if not cell_rows:
                _mark_failed(session, scenario_id, "no cells found in polygon")
                return {"error": "no cells found in polygon"}

            # Guard: very large polygons exhaust PostgreSQL shared memory when
            # all cell IDs are passed as an ANY(:ids) array parameter.
            MAX_CELLS = 30_000
            if len(cell_rows) > MAX_CELLS:
                reason = (
                    f"polygon covers {len(cell_rows):,} cells; "
                    f"limit is {MAX_CELLS:,}. Draw a smaller area."
                )
                _mark_failed(session, scenario_id, reason)
                return {"error": reason}

            import h3 as h3lib
            cell_h3_ids = [r["h3_id"] for r in cell_rows]

            cells_df = pd.DataFrame([
                {"h3_id": r["h3_id"], "elevation": r["elevation"],
                 "slope": r["slope"], "resolution": 9}
                for r in cell_rows
            ])

            # ── 3. Crop requirements ──────────────────────────────────────────
            req_rows = session.execute(
                text("""
                    SELECT c.name AS crop_name, cr.parameter, cr.month,
                           cr.min_value, cr.optimal_value, cr.max_value, cr.weight
                    FROM crop_requirement cr
                    JOIN crop c ON c.crop_id = cr.crop_id
                """),
            ).mappings().all()

            requirements_df = pd.DataFrame(list(req_rows))

            # ── 4. Weather observations (res-6 parents) ───────────────────────
            # Unique res-6 parents are at most ~1,007 for all of Konya — always
            # small enough to pass as an array parameter.
            parent_ids = list({h3lib.cell_to_parent(hid, 6) for hid in cell_h3_ids})

            weather_rows = session.execute(
                text("""
                    SELECT o.h3_id, f.name AS feature_name, o.timestamp, o.value
                    FROM observation o
                    JOIN feature f ON f.feature_id = o.feature_id
                    WHERE o.h3_id = ANY(:ids)
                      AND f.category = 'weather'
                """),
                {"ids": parent_ids},
            ).mappings().all()

            weather_df = pd.DataFrame(list(weather_rows)) if weather_rows else pd.DataFrame(
                columns=["h3_id", "feature_name", "timestamp", "value"]
            )

            # ── 5. Soil observations — spatial join avoids large array ────────
            # Passing tens of thousands of res-9 IDs as ANY(:ids) exhausts
            # PostgreSQL shared memory; use ST_Within join instead.
            soil_rows = session.execute(
                text("""
                    SELECT o.h3_id, f.name AS feature_name, o.timestamp, o.value
                    FROM observation o
                    JOIN feature f ON f.feature_id = o.feature_id
                    JOIN spatial_cell sc
                        ON sc.h3_id = o.h3_id AND sc.resolution = 9
                    WHERE f.category = 'soil'
                      AND ST_Within(sc.geometry,
                            ST_SetSRID(ST_GeomFromText(:wkt), 4326))
                """),
                {"wkt": polygon_wkt},
            ).mappings().all()

            soil_df = pd.DataFrame(list(soil_rows)) if soil_rows else pd.DataFrame(
                columns=["h3_id", "feature_name", "timestamp", "value"]
            )

        # ── 6. Apply overrides (additive deltas) ──────────────────────────────
        weather_features = {"precipitation", "temperature_2m", "temperature_2m_min"}
        soil_features = {"soil_ph_0-5cm"}

        if not weather_df.empty:
            for feat, delta in overrides.items():
                if feat in weather_features and delta != 0:
                    mask = weather_df["feature_name"] == feat
                    weather_df.loc[mask, "value"] = weather_df.loc[mask, "value"] + delta

        if not soil_df.empty:
            for feat, delta in overrides.items():
                if feat in soil_features and delta != 0:
                    mask = soil_df["feature_name"] == feat
                    soil_df.loc[mask, "value"] = soil_df.loc[mask, "value"] + delta

        # ── 7. Score cells ────────────────────────────────────────────────────
        result_df = score_cells(requirements_df, weather_df, soil_df, cells_df)

        # ── 8. Bulk-insert scores with scenario_id ────────────────────────────
        with get_session() as session:
            crop_rows = session.execute(
                text("SELECT crop_id, name FROM crop")
            ).mappings().all()
            crop_id_map = {r["name"]: r["crop_id"] for r in crop_rows}

            session.execute(
                text("""
                    DELETE FROM suitability_score
                    WHERE scenario_id = :scenario_id
                """),
                {"scenario_id": scenario_id},
            )

            records = [
                {
                    "h3_id": row["h3_id"],
                    "crop_id": crop_id_map[row["crop_name"]],
                    "scenario_id": scenario_id,
                    "score": float(row["score"]) if pd.notna(row["score"]) else None,
                    "scored_at": row["scored_at"],
                }
                for _, row in result_df.iterrows()
                if row["crop_name"] in crop_id_map
            ]

            # Insert in chunks of 5000 to avoid parameter limit
            chunk_size = 5000
            for i in range(0, len(records), chunk_size):
                chunk = records[i : i + chunk_size]
                session.execute(
                    text("""
                        INSERT INTO suitability_score (h3_id, crop_id, scenario_id, score, scored_at)
                        VALUES (:h3_id, :crop_id, :scenario_id, :score, :scored_at)
                    """),
                    chunk,
                )

            session.execute(
                text("""
                    UPDATE scenario
                    SET status = 'completed', scored_at = NOW()
                    WHERE scenario_id = :id
                """),
                {"id": scenario_id},
            )
            session.commit()

        return {"scenario_id": scenario_id, "rows": len(records)}

    except Exception as exc:
        with get_session() as session:
            _mark_failed(session, scenario_id, str(exc))
        raise


def _mark_failed(session, scenario_id: int, reason: str) -> None:
    session.execute(
        text("UPDATE scenario SET status = 'failed' WHERE scenario_id = :id"),
        {"id": scenario_id},
    )
    session.commit()

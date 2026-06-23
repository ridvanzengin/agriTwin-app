"""Create app-owned tables for Phase 3 suitability scoring.

Revision ID: 0001
Revises:
Create Date: 2026-06-23

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scenario",
        sa.Column("scenario_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "scenario_override",
        sa.Column("override_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenario.scenario_id", ondelete="CASCADE"), nullable=False),
        sa.Column("h3_id", sa.Text(), sa.ForeignKey("spatial_cell.h3_id"), nullable=False),
        sa.Column("feature_name", sa.Text(), nullable=False),
        sa.Column("override_value", sa.Float()),
    )

    op.create_table(
        "suitability_score",
        sa.Column("score_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("h3_id", sa.Text(), sa.ForeignKey("spatial_cell.h3_id"), nullable=False),
        sa.Column("crop_id", sa.Integer(), sa.ForeignKey("crop.crop_id"), nullable=False),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenario.scenario_id", ondelete="CASCADE")),
        sa.Column("score", sa.Float()),
        sa.Column("scored_at", sa.TIMESTAMP(timezone=True)),
    )
    # Partial indexes enforce uniqueness correctly when scenario_id is NULL.
    # A plain UniqueConstraint treats NULL != NULL, allowing duplicate baseline rows.
    op.execute("""
        CREATE UNIQUE INDEX uq_suitability_baseline
        ON suitability_score (h3_id, crop_id)
        WHERE scenario_id IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_suitability_scenario
        ON suitability_score (h3_id, crop_id, scenario_id)
        WHERE scenario_id IS NOT NULL
    """)

    op.create_table(
        "yield_prediction",
        sa.Column("prediction_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("h3_id", sa.Text(), sa.ForeignKey("spatial_cell.h3_id"), nullable=False),
        sa.Column("crop_id", sa.Integer(), sa.ForeignKey("crop.crop_id"), nullable=False),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenario.scenario_id", ondelete="CASCADE")),
        sa.Column("predicted_yield", sa.Float()),
        sa.Column("predicted_at", sa.TIMESTAMP(timezone=True)),
    )

    op.create_table(
        "profit_projection",
        sa.Column("projection_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("h3_id", sa.Text(), sa.ForeignKey("spatial_cell.h3_id"), nullable=False),
        sa.Column("crop_id", sa.Integer(), sa.ForeignKey("crop.crop_id"), nullable=False),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenario.scenario_id", ondelete="CASCADE")),
        sa.Column("gross_revenue", sa.Float()),
        sa.Column("total_cost", sa.Float()),
        sa.Column("net_profit", sa.Float()),
        sa.Column("projected_at", sa.TIMESTAMP(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("profit_projection")
    op.drop_table("yield_prediction")
    op.drop_table("suitability_score")
    op.drop_table("scenario_override")
    op.drop_table("scenario")

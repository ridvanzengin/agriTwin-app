"""Extend scenario table for Phase 4 scenario simulation.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-25

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("scenario", sa.Column("polygon_geom", Geometry("POLYGON", srid=4326)))
    op.add_column("scenario", sa.Column("overrides", sa.JSON()))
    op.add_column("scenario", sa.Column("task_id", sa.Text()))
    op.add_column("scenario", sa.Column("status", sa.Text(), server_default="pending"))
    op.add_column("scenario", sa.Column("scored_at", sa.TIMESTAMP(timezone=True)))


def downgrade() -> None:
    op.drop_column("scenario", "scored_at")
    op.drop_column("scenario", "status")
    op.drop_column("scenario", "task_id")
    op.drop_column("scenario", "overrides")
    op.drop_column("scenario", "polygon_geom")

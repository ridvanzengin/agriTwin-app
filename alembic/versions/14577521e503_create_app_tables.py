"""create_app_tables

Revision ID: 14577521e503
Revises:
Create Date: 2026-06-22 18:59:35.980493

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '14577521e503'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('scenario',
        sa.Column('scenario_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('scenario_id'),
    )
    op.create_table('scenario_override',
        sa.Column('override_id', sa.Integer(), nullable=False),
        sa.Column('scenario_id', sa.Integer(), nullable=False),
        sa.Column('h3_id', sa.Text(), nullable=False),
        sa.Column('feature_name', sa.Text(), nullable=False),
        sa.Column('override_value', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['h3_id'], ['spatial_cell.h3_id']),
        sa.ForeignKeyConstraint(['scenario_id'], ['scenario.scenario_id']),
        sa.PrimaryKeyConstraint('override_id'),
    )
    op.create_table('suitability_score',
        sa.Column('score_id', sa.Integer(), nullable=False),
        sa.Column('h3_id', sa.Text(), nullable=False),
        sa.Column('crop_id', sa.Integer(), nullable=False),
        sa.Column('scenario_id', sa.Integer(), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('scored_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['crop_id'], ['crop.crop_id']),
        sa.ForeignKeyConstraint(['h3_id'], ['spatial_cell.h3_id']),
        sa.ForeignKeyConstraint(['scenario_id'], ['scenario.scenario_id']),
        sa.PrimaryKeyConstraint('score_id'),
    )
    # Partial unique index for baseline scores (scenario_id IS NULL).
    # A regular UniqueConstraint on nullable columns doesn't prevent duplicates in PostgreSQL
    # because NULL != NULL. This index covers the baseline case; scenario-specific scores
    # are covered by the unique constraint below (scenario_id IS NOT NULL).
    op.create_index(
        'uq_suitability_baseline',
        'suitability_score',
        ['h3_id', 'crop_id'],
        unique=True,
        postgresql_where=sa.text('scenario_id IS NULL'),
    )
    op.create_index(
        'uq_suitability_scenario',
        'suitability_score',
        ['h3_id', 'crop_id', 'scenario_id'],
        unique=True,
        postgresql_where=sa.text('scenario_id IS NOT NULL'),
    )
    op.create_table('yield_prediction',
        sa.Column('prediction_id', sa.Integer(), nullable=False),
        sa.Column('h3_id', sa.Text(), nullable=False),
        sa.Column('crop_id', sa.Integer(), nullable=False),
        sa.Column('scenario_id', sa.Integer(), nullable=True),
        sa.Column('predicted_yield', sa.Float(), nullable=True),
        sa.Column('predicted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['crop_id'], ['crop.crop_id']),
        sa.ForeignKeyConstraint(['h3_id'], ['spatial_cell.h3_id']),
        sa.ForeignKeyConstraint(['scenario_id'], ['scenario.scenario_id']),
        sa.PrimaryKeyConstraint('prediction_id'),
    )
    op.create_table('profit_projection',
        sa.Column('projection_id', sa.Integer(), nullable=False),
        sa.Column('h3_id', sa.Text(), nullable=False),
        sa.Column('crop_id', sa.Integer(), nullable=False),
        sa.Column('scenario_id', sa.Integer(), nullable=True),
        sa.Column('gross_revenue', sa.Float(), nullable=True),
        sa.Column('total_cost', sa.Float(), nullable=True),
        sa.Column('net_profit', sa.Float(), nullable=True),
        sa.Column('projected_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['crop_id'], ['crop.crop_id']),
        sa.ForeignKeyConstraint(['h3_id'], ['spatial_cell.h3_id']),
        sa.ForeignKeyConstraint(['scenario_id'], ['scenario.scenario_id']),
        sa.PrimaryKeyConstraint('projection_id'),
    )


def downgrade() -> None:
    op.drop_table('profit_projection')
    op.drop_table('yield_prediction')
    op.drop_index('uq_suitability_scenario', table_name='suitability_score')
    op.drop_index('uq_suitability_baseline', table_name='suitability_score')
    op.drop_table('suitability_score')
    op.drop_table('scenario_override')
    op.drop_table('scenario')

from datetime import datetime
from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Float, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# ETL-owned tables (read-only)
# ---------------------------------------------------------------------------

class SpatialCell(Base):
    __tablename__ = "spatial_cell"

    h3_id: Mapped[str] = mapped_column(Text, primary_key=True)
    geometry: Mapped[object] = mapped_column(Geometry("POLYGON", srid=4326))
    resolution: Mapped[int] = mapped_column(Integer, default=9)
    elevation: Mapped[float | None] = mapped_column(Float)
    slope: Mapped[float | None] = mapped_column(Float)
    aspect: Mapped[float | None] = mapped_column(Float)

    observations: Mapped[list["Observation"]] = relationship(back_populates="cell")


class Feature(Base):
    __tablename__ = "feature"

    feature_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)

    observations: Mapped[list["Observation"]] = relationship(back_populates="feature")


class Observation(Base):
    __tablename__ = "observation"

    observation_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    h3_id: Mapped[str] = mapped_column(Text, ForeignKey("spatial_cell.h3_id"), nullable=False)
    feature_id: Mapped[int] = mapped_column(Integer, ForeignKey("feature.feature_id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(nullable=False)
    value: Mapped[float | None] = mapped_column(Float)

    cell: Mapped["SpatialCell"] = relationship(back_populates="observations")
    feature: Mapped["Feature"] = relationship(back_populates="observations")


class Crop(Base):
    __tablename__ = "crop"

    crop_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    scientific_name: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)


class CropRequirement(Base):
    __tablename__ = "crop_requirement"

    requirement_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    crop_id: Mapped[int] = mapped_column(Integer, ForeignKey("crop.crop_id"), nullable=False)
    parameter: Mapped[str] = mapped_column(Text, nullable=False)
    month: Mapped[int | None] = mapped_column(Integer)
    min_value: Mapped[float | None] = mapped_column(Float)
    optimal_value: Mapped[float | None] = mapped_column(Float)
    max_value: Mapped[float | None] = mapped_column(Float)
    weight: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(Text)


class DataSource(Base):
    __tablename__ = "data_source"

    source_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class IngestionRun(Base):
    __tablename__ = "ingestion_run"

    run_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(Integer, ForeignKey("data_source.source_id"))
    started_at: Mapped[datetime | None] = mapped_column()
    finished_at: Mapped[datetime | None] = mapped_column()
    status: Mapped[str | None] = mapped_column(Text)
    rows_written: Mapped[int | None] = mapped_column(BigInteger)


# ---------------------------------------------------------------------------
# App-owned tables (Phase 3+, none needed for Phase 2)
# ---------------------------------------------------------------------------

class Scenario(Base):
    __tablename__ = "scenario"

    scenario_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column()
    polygon_geom: Mapped[object | None] = mapped_column(Geometry("POLYGON", srid=4326))
    overrides: Mapped[dict | None] = mapped_column(JSON)
    task_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text, default="pending")
    scored_at: Mapped[datetime | None] = mapped_column()


class ScenarioOverride(Base):
    __tablename__ = "scenario_override"

    override_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenario.scenario_id"), nullable=False)
    h3_id: Mapped[str] = mapped_column(Text, ForeignKey("spatial_cell.h3_id"), nullable=False)
    feature_name: Mapped[str] = mapped_column(Text, nullable=False)
    override_value: Mapped[float | None] = mapped_column(Float)


class SuitabilityScore(Base):
    __tablename__ = "suitability_score"

    score_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    h3_id: Mapped[str] = mapped_column(Text, ForeignKey("spatial_cell.h3_id"), nullable=False)
    crop_id: Mapped[int] = mapped_column(Integer, ForeignKey("crop.crop_id"), nullable=False)
    scenario_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("scenario.scenario_id"))
    score: Mapped[float | None] = mapped_column(Float)
    scored_at: Mapped[datetime | None] = mapped_column()

    # Uniqueness enforced by partial indexes in the migration, not a constraint,
    # because PostgreSQL treats NULL != NULL in unique constraints (multiple baseline
    # rows with scenario_id=NULL would be allowed, defeating idempotent upserts).
    __table_args__ = ()


class YieldPrediction(Base):
    __tablename__ = "yield_prediction"

    prediction_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    h3_id: Mapped[str] = mapped_column(Text, ForeignKey("spatial_cell.h3_id"), nullable=False)
    crop_id: Mapped[int] = mapped_column(Integer, ForeignKey("crop.crop_id"), nullable=False)
    scenario_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("scenario.scenario_id"))
    predicted_yield: Mapped[float | None] = mapped_column(Float)
    predicted_at: Mapped[datetime | None] = mapped_column()


class ProfitProjection(Base):
    __tablename__ = "profit_projection"

    projection_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    h3_id: Mapped[str] = mapped_column(Text, ForeignKey("spatial_cell.h3_id"), nullable=False)
    crop_id: Mapped[int] = mapped_column(Integer, ForeignKey("crop.crop_id"), nullable=False)
    scenario_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("scenario.scenario_id"))
    gross_revenue: Mapped[float | None] = mapped_column(Float)
    total_cost: Mapped[float | None] = mapped_column(Float)
    net_profit: Mapped[float | None] = mapped_column(Float)
    projected_at: Mapped[datetime | None] = mapped_column()

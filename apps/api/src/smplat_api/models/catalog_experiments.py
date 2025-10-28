"""Catalog experimentation models for bundle A/B testing."""

from __future__ import annotations

import enum
from datetime import date
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class CatalogBundleExperimentStatus(enum.StrEnum):
    """Lifecycle status for bundle experiments."""

    # meta: taxonomy: catalog-bundle-experiment-status
    DRAFT = "draft"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"


class CatalogBundleExperiment(Base):
    """Experiment definition for catalog bundle overrides."""

    # meta: provenance: bundle-experiments
    __tablename__ = "catalog_bundle_experiments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Enum(CatalogBundleExperimentStatus), nullable=False, default=CatalogBundleExperimentStatus.DRAFT)
    guardrail_config = Column(JSON, nullable=False, default=dict)
    sample_size_guardrail = Column(Integer, nullable=False, server_default="0")
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    variants: Mapped[list["CatalogBundleExperimentVariant"]] = relationship(
        "CatalogBundleExperimentVariant",
        back_populates="experiment",
        cascade="all, delete-orphan",
    )
    metrics: Mapped[list["CatalogBundleExperimentMetric"]] = relationship(
        "CatalogBundleExperimentMetric",
        back_populates="experiment",
        cascade="all, delete-orphan",
    )


class CatalogBundleExperimentVariant(Base):
    """Experiment variant pointing to a catalog bundle override."""

    # meta: provenance: bundle-experiments
    __tablename__ = "catalog_bundle_experiment_variants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey("catalog_bundle_experiments.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    weight = Column(Integer, nullable=False, server_default="0")
    is_control = Column(Boolean, nullable=False, server_default="false")
    bundle_slug = Column(String, ForeignKey("catalog_bundles.bundle_slug", ondelete="SET NULL"), nullable=True)
    override_payload = Column(JSON, nullable=False, default=dict)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("experiment_id", "key", name="uq_bundle_experiment_variant_key"),
    )

    experiment: Mapped[CatalogBundleExperiment] = relationship(
        "CatalogBundleExperiment",
        back_populates="variants",
    )
    metrics: Mapped[list["CatalogBundleExperimentMetric"]] = relationship(
        "CatalogBundleExperimentMetric",
        back_populates="variant",
        cascade="all, delete-orphan",
    )


class CatalogBundleExperimentMetric(Base):
    """Time-series metrics for bundle experiment variants."""

    # meta: provenance: bundle-experiments
    __tablename__ = "catalog_bundle_experiment_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("catalog_bundle_experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("catalog_bundle_experiment_variants.id", ondelete="CASCADE"),
        nullable=False,
    )
    window_start = Column(Date, nullable=False)
    lookback_days = Column(Integer, nullable=False, server_default="30")
    acceptance_rate = Column(Numeric(6, 4), nullable=False, server_default="0")
    acceptance_count = Column(Integer, nullable=False, server_default="0")
    sample_size = Column(Integer, nullable=False, server_default="0")
    lift_vs_control = Column(Numeric(6, 4), nullable=True)
    guardrail_breached = Column(Boolean, nullable=False, server_default="false")
    computed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("variant_id", "window_start", "lookback_days", name="uq_bundle_experiment_metric_window"),
    )

    def lift_float(self) -> float | None:
        """Return the lift as a floating point value."""

        if self.lift_vs_control is None:
            return None
        try:
            return float(self.lift_vs_control)
        except (TypeError, ValueError):  # pragma: no cover - defensive conversion
            return None

    experiment: Mapped[CatalogBundleExperiment] = relationship(
        "CatalogBundleExperiment",
        back_populates="metrics",
    )
    variant: Mapped[CatalogBundleExperimentVariant] = relationship(
        "CatalogBundleExperimentVariant",
        back_populates="metrics",
    )


__all__ = [
    "CatalogBundleExperiment",
    "CatalogBundleExperimentMetric",
    "CatalogBundleExperimentStatus",
    "CatalogBundleExperimentVariant",
]

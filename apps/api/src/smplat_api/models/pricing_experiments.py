from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class PricingExperimentStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"


class PricingAdjustmentKind(str, Enum):
    DELTA = "delta"
    MULTIPLIER = "multiplier"


class PricingExperiment(Base):
    """Represents a pricing experiment configuration."""

    __tablename__ = "pricing_experiments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug = Column(String(150), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    target_product_slug = Column(String(150), nullable=False)
    target_segment = Column(String(120), nullable=True)
    feature_flag_key = Column(String(150), nullable=True)
    assignment_strategy = Column(String(120), nullable=False)
    status = Column(
        SqlEnum(PricingExperimentStatus, name="pricing_experiment_status"),
        nullable=False,
        default=PricingExperimentStatus.DRAFT,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    variants = relationship(
        "PricingExperimentVariant",
        back_populates="experiment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PricingExperimentVariant(Base):
    """Variant definition for pricing experiments."""

    __tablename__ = "pricing_experiment_variants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pricing_experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    key = Column(String(100), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    weight = Column(Integer, nullable=False, default=0)
    is_control = Column(Boolean, nullable=False, default=False)
    adjustment_kind = Column(
        SqlEnum(PricingAdjustmentKind, name="pricing_adjustment_kind"),
        nullable=False,
        default=PricingAdjustmentKind.DELTA,
    )
    price_delta_cents = Column(Integer, nullable=False, default=0)
    price_multiplier = Column(Numeric(8, 4), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    experiment = relationship("PricingExperiment", back_populates="variants")
    metrics = relationship(
        "PricingExperimentMetric",
        back_populates="variant",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (UniqueConstraint("experiment_id", "key", name="uq_pricing_variant_experiment_key"),)


class PricingExperimentMetric(Base):
    """Aggregated metric rollups for pricing experiment variants."""

    __tablename__ = "pricing_experiment_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pricing_experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pricing_experiment_variants.id", ondelete="CASCADE"),
        nullable=False,
    )
    window_start = Column(Date, nullable=False)
    exposures = Column(Integer, nullable=False, default=0)
    conversions = Column(Integer, nullable=False, default=0)
    revenue_cents = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    variant = relationship("PricingExperimentVariant", back_populates="metrics")
    experiment = relationship("PricingExperiment")

    __table_args__ = (
        UniqueConstraint("variant_id", "window_start", name="uq_pricing_metric_variant_window"),
    )


__all__ = [
    "PricingExperiment",
    "PricingExperimentVariant",
    "PricingExperimentMetric",
    "PricingExperimentStatus",
    "PricingAdjustmentKind",
]

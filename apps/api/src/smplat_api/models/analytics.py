"""Analytics-focused persistence models."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Column, Date, DateTime, Index, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from smplat_api.db.base import Base


class CheckoutOfferEvent(Base):
    """Captured storefront checkout offer interactions."""

    __tablename__ = "checkout_offer_events"
    __table_args__ = (
        Index("ix_checkout_offer_events_event_type", "event_type"),
        Index("ix_checkout_offer_events_offer_slug", "offer_slug"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    offer_slug = Column(String(length=255), nullable=False)
    target_slug = Column(String(length=255), nullable=True)
    event_type = Column(String(length=64), nullable=False)
    action = Column(String(length=64), nullable=True)
    cart_total = Column(Numeric(12, 2), nullable=True)
    currency = Column(String(length=16), nullable=True)
    order_reference = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSONB().with_variant(JSON(), "sqlite"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PresetEventDailyMetric(Base):
    """Daily aggregate counts for preset interactions."""

    __tablename__ = "preset_event_daily_metrics"
    __table_args__ = (
        Index("ix_preset_event_daily_metrics_metric_date", "metric_date", unique=True),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    metric_date = Column(Date(), unique=True, nullable=False)
    preset_cta_apply_count = Column(Integer, nullable=False, default=0)
    preset_configurator_apply_count = Column(Integer, nullable=False, default=0)
    preset_configurator_clear_count = Column(Integer, nullable=False, default=0)
    source_counts = Column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=False,
        default=list,
    )
    trend_stats = Column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=False,
        default=dict,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

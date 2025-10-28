"""Persistent cache storage for fulfillment metric snapshots."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String

from smplat_api.db.base import Base


class FulfillmentMetricCache(Base):
    """Durable cache entry for fulfillment metric snapshots."""

    # meta: cache-layer: persistent
    __tablename__ = "fulfillment_metric_cache"

    metric_id = Column(String, primary_key=True)
    value = Column(Float, nullable=True)
    formatted_value = Column(String, nullable=True)
    sample_size = Column(Integer, nullable=False, server_default="0")
    computed_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    forecast_json = Column("forecast", JSON, nullable=True)

    @classmethod
    def from_snapshot(cls, snapshot: "MetricSnapshot", expires_at: datetime) -> "FulfillmentMetricCache":
        from smplat_api.services.fulfillment.metrics import MetricSnapshot

        instance = cls(
            metric_id=snapshot.metric_id,
            value=snapshot.value,
            formatted_value=snapshot.formatted_value,
            sample_size=snapshot.sample_size,
            computed_at=snapshot.computed_at,
            expires_at=expires_at,
            metadata_json=snapshot.metadata,
            forecast_json=snapshot.forecast,
        )
        return instance

    def to_snapshot(self) -> "MetricSnapshot":
        from smplat_api.services.fulfillment.metrics import MetricSnapshot

        metadata: dict[str, Any]
        if isinstance(self.metadata_json, dict):
            metadata = self.metadata_json
        else:  # pragma: no cover - defensive fallback for legacy rows
            metadata = {}

        computed_at = self.computed_at
        if computed_at.tzinfo is None:
            computed_at = computed_at.replace(tzinfo=timezone.utc)

        return MetricSnapshot(
            metric_id=self.metric_id,
            value=self.value,
            formatted_value=self.formatted_value,
            computed_at=computed_at,
            sample_size=self.sample_size,
            metadata=metadata,
            forecast=self.forecast_json if isinstance(self.forecast_json, dict) else None,
        )

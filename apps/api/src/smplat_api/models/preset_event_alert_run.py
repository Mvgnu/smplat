"""Preset analytics alert run history."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Column, Date, DateTime, Integer, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from smplat_api.db.base import Base


class PresetEventAlertRun(Base):
    """Durable log for preset analytics alert evaluations."""

    __tablename__ = "preset_event_alert_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    status = Column(String(length=32), nullable=False, server_default="success")
    window_start_date = Column(Date(), nullable=False)
    window_days = Column(Integer, nullable=False, server_default="30")
    alerts_sent = Column(Integer, nullable=False, server_default="0")
    alert_codes = Column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=False,
        default=list,
    )
    summary = Column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=False,
        default=dict,
    )
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


__all__ = ["PresetEventAlertRun"]

"""Persistence model for receipt storage probe telemetry."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String

from smplat_api.db.base import Base


class ReceiptStorageProbeTelemetry(Base):
    """Tracks the last receipt storage probe outcomes for readiness reporting."""

    __tablename__ = "receipt_storage_probe_telemetry"

    component = Column(String(64), primary_key=True, default="receipt_storage")
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    last_error_message = Column(String(512), nullable=True)
    last_sentinel_key = Column(String(512), nullable=True)
    last_detail = Column(String(512), nullable=True)

    def touch_success(self, *, sentinel_key: str, detail: str | None = None) -> None:
        """Record a successful probe run."""

        now = datetime.now(timezone.utc)
        self.last_checked_at = now
        self.last_success_at = now
        self.last_detail = detail
        self.last_sentinel_key = sentinel_key
        self.last_error_message = None

    def touch_failure(self, error_message: str) -> None:
        """Record a failed probe run."""

        now = datetime.now(timezone.utc)
        self.last_checked_at = now
        self.last_error_at = now
        self.last_error_message = error_message


__all__ = ["ReceiptStorageProbeTelemetry"]

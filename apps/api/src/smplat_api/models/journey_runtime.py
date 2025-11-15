"""Journey runtime persistence models."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class JourneyComponentRunStatusEnum(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JourneyComponentRun(Base):
    """Tracks execution attempts for journey components."""

    __tablename__ = "journey_component_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_token = Column(String(64), nullable=False, unique=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    product_component_id = Column(
        UUID(as_uuid=True),
        ForeignKey("product_journey_components.id", ondelete="SET NULL"),
        nullable=True,
    )
    component_id = Column(UUID(as_uuid=True), ForeignKey("journey_components.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(64), nullable=True)
    trigger = Column(JSON, nullable=True)
    input_payload = Column(JSON, nullable=True)
    binding_snapshot = Column(JSON, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    context = Column(JSON, nullable=True)
    telemetry_json = Column("telemetry", JSON, nullable=True)
    status = Column(
        SqlEnum(
            JourneyComponentRunStatusEnum,
            name="journey_component_run_status_enum",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
        server_default=JourneyComponentRunStatusEnum.PENDING.value,
    )
    attempts = Column(Integer, nullable=False, server_default="0")
    error_message = Column(Text, nullable=True)
    result_payload = Column(JSON, nullable=True)
    queued_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="journey_runs")
    product_component = relationship("ProductJourneyComponent", back_populates="runs")
    component = relationship("JourneyComponent", back_populates="runs")


__all__ = ["JourneyComponentRun", "JourneyComponentRunStatusEnum"]

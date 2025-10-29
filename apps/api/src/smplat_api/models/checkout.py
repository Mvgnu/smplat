"""Checkout orchestration models."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, Enum as SqlEnum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class CheckoutOrchestrationStage(str, Enum):
    """Workflow phases for checkout orchestration."""

    PAYMENT = "payment"
    VERIFICATION = "verification"
    LOYALTY_HOLD = "loyalty_hold"
    FULFILLMENT = "fulfillment"
    COMPLETED = "completed"


class CheckoutOrchestrationStatus(str, Enum):
    """Status for the orchestration progression."""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"


class CheckoutOrchestration(Base):
    """Aggregate record for checkout orchestration."""

    # meta: checkout-orchestration: aggregate-record

    __tablename__ = "checkout_orchestrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    current_stage = Column(
        SqlEnum(CheckoutOrchestrationStage, name="checkout_orchestration_stage_enum"),
        nullable=False,
        server_default=CheckoutOrchestrationStage.PAYMENT.value,
    )
    stage_status = Column(
        SqlEnum(CheckoutOrchestrationStatus, name="checkout_orchestration_status_enum"),
        nullable=False,
        server_default=CheckoutOrchestrationStatus.NOT_STARTED.value,
    )
    metadata_json = Column("metadata", JSON, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    last_transition_at = Column(DateTime(timezone=True), nullable=True)
    next_action_at = Column(DateTime(timezone=True), nullable=True)
    locked_until = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    order = relationship("Order", back_populates="checkout_orchestration")
    user = relationship("User")
    events = relationship(
        "CheckoutOrchestrationEvent",
        back_populates="orchestration",
        cascade="all, delete-orphan",
        order_by="CheckoutOrchestrationEvent.created_at",
    )


class CheckoutOrchestrationEvent(Base):
    """Event log for checkout orchestration transitions."""

    # meta: checkout-orchestration: event-log

    __tablename__ = "checkout_orchestration_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    orchestration_id = Column(
        UUID(as_uuid=True),
        ForeignKey("checkout_orchestrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stage = Column(
        SqlEnum(CheckoutOrchestrationStage, name="checkout_orchestration_stage_enum"),
        nullable=False,
    )
    status = Column(
        SqlEnum(CheckoutOrchestrationStatus, name="checkout_orchestration_status_enum"),
        nullable=False,
    )
    transition_note = Column(Text, nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    orchestration = relationship("CheckoutOrchestration", back_populates="events")

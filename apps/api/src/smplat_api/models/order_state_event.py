"""Order state transition audit log models."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class OrderStateEventTypeEnum(str, Enum):
    """Supported order timeline event categories."""

    STATE_CHANGE = "state_change"
    NOTE = "note"
    REFILL_REQUESTED = "refill_requested"
    REFILL_COMPLETED = "refill_completed"
    REFUND_REQUESTED = "refund_requested"
    REFUND_COMPLETED = "refund_completed"
    REPLAY_SCHEDULED = "replay_scheduled"
    REPLAY_EXECUTED = "replay_executed"
    AUTOMATION_ALERT = "automation_alert"


class OrderStateActorTypeEnum(str, Enum):
    """Identity of the actor emitting the order event."""

    SYSTEM = "system"
    OPERATOR = "operator"
    ADMIN = "admin"
    AUTOMATION = "automation"
    PROVIDER = "provider"


class OrderStateEvent(Base):
    """Audit log entry capturing every order state transition and delivery proof note."""

    __tablename__ = "order_state_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(
        SqlEnum(OrderStateEventTypeEnum, name="order_state_event_type_enum"),
        nullable=False,
    )
    actor_type = Column(
        SqlEnum(OrderStateActorTypeEnum, name="order_state_actor_type_enum"),
        nullable=True,
    )
    actor_id = Column(String(255), nullable=True)
    actor_label = Column(String(255), nullable=True)
    from_status = Column(String(64), nullable=True)
    to_status = Column(String(64), nullable=True)
    notes = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="state_events")

"""Durable hosted checkout session model."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class HostedCheckoutSessionStatusEnum(str, Enum):
    """Lifecycle states for hosted checkout sessions."""

    INITIATED = "initiated"
    COMPLETED = "completed"
    EXPIRED = "expired"
    ABANDONED = "abandoned"
    FAILED = "failed"


class HostedCheckoutSession(Base):
    """Persisted hosted checkout session tied to invoices and workspaces."""

    # meta: hosted-session: durable-record

    __tablename__ = "hosted_checkout_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(String, nullable=False, unique=True, index=True)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invoice_id = Column(
        UUID(as_uuid=True),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = Column(
        SqlEnum(
            HostedCheckoutSessionStatusEnum,
            name="hosted_checkout_session_status_enum",
        ),
        nullable=False,
        server_default=HostedCheckoutSessionStatusEnum.INITIATED.value,
    )
    expires_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    recovery_notes = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, server_default="0")
    last_retry_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    workspace = relationship("User")
    invoice = relationship(
        "Invoice",
        back_populates="hosted_sessions",
        foreign_keys=[invoice_id],
    )

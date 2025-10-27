from enum import Enum
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum as SqlEnum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class NotificationStatusEnum(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class NotificationChannelEnum(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    channel = Column(SqlEnum(NotificationChannelEnum, name="notification_channel_enum"), nullable=False, server_default=NotificationChannelEnum.EMAIL.value)
    status = Column(SqlEnum(NotificationStatusEnum, name="notification_status_enum"), nullable=False, server_default=NotificationStatusEnum.PENDING.value)
    category = Column(String, nullable=False)
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    provider = Column(String, nullable=True)
    provider_message_id = Column(String, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)


class NotificationPreference(Base):
    """Per-user notification delivery preferences."""

    __tablename__ = "notification_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    order_updates = Column(Boolean, nullable=False, server_default="true")
    payment_updates = Column(Boolean, nullable=False, server_default="true")
    fulfillment_alerts = Column(Boolean, nullable=False, server_default="true")
    marketing_messages = Column(Boolean, nullable=False, server_default="false")
    billing_alerts = Column(Boolean, nullable=False, server_default="false")
    last_selected_order_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

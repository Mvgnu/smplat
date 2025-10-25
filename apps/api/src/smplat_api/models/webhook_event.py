from datetime import datetime
from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum as SqlEnum, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class WebhookProviderEnum(str, Enum):
    STRIPE = "stripe"


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider = Column(SqlEnum(WebhookProviderEnum, name="webhook_provider_enum"), nullable=False)
    external_id = Column(String, nullable=False)
    event_type = Column(String, nullable=True)
    processed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_webhook_events_provider_external"),
    )

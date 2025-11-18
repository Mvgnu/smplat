from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class ProviderGuardrailFollowUp(Base):
    __tablename__ = "provider_guardrail_followup"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider_id = Column(String(128), nullable=False)
    provider_name = Column(String(255), nullable=True)
    action = Column(String(64), nullable=False)
    notes = Column(Text, nullable=True)
    platform_context = Column(JSON, nullable=True)
    attachments = Column(JSON, nullable=True)
    conversion_cursor = Column(String(255), nullable=True)
    conversion_href = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=datetime.utcnow)

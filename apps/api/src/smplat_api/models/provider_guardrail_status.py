from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class ProviderGuardrailStatus(Base):
    __tablename__ = "provider_guardrail_status"

    provider_id = Column(String(128), primary_key=True)
    provider_name = Column(String(255), nullable=True)
    last_action = Column(String(64), nullable=True)
    is_paused = Column(Boolean, nullable=False, server_default="false", default=False)
    last_source = Column(String(32), nullable=False, server_default="manual", default="manual")
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        default=datetime.utcnow,
    )
    last_follow_up_id = Column(
        UUID(as_uuid=True),
        ForeignKey("provider_guardrail_followup.id", ondelete="SET NULL"),
        nullable=True,
    )

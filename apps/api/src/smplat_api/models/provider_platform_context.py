from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, JSON, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class ProviderPlatformContextCache(Base):
    """Cached mapping of provider_ids to recently observed platform contexts."""

    __tablename__ = "provider_platform_context_cache"
    __table_args__ = (
        UniqueConstraint("provider_id", "platform_id", name="uq_provider_platform_context"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider_id = Column(String(128), nullable=False)
    platform_id = Column(String(255), nullable=False)
    label = Column(String(255), nullable=False)
    handle = Column(String(255), nullable=True)
    platform_type = Column(String(64), nullable=True)
    context = Column(JSON, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=datetime.utcnow)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=datetime.utcnow)


__all__ = ["ProviderPlatformContextCache"]

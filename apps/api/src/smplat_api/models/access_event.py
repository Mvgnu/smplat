from uuid import uuid4

from sqlalchemy import Column, DateTime, String, Text, JSON, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class AccessEvent(Base):
    __tablename__ = "access_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    route = Column(String, nullable=False)
    method = Column(String, nullable=True)
    required_tier = Column(String, nullable=False)
    decision = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    subject_email = Column(String, nullable=True)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    service_account_id = Column(UUID(as_uuid=True), nullable=True)
    event_metadata = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

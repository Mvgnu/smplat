"""Provider automation run history models."""

from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum as SqlEnum, Integer, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class ProviderAutomationRunTypeEnum(str, Enum):
    REPLAY = "replay"
    ALERT = "alert"


class ProviderAutomationRun(Base):
    __tablename__ = "provider_automation_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_type = Column(
        SqlEnum(
            ProviderAutomationRunTypeEnum,
            name="provider_automation_run_type_enum",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
    )
    status = Column(String, nullable=False, server_default="success")
    summary = Column(JSON, nullable=False)
    metadata_json = Column(JSON, nullable=True)
    backlog_total = Column(Integer, nullable=True)
    next_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    alerts_sent = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

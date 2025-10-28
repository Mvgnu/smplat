"""Processor event ledger models and helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.base import Base
from smplat_api.models.webhook_event import WebhookProviderEnum


class ProcessorEvent(Base):
    """Durable record for every processor webhook event."""

    __tablename__ = "processor_events"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider = Column(
        SqlEnum(WebhookProviderEnum, name="webhook_provider_enum", create_type=False),
        nullable=False,
    )
    external_id = Column(String(128), nullable=False)
    payload_hash = Column(String(128), nullable=False)
    correlation_id = Column(String(128), nullable=True)
    workspace_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    invoice_id = Column(PG_UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True)
    payload_json = Column("payload", JSON, nullable=True)
    received_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    replay_requested = Column(Boolean, nullable=False, server_default="false")
    replay_requested_at = Column(DateTime(timezone=True), nullable=True)
    replay_attempts = Column(Integer, nullable=False, server_default="0")
    replayed_at = Column(DateTime(timezone=True), nullable=True)
    last_replay_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_processor_event_provider_external"),
        UniqueConstraint("provider", "payload_hash", name="uq_processor_event_provider_payload_hash"),
    )


@dataclass(slots=True)
class RecordedProcessorEvent:
    """Result container for processor event logging."""

    event: ProcessorEvent
    created: bool


async def record_processor_event(
    session: AsyncSession,
    *,
    provider: WebhookProviderEnum,
    external_id: str,
    payload_hash: str,
    payload: dict[str, Any] | None,
    correlation_id: str | None = None,
    workspace_id: UUID | None = None,
    invoice_id: UUID | None = None,
) -> RecordedProcessorEvent:
    """Persist the processor event if it has not already been recorded."""

    stmt = select(ProcessorEvent).where(
        ProcessorEvent.provider == provider,
        ProcessorEvent.external_id == external_id,
    )
    existing_by_id = await session.execute(stmt)
    existing = existing_by_id.scalar_one_or_none()
    if existing:
        return RecordedProcessorEvent(event=existing, created=False)

    stmt = select(ProcessorEvent).where(
        ProcessorEvent.provider == provider,
        ProcessorEvent.payload_hash == payload_hash,
    )
    existing_by_hash = await session.execute(stmt)
    duplicate = existing_by_hash.scalar_one_or_none()
    if duplicate:
        return RecordedProcessorEvent(event=duplicate, created=False)

    event = ProcessorEvent(
        provider=provider,
        external_id=external_id,
        payload_hash=payload_hash,
        correlation_id=correlation_id,
        workspace_id=workspace_id,
        invoice_id=invoice_id,
        payload_json=payload,
    )
    session.add(event)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing_stmt = select(ProcessorEvent).where(
            ProcessorEvent.provider == provider,
            ProcessorEvent.external_id == external_id,
        )
        existing_event = await session.execute(existing_stmt)
        found = existing_event.scalar_one_or_none()
        if found is None:
            raise
        return RecordedProcessorEvent(event=found, created=False)

    return RecordedProcessorEvent(event=event, created=True)


async def mark_replay_requested(
    session: AsyncSession,
    *,
    event: ProcessorEvent,
    requested_at: datetime,
) -> ProcessorEvent:
    """Update replay request metadata for a processor event."""

    event.replay_requested = True
    event.replay_requested_at = requested_at
    await session.flush()
    return event


class ProcessorEventReplayAttempt(Base):
    """Audit log capturing each replay attempt for a processor event."""

    __tablename__ = "processor_event_replay_attempts"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("processor_events.id", ondelete="CASCADE"),
        nullable=False,
    )
    attempted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status = Column(String(32), nullable=False)
    error = Column(Text, nullable=True)
    metadata_snapshot = Column(JSON, nullable=True)


async def register_replay_attempt(
    session: AsyncSession,
    *,
    event: ProcessorEvent,
    attempted_at: datetime,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ProcessorEvent:
    """Record a replay attempt and capture the outcome."""

    event.replay_attempts += 1
    event.replayed_at = attempted_at if error is None else event.replayed_at
    event.last_replay_error = error
    if error is None:
        event.replay_requested = False

    attempt = ProcessorEventReplayAttempt(
        event_id=event.id,
        attempted_at=attempted_at,
        status="succeeded" if error is None else "failed",
        error=error,
        metadata_snapshot=metadata,
    )
    session.add(attempt)

    await session.flush()
    return event


async def fetch_replay_attempts(
    session: AsyncSession,
    *,
    event_id: UUID,
    limit: int = 25,
) -> list[ProcessorEventReplayAttempt]:
    """Return replay attempts for a processor event ordered by recency."""

    stmt = (
        select(ProcessorEventReplayAttempt)
        .where(ProcessorEventReplayAttempt.event_id == event_id)
        .order_by(ProcessorEventReplayAttempt.attempted_at.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def fetch_events_for_replay(
    session: AsyncSession,
    *,
    limit: int = 50,
    providers: Iterable[WebhookProviderEnum] | None = None,
) -> list[ProcessorEvent]:
    """Return replay-eligible events respecting optional provider filters."""

    stmt = select(ProcessorEvent).where(ProcessorEvent.replay_requested.is_(True))
    if providers:
        stmt = stmt.where(ProcessorEvent.provider.in_(tuple(providers)))
    stmt = stmt.order_by(ProcessorEvent.replay_requested_at.asc().nulls_last()).limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())

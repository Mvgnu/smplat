"""Replay orchestration APIs for processor events."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import async_session, get_session
from smplat_api.models.processor_event import (
    ProcessorEvent,
    mark_replay_requested,
)
from smplat_api.models.webhook_event import WebhookProviderEnum
from smplat_api.workers.processor_events import ProcessorEventReplayWorker, ReplayLimitExceededError

router = APIRouter(prefix="/billing/replays", tags=["billing-replays"])


class ProcessorEventResponse(BaseModel):
    """Serialized view of a processor ledger entry."""

    id: UUID
    provider: WebhookProviderEnum
    external_id: str = Field(alias="externalId")
    correlation_id: str | None = Field(default=None, alias="correlationId")
    workspace_id: UUID | None = Field(default=None, alias="workspaceId")
    invoice_id: UUID | None = Field(default=None, alias="invoiceId")
    replay_requested: bool = Field(alias="replayRequested")
    replay_requested_at: datetime | None = Field(default=None, alias="replayRequestedAt")
    replay_attempts: int = Field(alias="replayAttempts")
    replayed_at: datetime | None = Field(default=None, alias="replayedAt")
    last_replay_error: str | None = Field(default=None, alias="lastReplayError")
    received_at: datetime = Field(alias="receivedAt")
    created_at: datetime = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class TriggerReplayRequest(BaseModel):
    """Payload controlling replay invocation semantics."""

    force: bool = Field(default=False, description="Force immediate replay even if attempts exceeded")


def _enqueue_worker() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        worker = ProcessorEventReplayWorker(async_session)
        await worker.process_pending(limit=20)

    loop.create_task(_run())


def _serialize_event(event: ProcessorEvent) -> ProcessorEventResponse:
    return ProcessorEventResponse.model_validate(
        {
            "id": event.id,
            "provider": event.provider,
            "externalId": event.external_id,
            "correlationId": event.correlation_id,
            "workspaceId": event.workspace_id,
            "invoiceId": event.invoice_id,
            "replayRequested": event.replay_requested,
            "replayRequestedAt": event.replay_requested_at,
            "replayAttempts": event.replay_attempts,
            "replayedAt": event.replayed_at,
            "lastReplayError": event.last_replay_error,
            "receivedAt": event.received_at,
            "createdAt": event.created_at,
        }
    )


@router.get("/", response_model=list[ProcessorEventResponse])
async def list_processor_events(
    *,
    session: AsyncSession = Depends(get_session),
    provider: WebhookProviderEnum | None = Query(default=None),
    requested_only: bool = Query(default=True, alias="requestedOnly"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ProcessorEventResponse]:
    """Return ledger entries with optional filtering."""

    stmt = select(ProcessorEvent).order_by(ProcessorEvent.received_at.desc()).limit(limit)
    if provider is not None:
        stmt = stmt.where(ProcessorEvent.provider == provider)
    if requested_only:
        stmt = stmt.where(ProcessorEvent.replay_requested.is_(True))
    results = await session.execute(stmt)
    events = results.scalars().all()
    return [_serialize_event(event) for event in events]


@router.post("/{event_id}/trigger", response_model=ProcessorEventResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_replay(
    *,
    event_id: UUID,
    payload: TriggerReplayRequest = Body(default_factory=TriggerReplayRequest),
    session: AsyncSession = Depends(get_session),
) -> ProcessorEventResponse:
    """Mark an event for replay and optionally run it immediately."""

    event = await session.get(ProcessorEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    now = datetime.now(timezone.utc)
    await mark_replay_requested(session, event=event, requested_at=now)
    await session.flush()
    await session.commit()

    if payload.force:
        worker = ProcessorEventReplayWorker(async_session)
        try:
            replayed = await worker.replay_event(event_id, force=True)
        except ReplayLimitExceededError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        return _serialize_event(replayed)

    _enqueue_worker()
    refreshed = await session.get(ProcessorEvent, event_id)
    assert refreshed is not None
    return _serialize_event(refreshed)

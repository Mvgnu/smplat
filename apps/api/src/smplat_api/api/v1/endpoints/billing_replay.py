"""Replay orchestration APIs for processor events."""

from __future__ import annotations

import asyncio
import json
from enum import Enum
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, cast, func, or_, select, String
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import async_session, get_session
from smplat_api.models.invoice import Invoice
from smplat_api.models.processor_event import (
    ProcessorEvent,
    ProcessorEventReplayAttempt,
    fetch_replay_attempts,
    mark_replay_requested,
)
from smplat_api.models.webhook_event import WebhookProviderEnum
from smplat_api.workers.processor_events import ProcessorEventReplayWorker, ReplayLimitExceededError

router = APIRouter(prefix="/billing/replays", tags=["billing-replays"])


class ProcessorReplayStatus(str, Enum):
    """Enumerates the replay lifecycle state exposed to clients."""

    PENDING = "pending"
    QUEUED = "queued"
    IN_PROGRESS = "in-progress"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


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
    status: ProcessorReplayStatus

    model_config = {"populate_by_name": True}


class TriggerReplayRequest(BaseModel):
    """Payload controlling replay invocation semantics."""

    force: bool = Field(default=False, description="Force immediate replay even if attempts exceeded")


class ReplayAttemptResponse(BaseModel):
    """Serialized replay attempt information."""

    id: UUID
    attempted_at: datetime = Field(alias="attemptedAt")
    status: str
    error: str | None = None
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class ProcessorEventDetailResponse(ProcessorEventResponse):
    """Extended event view including replay history and invoice details."""

    attempts: list[ReplayAttemptResponse]
    invoice_snapshot: dict | None = Field(default=None, alias="invoiceSnapshot")


def _enqueue_worker() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        worker = ProcessorEventReplayWorker(async_session)
        await worker.process_pending(limit=20)

    loop.create_task(_run())


def _derive_status(event: ProcessorEvent) -> ProcessorReplayStatus:
    """Compute the replay lifecycle status for an event."""

    if event.replayed_at is not None:
        return ProcessorReplayStatus.SUCCEEDED
    if event.last_replay_error:
        return ProcessorReplayStatus.FAILED
    if event.replay_requested and event.replay_attempts > 0:
        return ProcessorReplayStatus.IN_PROGRESS
    if event.replay_requested:
        return ProcessorReplayStatus.QUEUED
    return ProcessorReplayStatus.PENDING


def _apply_status_filter(stmt, status: ProcessorReplayStatus | None):
    """Apply status-specific conditions to the event query."""

    if status is None:
        return stmt

    if status is ProcessorReplayStatus.PENDING:
        return stmt.where(ProcessorEvent.replay_requested.is_(False))
    if status is ProcessorReplayStatus.QUEUED:
        return stmt.where(
            ProcessorEvent.replay_requested.is_(True),
            ProcessorEvent.replay_attempts == 0,
        )
    if status is ProcessorReplayStatus.IN_PROGRESS:
        return stmt.where(
            ProcessorEvent.replay_requested.is_(True),
            ProcessorEvent.replay_attempts > 0,
            ProcessorEvent.replayed_at.is_(None),
            ProcessorEvent.last_replay_error.is_(None),
        )
    if status is ProcessorReplayStatus.SUCCEEDED:
        return stmt.where(ProcessorEvent.replayed_at.is_not(None))
    if status is ProcessorReplayStatus.FAILED:
        return stmt.where(ProcessorEvent.last_replay_error.is_not(None))
    return stmt


def _build_event_query(
    *,
    limit: int,
    provider: WebhookProviderEnum | None,
    requested_only: bool | None,
    workspace_id: UUID | None,
    since: datetime | None,
    status: ProcessorReplayStatus | None,
    correlation_filter: str | None,
):
    """Construct the SQL statement for replay event retrieval."""

    stmt = select(ProcessorEvent).order_by(ProcessorEvent.received_at.desc()).limit(limit)
    if provider is not None:
        stmt = stmt.where(ProcessorEvent.provider == provider)
    if requested_only:
        stmt = stmt.where(ProcessorEvent.replay_requested.is_(True))
    if workspace_id is not None:
        stmt = stmt.where(ProcessorEvent.workspace_id == workspace_id)
    if since is not None:
        stmt = stmt.where(ProcessorEvent.received_at > since)
    if correlation_filter:
        normalized = correlation_filter.strip().lower()
        if normalized:
            like_term = f"%{normalized}%"
            stmt = stmt.where(
                or_(
                    func.lower(ProcessorEvent.correlation_id).like(like_term),
                    func.lower(cast(ProcessorEvent.invoice_id, String)).like(like_term),
                )
            )
    stmt = _apply_status_filter(stmt, status)
    return stmt


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
            "status": _derive_status(event),
        }
    )


def _dump_event(event: ProcessorEvent) -> dict[str, Any]:
    """Return a JSON-ready dictionary for the processor event."""

    return _serialize_event(event).model_dump(mode="json")


@router.get("/", response_model=list[ProcessorEventResponse])
async def list_processor_events(
    *,
    session: AsyncSession = Depends(get_session),
    provider: WebhookProviderEnum | None = Query(default=None),
    requested_only: bool | None = Query(default=True, alias="requestedOnly"),
    limit: int = Query(default=50, ge=1, le=200),
    workspace_id: UUID | None = Query(default=None, alias="workspaceId"),
    since: datetime | None = Query(default=None),
    status: str | None = Query(default=None),
    correlation_id: str | None = Query(default=None, alias="correlationId"),
) -> list[ProcessorEventResponse]:
    """Return ledger entries with optional filtering."""

    status_filter: ProcessorReplayStatus | None = None
    if status and status.lower() != "all":
        try:
            status_filter = ProcessorReplayStatus(status)
        except ValueError as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported status filter") from exc

    stmt = _build_event_query(
        limit=limit,
        provider=provider,
        requested_only=requested_only,
        workspace_id=workspace_id,
        since=since,
        status=status_filter,
        correlation_filter=correlation_id,
    )
    results = await session.execute(stmt)
    events = results.scalars().all()
    return [_serialize_event(event) for event in events]


def _format_sse(event_type: str, payload: dict[str, Any]) -> str:
    """Serialize a payload to an SSE data frame."""

    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


@router.get("/stream")
async def stream_processor_events(
    *,
    provider: WebhookProviderEnum | None = Query(default=None),
    requested_only: bool | None = Query(default=None, alias="requestedOnly"),
    limit: int = Query(default=200, ge=1, le=500),
    workspace_id: UUID | None = Query(default=None, alias="workspaceId"),
    since: datetime | None = Query(default=None),
    status: str | None = Query(default=None),
    correlation_id: str | None = Query(default=None, alias="correlationId"),
    interval_seconds: float = Query(default=5.0, alias="interval", ge=1.0, le=30.0),
):
    """Emit a continuous stream of replay updates."""

    status_filter: ProcessorReplayStatus | None = None
    if status and status.lower() != "all":
        try:
            status_filter = ProcessorReplayStatus(status)
        except ValueError as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported status filter") from exc

    async def event_generator():
        cursor = since
        first_frame = True
        try:
            while True:
                async with async_session() as stream_session:
                    stmt = _build_event_query(
                        limit=limit,
                        provider=provider,
                        requested_only=requested_only,
                        workspace_id=workspace_id,
                        since=cursor,
                        status=status_filter,
                        correlation_filter=correlation_id,
                    )
                    results = await stream_session.execute(stmt)
                    items = results.scalars().all()

                if items:
                    newest = max(item.received_at for item in items if item.received_at is not None)
                    cursor = newest
                    payload = {
                        "cursor": newest.isoformat(),
                        "events": [_dump_event(item) for item in items],
                    }
                    event_type = "snapshot" if first_frame else "update"
                    first_frame = False
                    yield _format_sse(event_type, payload)
                elif first_frame:
                    payload = {
                        "cursor": cursor.isoformat() if isinstance(cursor, datetime) else None,
                        "events": [],
                    }
                    first_frame = False
                    yield _format_sse("snapshot", payload)
                else:
                    payload = {
                        "cursor": cursor.isoformat() if isinstance(cursor, datetime) else None,
                    }
                    yield _format_sse("heartbeat", payload)

                await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:  # pragma: no cover - client disconnected
            return

    headers = {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
    }
    return StreamingResponse(event_generator(), headers=headers, media_type="text/event-stream")


@router.post("/{event_id}/trigger", response_model=ProcessorEventResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_replay(
    *,
    event_id: UUID,
    payload: TriggerReplayRequest = Body(default_factory=TriggerReplayRequest),
    session: AsyncSession = Depends(get_session),
    workspace_id: UUID | None = Query(default=None, alias="workspaceId"),
) -> ProcessorEventResponse:
    """Mark an event for replay and optionally run it immediately."""

    event = await session.get(ProcessorEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if workspace_id is not None and event.workspace_id != workspace_id:
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


def _serialize_attempt(attempt: ProcessorEventReplayAttempt) -> ReplayAttemptResponse:
    return ReplayAttemptResponse.model_validate(
        {
            "id": attempt.id,
            "attemptedAt": attempt.attempted_at,
            "status": attempt.status,
            "error": attempt.error,
            "metadata": attempt.metadata_snapshot,
        }
    )


@router.get("/{event_id}", response_model=ProcessorEventDetailResponse)
async def get_processor_event(
    *,
    event_id: UUID,
    session: AsyncSession = Depends(get_session),
    workspace_id: UUID | None = Query(default=None, alias="workspaceId"),
) -> ProcessorEventDetailResponse:
    """Return detail for a processor event including replay history."""

    event = await session.get(ProcessorEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if workspace_id is not None and event.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    attempts = await fetch_replay_attempts(session, event_id=event_id, limit=50)
    invoice_snapshot: dict[str, Any] | None = None
    if event.invoice_id is not None:
        invoice = await session.get(Invoice, event.invoice_id)
        if invoice is not None:
            invoice_snapshot = {
                "id": str(invoice.id),
                "number": invoice.invoice_number,
                "status": invoice.status.value if hasattr(invoice.status, "value") else invoice.status,
                "total": float(invoice.total),
                "currency": invoice.currency.value if hasattr(invoice.currency, "value") else invoice.currency,
                "issuedAt": invoice.issued_at,
                "dueAt": invoice.due_at,
            }

    serialized_event = _serialize_event(event)
    return ProcessorEventDetailResponse.model_validate(
        {
            **serialized_event.model_dump(mode="json"),
            "attempts": [_serialize_attempt(attempt).model_dump(mode="json") for attempt in attempts],
            "invoiceSnapshot": invoice_snapshot,
        }
    )


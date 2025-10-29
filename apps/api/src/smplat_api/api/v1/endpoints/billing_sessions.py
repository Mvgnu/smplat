"""Hosted checkout session management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.api.v1.endpoints.billing import _ensure_rollout
from smplat_api.db.session import get_session
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice
from smplat_api.services.billing.gateway import BillingGatewayClient
from smplat_api.services.billing.recovery import HostedSessionRecoveryCommunicator

router = APIRouter(
    prefix="/billing/sessions",
    tags=["billing-sessions"],
    dependencies=[Depends(require_checkout_api_key)],
)


class HostedSessionRecoveryAttempt(BaseModel):
    """Automation attempt metadata returned to the dashboard."""

    attempt: int
    status: str
    scheduled_at: str = Field(alias="scheduledAt")
    next_retry_at: str | None = Field(default=None, alias="nextRetryAt")
    notified_at: str | None = Field(default=None, alias="notifiedAt")

    model_config = {"populate_by_name": True}


class HostedSessionRecoveryState(BaseModel):
    """Aggregate recovery signals for hosted sessions."""

    attempts: list[HostedSessionRecoveryAttempt] = Field(default_factory=list)
    next_retry_at: str | None = Field(default=None, alias="nextRetryAt")
    last_notified_at: str | None = Field(default=None, alias="lastNotifiedAt")
    last_channel: str | None = Field(default=None, alias="lastChannel")

    model_config = {"populate_by_name": True}


class HostedSessionResponse(BaseModel):
    """Serialized hosted checkout session representation."""

    id: str
    session_id: str = Field(alias="sessionId")
    invoice_id: str = Field(alias="invoiceId")
    workspace_id: str = Field(alias="workspaceId")
    status: str
    status_changed_at: str | None = Field(default=None, alias="statusChangedAt")
    expires_at: str | None = Field(default=None, alias="expiresAt")
    completed_at: str | None = Field(default=None, alias="completedAt")
    cancelled_at: str | None = Field(default=None, alias="cancelledAt")
    retry_count: int = Field(alias="retryCount")
    last_retry_at: str | None = Field(default=None, alias="lastRetryAt")
    next_retry_at: str | None = Field(default=None, alias="nextRetryAt")
    last_error: str | None = Field(default=None, alias="lastError")
    recovery_notes: str | None = Field(default=None, alias="recoveryNotes")
    metadata: dict[str, Any] | None = None
    recovery_state: HostedSessionRecoveryState | None = Field(
        default=None, alias="recoveryState"
    )
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class HostedSessionListResponse(BaseModel):
    """List response for hosted checkout sessions."""

    sessions: list[HostedSessionResponse]


class RegenerateSessionRequest(BaseModel):
    """Payload to regenerate a hosted checkout session."""

    expected_updated_at: str = Field(..., alias="expectedUpdatedAt")
    success_url: str | None = Field(default=None, alias="successUrl")
    cancel_url: str | None = Field(default=None, alias="cancelUrl")
    notes: str | None = Field(
        default=None,
        description="Optional operator note captured on the regenerated session.",
    )
    automated: bool = Field(
        default=False,
        description="Flag indicating automation triggered the regeneration.",
    )
    override_next_retry_at: str | None = Field(
        default=None,
        alias="overrideNextRetryAt",
        description="Optional ISO timestamp to override the next retry window.",
    )
    notify: bool = Field(
        default=True,
        description="Whether automation should emit recovery communications.",
    )

    model_config = {"populate_by_name": True}


@router.get("", response_model=HostedSessionListResponse)
async def list_hosted_sessions(
    workspace_id: UUID = Query(..., alias="workspaceId"),
    invoice_id: UUID | None = Query(None, alias="invoiceId"),
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_session),
) -> HostedSessionListResponse:
    """Return hosted checkout sessions scoped to a workspace."""

    _ensure_rollout(workspace_id)
    stmt = (
        select(HostedCheckoutSession)
        .where(HostedCheckoutSession.workspace_id == workspace_id)
        .order_by(HostedCheckoutSession.created_at.desc())
        .limit(limit)
        .options(selectinload(HostedCheckoutSession.invoice))
    )
    if invoice_id:
        stmt = stmt.where(HostedCheckoutSession.invoice_id == invoice_id)
    if status_filter:
        try:
            status_value = HostedCheckoutSessionStatusEnum(status_filter.lower())
        except ValueError as exc:  # pragma: no cover - defensive guard
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported hosted session status filter",
            ) from exc
        stmt = stmt.where(HostedCheckoutSession.status == status_value)

    result = await db.execute(stmt)
    sessions = result.scalars().all()
    payload = [
        _serialize_hosted_session(row)
        for row in sessions
    ]
    return HostedSessionListResponse(sessions=payload)


@router.get("/{session_id}", response_model=HostedSessionResponse)
async def get_hosted_session(
    session_id: UUID,
    workspace_id: UUID = Query(..., alias="workspaceId"),
    db: AsyncSession = Depends(get_session),
) -> HostedSessionResponse:
    """Retrieve a specific hosted checkout session."""

    _ensure_rollout(workspace_id)
    session = await db.get(HostedCheckoutSession, session_id)
    if session is None or session.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    await db.refresh(session, attribute_names=["invoice"])
    return _serialize_hosted_session(session)


@router.post("/{session_id}/regenerate", response_model=HostedSessionResponse)
async def regenerate_hosted_session(
    session_id: UUID,
    payload: RegenerateSessionRequest = Body(...),
    workspace_id: UUID = Query(..., alias="workspaceId"),
    db: AsyncSession = Depends(get_session),
) -> HostedSessionResponse:
    """Regenerate a hosted checkout session for continued recovery attempts."""

    _ensure_rollout(workspace_id)
    session = await db.get(HostedCheckoutSession, session_id)
    if session is None or session.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    await db.refresh(session, attribute_names=["invoice"])
    if session.status == HostedCheckoutSessionStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot regenerate a completed session",
        )

    actual_updated_at = _isoformat(session.updated_at)
    if actual_updated_at is None or actual_updated_at != payload.expected_updated_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Hosted session has been modified, refresh state before retrying",
        )

    invoice = session.invoice or await db.get(Invoice, session.invoice_id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice missing")

    success_url = payload.success_url or (session.metadata_json or {}).get("success_url")
    cancel_url = payload.cancel_url or (session.metadata_json or {}).get("cancel_url")
    if not success_url or not cancel_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Success and cancel URLs are required for regeneration",
        )

    override_next_retry_at = None
    if payload.override_next_retry_at:
        try:
            override_next_retry_at = datetime.fromisoformat(payload.override_next_retry_at)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid overrideNextRetryAt timestamp",
            ) from exc
        if override_next_retry_at.tzinfo is None:
            override_next_retry_at = override_next_retry_at.replace(tzinfo=timezone.utc)
        else:
            override_next_retry_at = override_next_retry_at.astimezone(timezone.utc)

    gateway = BillingGatewayClient(db, workspace_id)
    await gateway.create_hosted_session(
        invoice,
        success_url=success_url,
        cancel_url=cancel_url,
        regenerate_from=session,
        recovery_note=payload.notes,
    )
    await db.flush()
    await db.refresh(invoice, attribute_names=["hosted_session", "hosted_sessions"])
    latest_session = invoice.hosted_session
    if latest_session is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to materialize regenerated hosted session",
        )

    if override_next_retry_at is not None:
        latest_session.next_retry_at = override_next_retry_at
        metadata = dict(latest_session.metadata_json or {})
        automation_meta = dict(metadata.get("automation", {}))
        automation_meta["override_next_retry_at"] = override_next_retry_at.isoformat()
        metadata["automation"] = automation_meta
        latest_session.metadata_json = metadata

    trigger_meta = dict((latest_session.metadata_json or {}).get("automation", {}))
    trigger_meta.update(
        {
            "triggered_by": "automation" if payload.automated else "manual",
            "trigger_notified": payload.notify,
            "triggered_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    metadata = dict(latest_session.metadata_json or {})
    metadata["automation"] = trigger_meta
    latest_session.metadata_json = metadata

    communicator = HostedSessionRecoveryCommunicator()
    if payload.automated and payload.notify:
        attempt = {
            "attempt": latest_session.retry_count or 0,
            "status": latest_session.status.value,
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
            "next_retry_at": _isoformat(latest_session.next_retry_at),
        }
        await communicator.dispatch_notification(latest_session, attempt)
        metadata = dict(latest_session.metadata_json or {})
        metadata["last_notified_at"] = attempt["scheduled_at"]
        latest_session.metadata_json = metadata

    await db.commit()
    await db.refresh(latest_session)
    return _serialize_hosted_session(latest_session)


def _serialize_hosted_session(session: HostedCheckoutSession) -> HostedSessionResponse:
    """Serialize a hosted checkout session for API output."""

    # meta: hosted-session: serializer

    metadata = session.metadata_json or {}
    status_changed_at = session.completed_at or session.cancelled_at
    recovery = _build_recovery_state(session, metadata)
    return HostedSessionResponse(
        id=str(session.id),
        sessionId=session.session_id,
        invoiceId=str(session.invoice_id),
        workspaceId=str(session.workspace_id),
        status=session.status.value,
        statusChangedAt=_isoformat(status_changed_at),
        expiresAt=_isoformat(session.expires_at),
        completedAt=_isoformat(session.completed_at),
        cancelledAt=_isoformat(session.cancelled_at),
        retryCount=session.retry_count or 0,
        lastRetryAt=_isoformat(session.last_retry_at),
        nextRetryAt=_isoformat(session.next_retry_at),
        lastError=session.last_error,
        recoveryNotes=session.recovery_notes,
        metadata=metadata,
        recoveryState=recovery,
        createdAt=_isoformat(session.created_at) or "",
        updatedAt=_isoformat(session.updated_at) or "",
    )


def _build_recovery_state(
    session: HostedCheckoutSession, metadata: dict[str, Any]
) -> HostedSessionRecoveryState | None:
    attempts_raw = list(metadata.get("recovery_attempts", []))
    communication_log = list(metadata.get("communication_log", []))
    if not attempts_raw and not communication_log and not session.next_retry_at:
        return None

    attempts = [
        HostedSessionRecoveryAttempt(
            attempt=int(entry.get("attempt", 0) or 0),
            status=str(entry.get("status", "unknown")),
            scheduledAt=str(entry.get("scheduled_at") or entry.get("scheduledAt") or ""),
            nextRetryAt=(
                str(entry.get("next_retry_at") or entry.get("nextRetryAt"))
                if entry.get("next_retry_at") or entry.get("nextRetryAt")
                else None
            ),
            notifiedAt=(
                str(entry.get("notified_at") or entry.get("notifiedAt"))
                if entry.get("notified_at") or entry.get("notifiedAt")
                else None
            ),
        )
        for entry in attempts_raw
    ]

    last_comm = communication_log[-1] if communication_log else None
    return HostedSessionRecoveryState(
        attempts=attempts,
        nextRetryAt=metadata.get("next_retry_at") or _isoformat(session.next_retry_at),
        lastNotifiedAt=metadata.get("last_notified_at"),
        lastChannel=str(last_comm.get("channel")) if last_comm else None,
    )


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()

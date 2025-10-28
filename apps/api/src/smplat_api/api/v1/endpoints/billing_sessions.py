"""Hosted checkout session management endpoints."""

from __future__ import annotations

from datetime import datetime
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

router = APIRouter(
    prefix="/billing/sessions",
    tags=["billing-sessions"],
    dependencies=[Depends(require_checkout_api_key)],
)


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
    await db.commit()
    await db.refresh(latest_session, attribute_names=["invoice"])
    return _serialize_hosted_session(latest_session)


def _serialize_hosted_session(session: HostedCheckoutSession) -> HostedSessionResponse:
    """Serialize a hosted checkout session for API output."""

    # meta: hosted-session: serializer

    metadata = session.metadata_json or {}
    status_changed_at = session.completed_at or session.cancelled_at
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
        createdAt=_isoformat(session.created_at),
        updatedAt=_isoformat(session.updated_at),
    )


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()

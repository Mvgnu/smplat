from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import get_session
from smplat_api.models.access_event import AccessEvent

router = APIRouter(prefix="/security", tags=["Security"])


class AccessEventCreateRequest(BaseModel):
    route: str
    method: str | None = None
    required_tier: str
    decision: str
    reason: str | None = None
    subject_email: str | None = None
    user_id: UUID | None = None
    service_account_id: UUID | None = None
    metadata: dict[str, Any] | None = None

    def normalized_decision(self) -> str:
        value = (self.decision or "").strip().lower()
        if value not in {"allowed", "denied", "redirected", "rate_limited"}:
            raise ValueError("Unsupported decision value")
        return value


class AccessEventResponse(BaseModel):
    id: UUID
    route: str
    method: str | None
    required_tier: str
    decision: str
    reason: str | None
    subject_email: str | None
    user_id: UUID | None
    service_account_id: UUID | None
    metadata: dict[str, Any] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccessEventMetricsResponse(BaseModel):
    window_start: datetime
    window_hours: int
    total: int
    allowed: int
    denied: int
    redirected: int
    rate_limited: int
    unique_subjects: int
    admin_denials: int


def _serialize_event(event: AccessEvent) -> AccessEventResponse:
    return AccessEventResponse(
        id=event.id,
        route=event.route,
        method=event.method,
        required_tier=event.required_tier,
        decision=event.decision,
        reason=event.reason,
        subject_email=event.subject_email,
        user_id=event.user_id,
        service_account_id=event.service_account_id,
        metadata=event.event_metadata or None,
        created_at=event.created_at,
    )


@router.post(
    "/access-events",
    response_model=AccessEventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def record_access_event(
    payload: AccessEventCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> AccessEventResponse:
    decision = payload.normalized_decision()
    event = AccessEvent(
        route=payload.route,
        method=payload.method,
        required_tier=(payload.required_tier or "member").lower(),
        decision=decision,
        reason=payload.reason,
        subject_email=payload.subject_email.lower() if payload.subject_email else None,
        user_id=payload.user_id,
        service_account_id=payload.service_account_id,
        event_metadata=payload.metadata or None,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return _serialize_event(event)


@router.get(
    "/access-events",
    response_model=list[AccessEventResponse],
    status_code=status.HTTP_200_OK,
)
async def list_access_events(
    limit: int = Query(50, ge=1, le=200),
    decisions: list[str] | None = Query(default=None),
    since: datetime | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[AccessEventResponse]:
    stmt = select(AccessEvent).order_by(AccessEvent.created_at.desc()).limit(limit)

    if since is not None:
        stmt = stmt.where(AccessEvent.created_at >= since)

    if decisions:
        normalized = {value.strip().lower() for value in decisions if value}
        if normalized:
            stmt = stmt.where(AccessEvent.decision.in_(normalized))

    result = await session.execute(stmt)
    events = result.scalars().all()
    return [_serialize_event(event) for event in events]


@router.get(
    "/access-events/metrics",
    response_model=AccessEventMetricsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_access_event_metrics(
    window_hours: int = Query(24, ge=1, le=168),
    session: AsyncSession = Depends(get_session),
) -> AccessEventMetricsResponse:
    window_start = datetime.now(timezone.utc) - timedelta(hours=window_hours)

    base_query = select(AccessEvent).where(AccessEvent.created_at >= window_start)

    count_query = (
        select(AccessEvent.decision, func.count())
        .where(AccessEvent.created_at >= window_start)
        .group_by(AccessEvent.decision)
    )
    counts = await session.execute(count_query)

    decision_counts = {row[0]: row[1] for row in counts}

    unique_subjects_query = (
        select(func.count(func.distinct(AccessEvent.subject_email)))
        .where(AccessEvent.created_at >= window_start, AccessEvent.subject_email.is_not(None))
    )
    unique_subjects = (await session.execute(unique_subjects_query)).scalar_one()

    admin_denials_query = (
        select(func.count())
        .where(
            AccessEvent.created_at >= window_start,
            AccessEvent.required_tier == "admin",
            AccessEvent.decision == "denied",
        )
    )
    admin_denials = (await session.execute(admin_denials_query)).scalar_one()

    total_query = select(func.count()).where(AccessEvent.created_at >= window_start)
    total = (await session.execute(total_query)).scalar_one()

    return AccessEventMetricsResponse(
        window_start=window_start,
        window_hours=window_hours,
        total=total,
        allowed=decision_counts.get("allowed", 0),
        denied=decision_counts.get("denied", 0),
        redirected=decision_counts.get("redirected", 0),
        rate_limited=decision_counts.get("rate_limited", 0),
        unique_subjects=unique_subjects,
        admin_denials=admin_denials,
    )

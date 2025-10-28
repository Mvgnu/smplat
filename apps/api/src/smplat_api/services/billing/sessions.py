"""Hosted checkout session lifecycle orchestration utilities."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


async def sweep_hosted_sessions(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    limit: int = 200,
) -> dict[str, int]:
    """Sweep hosted checkout sessions to expire or abandon stale attempts."""

    # meta: hosted-session: sweeper

    current_time = now or datetime.now(timezone.utc)
    expired = await _expire_lapsed_sessions(db, current_time=current_time, limit=limit)
    abandoned = await _abandon_settled_sessions(
        db, current_time=current_time, limit=max(0, limit - expired)
    )
    return {"expired": expired, "abandoned": abandoned}


async def _expire_lapsed_sessions(
    db: AsyncSession,
    *,
    current_time: datetime,
    limit: int,
) -> int:
    """Mark initiated sessions as expired when their expiry timestamp has passed."""

    stmt = (
        select(HostedCheckoutSession)
        .where(
            and_(
                HostedCheckoutSession.status == HostedCheckoutSessionStatusEnum.INITIATED,
                HostedCheckoutSession.expires_at.isnot(None),
                HostedCheckoutSession.expires_at < current_time,
            )
        )
        .order_by(HostedCheckoutSession.expires_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return 0

    for session in sessions:
        session.status = HostedCheckoutSessionStatusEnum.EXPIRED
        session.cancelled_at = current_time
        session.last_error = session.last_error or "expired_without_completion"
        metadata = dict(session.metadata_json or {})
        metadata["last_webhook_event"] = metadata.get(
            "last_webhook_event", "scheduler.expired"
        )
        metadata["expired_by_scheduler_at"] = current_time.isoformat()
        session.metadata_json = metadata

    await db.flush()
    return len(sessions)


async def _abandon_settled_sessions(
    db: AsyncSession,
    *,
    current_time: datetime,
    limit: int,
) -> int:
    """Mark sessions as abandoned when the invoice settled outside the session."""

    if limit <= 0:
        return 0

    stmt = (
        select(HostedCheckoutSession)
        .join(Invoice, HostedCheckoutSession.invoice_id == Invoice.id)
        .where(
            HostedCheckoutSession.status.in_(
                [
                    HostedCheckoutSessionStatusEnum.INITIATED,
                    HostedCheckoutSessionStatusEnum.FAILED,
                ]
            ),
            Invoice.status == InvoiceStatusEnum.PAID,
        )
        .order_by(HostedCheckoutSession.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return 0

    for session in sessions:
        settled_at = session.invoice.paid_at or current_time
        session.status = HostedCheckoutSessionStatusEnum.ABANDONED
        session.cancelled_at = settled_at
        session.last_error = session.last_error or "invoice_settled_externally"
        metadata = dict(session.metadata_json or {})
        metadata["abandoned_by_scheduler_at"] = current_time.isoformat()
        metadata["last_webhook_event"] = metadata.get(
            "last_webhook_event", "scheduler.abandoned"
        )
        session.metadata_json = metadata

    await db.flush()
    return len(sessions)

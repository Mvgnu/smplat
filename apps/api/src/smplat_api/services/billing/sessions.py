"""Hosted checkout session lifecycle orchestration utilities."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Sequence

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.recovery import (
    HostedSessionRecoveryCommunicator,
    RecoveryNotificationResult,
)


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


# meta: hosted-session: recovery-scheduler
async def schedule_hosted_session_recovery(
    db: AsyncSession,
    communicator: HostedSessionRecoveryCommunicator | None,
    *,
    now: datetime | None = None,
    statuses: Sequence[HostedCheckoutSessionStatusEnum] | None = None,
    limit: int = 100,
    max_attempts: int = 5,
) -> dict[str, int]:
    """Select stalled sessions for automated recovery and queue notifications."""

    current_time = now or datetime.now(timezone.utc)
    eligible_statuses: Iterable[HostedCheckoutSessionStatusEnum] = (
        statuses
        if statuses is not None
        else (
            HostedCheckoutSessionStatusEnum.INITIATED,
            HostedCheckoutSessionStatusEnum.FAILED,
            HostedCheckoutSessionStatusEnum.EXPIRED,
        )
    )

    stmt = (
        select(HostedCheckoutSession)
        .where(
            and_(
                HostedCheckoutSession.status.in_(tuple(eligible_statuses)),
                HostedCheckoutSession.next_retry_at.isnot(None),
                HostedCheckoutSession.next_retry_at <= current_time,
                HostedCheckoutSession.retry_count < max_attempts,
            )
        )
        .order_by(
            HostedCheckoutSession.next_retry_at.asc(),
            HostedCheckoutSession.created_at.asc(),
        )
        .limit(limit)
        .with_for_update(skip_locked=True)
    )

    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return {"scheduled": 0, "notified": 0}

    notifications = 0
    for session in sessions:
        prior_attempts = list((session.metadata_json or {}).get("recovery_attempts", []))
        retry_count = (session.retry_count or 0) + 1
        session.retry_count = retry_count
        session.last_retry_at = current_time

        delay_minutes = min(240, 10 * (2 ** max(0, retry_count - 1)))
        session.next_retry_at = current_time + timedelta(minutes=delay_minutes)

        attempt_record = {
            "attempt": retry_count,
            "status": session.status.value,
            "scheduled_at": current_time.isoformat(),
            "next_retry_at": session.next_retry_at.isoformat(),
        }

        metadata = dict(session.metadata_json or {})
        attempts = list(metadata.get("recovery_attempts", []))
        attempts.append(attempt_record)
        metadata["recovery_attempts"] = attempts[-25:]

        automation_meta = dict(metadata.get("automation", {}))
        automation_meta.update(
            {
                "scheduler_version": "auto-recovery/v1",
                "next_retry_at": session.next_retry_at.isoformat(),
                "last_attempt": attempt_record,
            }
        )
        metadata["automation"] = automation_meta
        session.metadata_json = metadata

        if communicator is not None:
            should_notify = communicator.should_notify(
                session, prior_attempts=prior_attempts, current_attempt=attempt_record
            )
            if should_notify:
                result = await communicator.dispatch_notification(
                    session, attempt_record
                )
                provider = "unknown"
                delivered = False
                if isinstance(result, RecoveryNotificationResult):
                    provider = result.provider
                    delivered = result.delivered
                elif isinstance(result, dict):
                    provider = str(result.get("provider", provider))
                    delivered = bool(result.get("delivered", delivered))
                elif isinstance(result, str):
                    provider = result
                elif isinstance(result, bool):
                    delivered = result

                if delivered:
                    notifications += 1

                metadata = dict(session.metadata_json or {})
                metadata["last_notified_at"] = current_time.isoformat()
                automation_meta = dict(metadata.get("automation", {}))
                latest_attempt = dict(automation_meta.get("last_attempt", attempt_record))
                latest_attempt["notified_at"] = current_time.isoformat()
                latest_attempt["provider"] = provider
                automation_meta["last_attempt"] = latest_attempt
                metadata["automation"] = automation_meta
                attempt_record["provider"] = provider
                attempts_snapshot = list(metadata.get("recovery_attempts", []))
                metadata["recovery_attempts"] = attempts_snapshot[-25:] if attempts_snapshot else []
                session.metadata_json = metadata

    await db.flush()
    return {"scheduled": len(sessions), "notified": notifications}


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

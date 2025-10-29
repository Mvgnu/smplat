"""Jobs that refresh loyalty nudges and fan out notifications."""

# meta: job: loyalty-nudges

from __future__ import annotations

import datetime as dt
from typing import Any, Awaitable, Callable, Dict
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.loyalty import LoyaltyMember, LoyaltyNudge
from smplat_api.services.loyalty import LoyaltyService
from smplat_api.services.notifications import NotificationService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def aggregate_loyalty_nudges(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Synchronize loyalty nudges and optionally dispatch notifications."""

    maybe_session = session_factory()
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        notifications = NotificationService(managed_session)
        service = LoyaltyService(
            managed_session, notification_service=notifications
        )
        now = dt.datetime.now(dt.timezone.utc)

        aggregated = await service.aggregate_nudge_candidates(now=now)
        members_refreshed = len(aggregated)
        nudges_refreshed = sum(len(cards) for cards in aggregated.values())

        await managed_session.commit()

        dispatch_batch = await service.collect_nudge_dispatch_batch(now=now)
        events_before = len(notifications.sent_events)
        await _dispatch_notifications(
            notifications,
            dispatch_batch,
            session=managed_session,
        )
        events_after = len(notifications.sent_events)
        notifications_sent = max(events_after - events_before, 0)

        if dispatch_batch:
            await service.mark_nudges_triggered(dispatch_batch, now=now)
            await managed_session.commit()

        summary = {
            "members_refreshed": members_refreshed,
            "nudges_refreshed": nudges_refreshed,
            "dispatch_attempts": len(dispatch_batch),
            "notifications_sent": notifications_sent,
        }
        logger.bind(summary=summary).info("Loyalty nudge aggregation completed")
        return summary


async def _dispatch_notifications(
    notifications: NotificationService,
    nudges: list[LoyaltyNudge],
    *,
    session: AsyncSession,
) -> None:
    """Send loyalty nudges to members while reusing session context."""

    member_cache: dict[UUID, LoyaltyMember] = {}
    for nudge in nudges:
        member = nudge.member
        if member is None:
            cached = member_cache.get(nudge.member_id)
            if cached is None:
                cached = await session.get(LoyaltyMember, nudge.member_id)
                if cached is None:
                    logger.warning(
                        "Skipping loyalty nudge dispatch for missing member",
                        nudge_id=str(nudge.id),
                        member_id=str(nudge.member_id),
                    )
                    continue
                member_cache[nudge.member_id] = cached
            member = cached
        await notifications.send_loyalty_nudge(member, nudge)


__all__ = ["aggregate_loyalty_nudges"]

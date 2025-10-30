"""Job to dispatch loyalty nudges with multi-channel fallback."""

from __future__ import annotations

import datetime as dt
from typing import Any, Awaitable, Callable, Dict, List
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.loyalty import LoyaltyMember, LoyaltyNudge, LoyaltyNudgeChannel
from smplat_api.observability.loyalty import get_loyalty_store
from smplat_api.services.loyalty import LoyaltyService, LoyaltyNudgeDispatchCandidate
from smplat_api.services.notifications import NotificationService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def dispatch_loyalty_nudges(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Dispatch queued loyalty nudges honoring fallback escalation."""

    maybe_session = session_factory()
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        notifications = NotificationService(managed_session)
        service = LoyaltyService(managed_session, notification_service=notifications)
        now = dt.datetime.now(dt.timezone.utc)

        batch = await service.collect_nudge_dispatch_batch(now=now)
        attempts = len(batch)
        if attempts == 0:
            logger.info("No loyalty nudges ready for dispatch")
            return {
                "dispatch_attempts": 0,
                "notifications_sent": 0,
                "fallback_dispatches": 0,
            }

        observability = get_loyalty_store()
        dispatched: List[LoyaltyNudgeDispatchCandidate] = []
        deliveries = 0
        fallback_deliveries = 0
        member_cache: dict[UUID, LoyaltyMember] = {}

        for candidate in batch:
            nudge = candidate.nudge
            member = nudge.member
            if member is None:
                cached = member_cache.get(nudge.member_id)
                if cached is None:
                    cached = await managed_session.get(LoyaltyMember, nudge.member_id)
                    if cached is None:
                        logger.warning(
                            "Skipping loyalty nudge dispatch for missing member",
                            nudge_id=str(nudge.id),
                            member_id=str(nudge.member_id),
                        )
                        continue
                    member_cache[nudge.member_id] = cached
                member = cached

            channel_used, used_fallback = await _dispatch_with_fallback(
                notifications,
                member,
                nudge,
                candidate.channels,
            )

            if channel_used is None:
                continue

            deliveries += 1
            if used_fallback:
                fallback_deliveries += 1

            dispatched.append(
                LoyaltyNudgeDispatchCandidate(nudge=nudge, channels=[channel_used])
            )
            observability.record_nudge_dispatch(
                nudge.nudge_type.value,
                [channel_used.value],
            )

        if dispatched:
            await service.mark_nudges_triggered(dispatched, now=now)
            await managed_session.commit()
        else:
            await managed_session.rollback()

        summary = {
            "dispatch_attempts": attempts,
            "notifications_sent": deliveries,
            "fallback_dispatches": fallback_deliveries,
        }
        logger.bind(summary=summary).info("Loyalty nudge dispatch completed")
        return summary


async def _dispatch_with_fallback(
    notifications: NotificationService,
    member: LoyaltyMember,
    nudge: LoyaltyNudge,
    plan: list[LoyaltyNudgeChannel],
) -> tuple[LoyaltyNudgeChannel | None, bool]:
    """Attempt delivery across channels returning the successful channel."""

    if not plan:
        plan = [LoyaltyNudgeChannel.EMAIL]

    for index, channel in enumerate(plan):
        before = len(notifications.sent_events)
        try:
            await notifications.send_loyalty_nudge(member, nudge, channels=[channel])
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.exception(
                "Loyalty nudge dispatch failed", nudge_id=str(nudge.id), channel=channel.value, error=str(exc)
            )
            continue

        delivered_events = [
            event
            for event in notifications.sent_events[before:]
            if event.metadata.get("nudge_id") == str(nudge.id)
            and event.channel == channel.value
        ]
        if delivered_events:
            return channel, index > 0

    return None, False


__all__ = ["dispatch_loyalty_nudges"]

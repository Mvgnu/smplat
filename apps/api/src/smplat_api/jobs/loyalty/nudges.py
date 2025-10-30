"""Jobs that refresh loyalty nudges and fan out notifications."""

# meta: job: loyalty-nudges

from __future__ import annotations

import datetime as dt
from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.services.loyalty import LoyaltyService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def aggregate_loyalty_nudges(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Synchronize loyalty nudges and surface refreshed counts."""

    maybe_session = session_factory()
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        service = LoyaltyService(managed_session)
        now = dt.datetime.now(dt.timezone.utc)

        aggregated = await service.aggregate_nudge_candidates(now=now)
        members_refreshed = len(aggregated)
        nudges_refreshed = sum(len(cards) for cards in aggregated.values())

        await managed_session.commit()

        summary = {
            "members_refreshed": members_refreshed,
            "nudges_refreshed": nudges_refreshed,
            "pending_dispatch": sum(
                len(cards) for cards in aggregated.values()
            ),
        }
        logger.bind(summary=summary).info("Loyalty nudge aggregation completed")
        return summary


__all__ = ["aggregate_loyalty_nudges"]

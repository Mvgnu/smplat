"""Nightly loyalty analytics snapshot job."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.services.loyalty import LoyaltyAnalyticsService


# meta: job: loyalty-analytics-snapshot

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def capture_loyalty_analytics_snapshot(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Persist a loyalty analytics snapshot for trend monitoring."""

    maybe_session = session_factory()
    session = maybe_session if isinstance(maybe_session, AsyncSession) else await maybe_session

    async with session as managed_session:
        service = LoyaltyAnalyticsService(managed_session)
        record = await service.persist_snapshot()
        await managed_session.commit()

        summary = {
            "snapshot_id": str(record.id),
            "computed_at": record.computed_at.isoformat(),
            "segment_count": len(record.segments_json or []),
        }
        logger.bind(snapshot=summary).info("Loyalty analytics snapshot captured")
        return summary


__all__ = ["capture_loyalty_analytics_snapshot"]


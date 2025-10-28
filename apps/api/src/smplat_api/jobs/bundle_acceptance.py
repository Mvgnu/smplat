"""Bundle acceptance aggregation job."""

from __future__ import annotations

import datetime as dt
from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.services.orders.acceptance import BundleAcceptanceAggregator

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def run_aggregation(*, session_factory: SessionFactory, lookback_days: int = 30) -> Dict[str, Any]:
    """Compute acceptance metrics and persist experiment telemetry."""

    if not settings.bundle_acceptance_aggregation_enabled:
        logger.info(
            "Bundle acceptance aggregation skipped",
            reason="bundle_acceptance_aggregation_enabled is false",
        )
        return {"processed": 0, "skipped": True}

    maybe_session = session_factory()
    session: AsyncSession
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        aggregator = BundleAcceptanceAggregator(managed_session)
        start_time = dt.datetime.now(dt.timezone.utc)
        await aggregator.recompute(lookback_days=lookback_days)
        await managed_session.commit()
        duration = (dt.datetime.now(dt.timezone.utc) - start_time).total_seconds()
        summary = {"processed": 1, "lookback_days": lookback_days, "duration_seconds": duration}
        logger.bind(summary=summary).info("Bundle acceptance aggregation completed")
        return summary


__all__ = ["run_aggregation"]

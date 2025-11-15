"""Job entrypoint for preset analytics metric backfills."""

from __future__ import annotations

from datetime import date
from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import async_session
from smplat_api.services.analytics.preset_event_metrics import PresetEventMetricBackfillJob

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def run_metric_backfill(
    *,
    session_factory: SessionFactory | None = None,
    job: PresetEventMetricBackfillJob | None = None,
    end_date: date | None = None,
) -> Dict[str, Any]:
    """Run the preset metric backfill for the configured window."""

    local_job = job
    if local_job is None:
        factory = session_factory or async_session
        local_job = PresetEventMetricBackfillJob(factory)

    summary = await local_job.run_once(end_date=end_date)
    logger.bind(summary=summary).info("Preset metric backfill completed")
    return summary


__all__ = ["run_metric_backfill"]

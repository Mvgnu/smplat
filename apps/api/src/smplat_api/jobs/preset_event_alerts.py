"""Job entry point for preset analytics alert runs."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import async_session
from smplat_api.services.analytics.preset_event_alerts import PresetEventAlertJob

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def run_preset_alerts(
    *,
    session_factory: SessionFactory | None = None,
    job: PresetEventAlertJob | None = None,
) -> Dict[str, Any]:
    """Execute a preset alert evaluation cycle."""

    local_job = job
    if local_job is None:
        factory = session_factory or async_session
        local_job = PresetEventAlertJob(factory)

    summary = await local_job.run_once()
    logger.bind(summary=summary).info("Preset analytics alert run completed")
    return summary


__all__ = ["run_preset_alerts"]

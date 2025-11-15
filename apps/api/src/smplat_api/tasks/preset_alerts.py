"""CLI entry points for preset analytics alert evaluations."""

from __future__ import annotations

import argparse
import asyncio
from typing import Any

from loguru import logger

from smplat_api.db.session import async_session
from smplat_api.services.analytics.preset_event_alerts import PresetEventAlertJob


async def run_preset_alerts(*, job: PresetEventAlertJob | None = None) -> dict[str, Any]:
    """Execute one preset alert evaluation iteration."""

    local_job = job or PresetEventAlertJob(async_session)
    summary = await local_job.run_once()
    logger.info("Preset analytics alerts evaluated", summary=summary)
    return summary


async def _async_main() -> None:
    await run_preset_alerts()


def cli() -> None:
    argparse.ArgumentParser(description="Run a single preset analytics alert evaluation.").parse_args()
    asyncio.run(_async_main())


def run_preset_alerts_sync(*, job: PresetEventAlertJob | None = None) -> dict[str, Any]:
    """Blocking helper for schedulers that cannot await."""

    return asyncio.run(run_preset_alerts(job=job))


__all__ = ["run_preset_alerts", "run_preset_alerts_sync"]

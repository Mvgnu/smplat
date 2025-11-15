"""CLI helpers for preset analytics metric backfills."""

from __future__ import annotations

import argparse
import asyncio
from datetime import date
from typing import Any

from loguru import logger

from smplat_api.db.session import async_session
from smplat_api.services.analytics.preset_event_metrics import PresetEventMetricBackfillJob


async def run_preset_metrics(
    *,
    days: int,
    end_date: date | None = None,
    job: PresetEventMetricBackfillJob | None = None,
) -> dict[str, Any]:
    local_job = job or PresetEventMetricBackfillJob(async_session, window_days=days)
    summary = await local_job.run_once(end_date=end_date)
    logger.info("Preset metric backfill evaluated", summary=summary)
    return summary


def cli() -> None:
    parser = argparse.ArgumentParser(description="Backfill preset daily metrics for a date window.")
    parser.add_argument("--days", type=int, default=90, help="Number of trailing days to ensure (max 365)")
    parser.add_argument(
        "--end",
        dest="end_date",
        type=str,
        default=None,
        help="Optional ISO date (YYYY-MM-DD) for the end of the window; defaults to today",
    )
    args = parser.parse_args()

    end_date = None
    if args.end_date:
        end_date = date.fromisoformat(args.end_date)

    asyncio.run(run_preset_metrics(days=args.days, end_date=end_date))


def run_preset_metrics_sync(
    *,
    days: int,
    end_date: date | None = None,
    job: PresetEventMetricBackfillJob | None = None,
) -> dict[str, Any]:
    return asyncio.run(run_preset_metrics(days=days, end_date=end_date, job=job))


__all__ = ["run_preset_metrics", "run_preset_metrics_sync"]

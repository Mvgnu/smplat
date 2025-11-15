from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from smplat_api.models.analytics import PresetEventDailyMetric
from smplat_api.services.analytics.preset_event_metrics import PresetEventMetricBackfillJob


@pytest.mark.asyncio
async def test_preset_metric_backfill_creates_rows(session_factory):
    job = PresetEventMetricBackfillJob(session_factory, window_days=5)
    end_date = date(2025, 1, 5)

    summary = await job.run_once(end_date=end_date)

    assert summary["processedDays"] == 5
    assert summary["startDate"] == "2025-01-01"
    assert summary["endDate"] == "2025-01-05"

    async with session_factory() as session:
        rows = await session.execute(select(PresetEventDailyMetric))
        metrics = rows.scalars().all()
        assert len(metrics) == 5
        assert metrics[0].metric_date.isoformat() == "2025-01-01"
        assert metrics[0].trend_stats is not None


@pytest.mark.asyncio
async def test_preset_metric_backfill_idempotent(session_factory):
    job = PresetEventMetricBackfillJob(session_factory, window_days=3)
    end_date = date(2025, 2, 3)

    await job.run_once(end_date=end_date)
    summary = await job.run_once(end_date=end_date)

    assert summary["processedDays"] == 3
    async with session_factory() as session:
        rows = await session.execute(select(PresetEventDailyMetric))
        assert len(rows.scalars().all()) == 3

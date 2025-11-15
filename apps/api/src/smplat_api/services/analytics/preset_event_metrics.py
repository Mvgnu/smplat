"""Preset analytics metric backfill helpers."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.services.analytics.preset_events import PresetEventDailyMetricService


SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


class PresetEventMetricBackfillJob:
    """Ensures preset daily metrics for a rolling window are persisted."""

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        window_days: int = 90,
    ) -> None:
        self._session_factory = session_factory
        self._window_days = max(1, min(window_days, 365))

    async def run_once(self, *, end_date: date | None = None) -> dict[str, Any]:
        session = await self._ensure_session()
        async with session as db:
            service = PresetEventDailyMetricService(db)
            today = end_date or date.today()
            start_date = today - timedelta(days=self._window_days - 1)
            metrics = await service.ensure_range(start_date, today)
            await db.commit()
            return {
                "processedDays": len(metrics),
                "startDate": start_date.isoformat(),
                "endDate": today.isoformat(),
            }

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session


__all__ = ["PresetEventMetricBackfillJob"]

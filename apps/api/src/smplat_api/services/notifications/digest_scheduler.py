"""Background scheduler for weekly digest delivery."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from .digest_dispatcher import WeeklyDigestDispatcher
from .service import NotificationService


class WeeklyDigestScheduler:
    """Run weekly digest dispatch on a configurable interval."""

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession],
        *,
        interval_seconds: int,
        dry_run: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self.interval_seconds = interval_seconds
        self.dry_run = dry_run
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        self.is_running = True
        logger.info(
            "Weekly digest scheduler started",
            interval_seconds=self.interval_seconds,
            dry_run=self.dry_run,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        logger.info("Weekly digest scheduler stopped")

    async def dispatch_once(self) -> int:
        async with self._session_factory() as session:  # type: ignore[arg-type]
            notification_service: NotificationService | None = None
            if self.dry_run:
                notification_service = NotificationService(session)
                notification_service.use_in_memory_backend()

            dispatcher = WeeklyDigestDispatcher(
                session,
                notification_service=notification_service,
            )
            return await dispatcher.run()

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.dispatch_once()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Weekly digest dispatch failed", error=str(exc))

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

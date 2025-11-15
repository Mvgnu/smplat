"""In-process worker for journey component runtime execution."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.journey_runtime import JourneyComponentRunStatusEnum
from smplat_api.services.journey_runtime import JourneyRuntimeService
from smplat_api.tasks.journey_runtime import process_journey_run

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


class JourneyRuntimeWorker:
    """Sequentially processes queued journey component runs without Celery."""

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        interval_seconds: int | None = None,
        batch_size: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        self.interval_seconds = interval_seconds or settings.journey_runtime_poll_interval_seconds
        self._batch_size = batch_size or settings.journey_runtime_batch_size
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
            "Journey runtime worker started",
            interval_seconds=self.interval_seconds,
            batch_size=self._batch_size,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        logger.info("Journey runtime worker stopped")

    async def run_once(self) -> dict[str, int]:
        """Process a batch of pending runs immediately."""

        run_ids = await self._collect_run_ids()
        summary = {"processed": 0, "succeeded": 0, "failed": 0}
        if not run_ids:
            return summary
        for run_id in run_ids:
            summary["processed"] += 1
            try:
                result = await process_journey_run(run_id, session_factory=self._session_factory)
            except Exception as exc:  # pragma: no cover - defensive logging
                summary["failed"] += 1
                logger.exception("Journey runtime worker processing failed", run_id=str(run_id), error=str(exc))
                continue
            status_value = str(result.get("status") or "").lower()
            if status_value == JourneyComponentRunStatusEnum.SUCCEEDED.value:
                summary["succeeded"] += 1
            else:
                summary["failed"] += 1
        return summary

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                summary = await self.run_once()
                if summary["processed"]:
                    logger.info("Journey runtime worker iteration", summary=summary)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Journey runtime worker iteration failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

    async def _collect_run_ids(self) -> list[UUID]:
        session = await self._ensure_session()
        async with session as db:
            service = JourneyRuntimeService(db)
            return await service.list_pending_run_ids(limit=self._batch_size)

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session


__all__ = ["JourneyRuntimeWorker"]

"""Scheduler runtime for catalog automation jobs."""

from __future__ import annotations

import asyncio
import inspect
from importlib import import_module
from pathlib import Path
from types import ModuleType
from typing import Any, Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger
from zoneinfo import ZoneInfo

from .config import JobDefinition, ScheduleConfig, load_job_definitions

SessionFactory = Callable[[], Awaitable[Any]] | Callable[[], Any]


class CatalogJobScheduler:
    """Register and run recurring catalog automation jobs."""

    # meta: scheduler: catalog-automation

    def __init__(self, *, session_factory: SessionFactory, config_path: Path) -> None:
        self._session_factory = session_factory
        self._config_path = config_path
        self._config: ScheduleConfig | None = None
        self._scheduler: AsyncIOScheduler | None = None
        self._is_running: bool = False

    @property
    def is_running(self) -> bool:
        return self._is_running

    def start(self) -> None:
        """Start the scheduler with configured jobs."""

        config = load_job_definitions(self._config_path)
        timezone = ZoneInfo(config.timezone)
        scheduler = AsyncIOScheduler(timezone=timezone)

        for job in config.jobs:
            func = self._resolve_callable(job)
            trigger = CronTrigger.from_crontab(job.cron, timezone=timezone)
            scheduler.add_job(self._wrap_callable(func, job), trigger=trigger, id=job.id, replace_existing=True)
            logger.info(
                "Registered catalog automation job",
                job_id=job.id,
                task=job.task,
                cron=job.cron,
            )

        scheduler.start()
        self._config = config
        self._scheduler = scheduler
        self._is_running = True
        logger.info("Catalog job scheduler started", jobs=len(config.jobs))

    async def stop(self) -> None:
        """Stop the scheduler and release resources."""

        if not self._scheduler:
            return
        result = self._scheduler.shutdown(wait=False)
        if inspect.isawaitable(result):
            await result
        self._scheduler = None
        self._is_running = False
        logger.info("Catalog job scheduler stopped")

    def _resolve_callable(self, job: JobDefinition) -> Callable[..., Awaitable[Any]]:
        module_name, _, attr = job.task.rpartition(".")
        if not module_name:
            raise ValueError(f"Invalid task path: {job.task}")
        module: ModuleType = import_module(module_name)
        func = getattr(module, attr, None)
        if func is None:
            raise AttributeError(f"Task {job.task} not found")
        if not asyncio.iscoroutinefunction(func):
            raise TypeError(f"Task {job.task} must be an async function")
        return func

    def _wrap_callable(self, func: Callable[..., Awaitable[Any]], job: JobDefinition) -> Callable[[], Awaitable[Any]]:
        async def _runner() -> Any:
            try:
                await func(session_factory=self._session_factory, **job.kwargs)
            except Exception as exc:  # pragma: no cover - defensive guard
                logger.exception("Scheduled job failed", job_id=job.id, task=job.task, error=str(exc))

        return _runner


__all__ = ["CatalogJobScheduler"]

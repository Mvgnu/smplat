"""Scheduler runtime for catalog automation jobs."""

from __future__ import annotations

import asyncio
import inspect
from importlib import import_module
import random
import time
from pathlib import Path
from types import ModuleType
from typing import Any, Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger
from zoneinfo import ZoneInfo

from .config import JobDefinition, ScheduleConfig, load_job_definitions
from smplat_api.observability.scheduler import get_catalog_scheduler_store

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
        self._observability = get_catalog_scheduler_store()

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
            max_attempts = max(job.max_attempts, 1)
            base_backoff = max(job.base_backoff_seconds, 0.0)
            backoff_multiplier = max(job.backoff_multiplier, 1.0)
            max_backoff_seconds = max(job.max_backoff_seconds, 0.0)
            jitter_seconds = max(job.jitter_seconds, 0.0)

            self._observability.record_dispatch(job.id, job.task)
            started_at = time.perf_counter()

            for attempt in range(1, max_attempts + 1):
                try:
                    await func(session_factory=self._session_factory, **job.kwargs)
                except Exception as exc:  # pragma: no cover - defensive guard
                    error_message = str(exc)
                    self._observability.record_attempt_failure(job.id, job.task, attempts=attempt, error=error_message)
                    if attempt >= max_attempts:
                        runtime_seconds = time.perf_counter() - started_at
                        self._observability.record_run_failure(
                            job.id,
                            job.task,
                            runtime_seconds=runtime_seconds,
                            attempts=attempt,
                            error=error_message,
                        )
                        logger.exception(
                            "Scheduled job failed after retries",
                            job_id=job.id,
                            task=job.task,
                            attempts=attempt,
                            error=error_message,
                        )
                        break

                    delay = base_backoff * (backoff_multiplier ** (attempt - 1))
                    if max_backoff_seconds:
                        delay = min(delay, max_backoff_seconds)
                    if jitter_seconds:
                        delay += random.uniform(0, jitter_seconds)
                    delay = max(delay, 0.0)
                    self._observability.record_retry(job.id, job.task, delay_seconds=delay, attempts=attempt + 1)
                    logger.warning(
                        "Scheduled job retrying",
                        job_id=job.id,
                        task=job.task,
                        attempt=attempt + 1,
                        delay_seconds=delay,
                    )
                    if delay:
                        await asyncio.sleep(delay)
                    continue

                else:
                    runtime_seconds = time.perf_counter() - started_at
                    self._observability.record_success(
                        job.id,
                        job.task,
                        runtime_seconds=runtime_seconds,
                        attempts=attempt,
                    )
                    logger.info(
                        "Scheduled job completed",
                        job_id=job.id,
                        task=job.task,
                        attempts=attempt,
                        runtime_seconds=runtime_seconds,
                    )
                    break

        return _runner

    def health(self) -> dict[str, object]:
        """Return scheduler health metadata suitable for diagnostics."""

        snapshot = self._observability.snapshot()
        config_jobs = self._config.jobs if self._config else []
        job_snapshots = snapshot.jobs
        jobs: list[dict[str, object]] = []

        for job in config_jobs:
            job_metrics = job_snapshots.get(job.id)
            jobs.append(
                {
                    "id": job.id,
                    "task": job.task,
                    "cron": job.cron,
                    "max_attempts": job.max_attempts,
                    "backoff": {
                        "base_seconds": job.base_backoff_seconds,
                        "multiplier": job.backoff_multiplier,
                        "max_seconds": job.max_backoff_seconds,
                        "jitter_seconds": job.jitter_seconds,
                    },
                    "metrics": job_metrics.as_dict() if job_metrics else None,
                }
            )

        return {
            "running": self._is_running,
            "configured_jobs": len(config_jobs),
            "totals": snapshot.totals,
            "jobs": jobs,
        }


__all__ = ["CatalogJobScheduler"]

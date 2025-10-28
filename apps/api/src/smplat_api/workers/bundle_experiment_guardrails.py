"""Worker that enforces bundle experiment guardrails."""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.catalog_experiments import CatalogBundleExperimentStatus
from smplat_api.services.catalog.experiments import CatalogExperimentService
from smplat_api.services.catalog.guardrails import (
    ExperimentGuardrailNotifier,
    build_alerts,
)

SessionFactory = Callable[[], Awaitable[AsyncSession]] | Callable[[], AsyncSession]


class BundleExperimentGuardrailWorker:
    """Evaluate guardrails and pause experiments when thresholds breach."""

    # meta: worker: bundle-experiment-guardrails

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        notifier: ExperimentGuardrailNotifier | None = None,
        interval_seconds: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._notifier = notifier or ExperimentGuardrailNotifier(settings)
        self.interval_seconds = interval_seconds or settings.bundle_experiment_guardrail_interval_seconds
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
            "Bundle experiment guardrail worker started",
            interval_seconds=self.interval_seconds,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        logger.info("Bundle experiment guardrail worker stopped")

    async def run_once(self) -> Dict[str, int]:
        """Evaluate guardrails and trigger notifications for breaches."""

        session = await self._ensure_session()
        paused: list[str] = []
        evaluated = 0
        alerts_accumulator = []

        async with session as managed_session:
            service = CatalogExperimentService(managed_session)
            snapshots = await service.list_experiments()
            running = [s for s in snapshots if s.status == CatalogBundleExperimentStatus.RUNNING]
            evaluated = len(running)

            for snapshot in running:
                payload = await service.evaluate_guardrails(snapshot.slug)
                alerts = build_alerts(payload)
                if not alerts:
                    continue
                logger.warning(
                    "Guardrail breach detected", experiment=snapshot.slug, breaches=len(alerts)
                )
                await service.update_experiment(
                    snapshot.slug,
                    status=CatalogBundleExperimentStatus.PAUSED,
                )
                paused.append(snapshot.slug)
                alerts_accumulator.extend(alerts)

        if alerts_accumulator:
            await self._notifier.notify(alerts_accumulator)
        summary = {"evaluated": evaluated, "paused": len(paused), "alerts": len(alerts_accumulator)}
        logger.bind(summary=summary).info("Guardrail evaluation run complete")
        return summary

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.run_once()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Bundle experiment guardrail evaluation failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session


__all__ = ["BundleExperimentGuardrailWorker"]

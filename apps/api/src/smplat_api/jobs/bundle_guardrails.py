"""Bundle experiment guardrail evaluation job."""

from __future__ import annotations

from typing import Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.workers.bundle_experiment_guardrails import BundleExperimentGuardrailWorker

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def run_guardrail_evaluation(*, session_factory: SessionFactory) -> Dict[str, int | bool]:
    """Evaluate guardrails on a recurring cadence."""

    if not settings.bundle_experiment_guardrail_worker_enabled:
        logger.info(
            "Bundle experiment guardrail evaluation skipped",
            reason="bundle_experiment_guardrail_worker_enabled is false",
        )
        return {"evaluated": 0, "skipped": True}

    worker = BundleExperimentGuardrailWorker(session_factory, interval_seconds=0)
    summary = await worker.run_once()
    logger.bind(summary=summary).info("Bundle experiment guardrail evaluation completed")
    return summary


__all__ = ["run_guardrail_evaluation"]

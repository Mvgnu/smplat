"""Journey runtime execution helpers.

These helpers allow Celery, BullMQ, or CLI runners to execute journey component
runs using the same service layer.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable
from uuid import UUID

from loguru import logger

from smplat_api.db.session import async_session
from smplat_api.models.journey_runtime import JourneyComponentRunStatusEnum
from smplat_api.services.journey_runtime import JourneyRuntimeService
from smplat_api.services.journey_runtime_executor import (
    JourneyRuntimeExecutionResult,
    JourneyRuntimeExecutor,
)

SessionFactory = Callable[[], Any]


def _default_session_factory() -> SessionFactory:
    return async_session()


async def process_journey_run(
    run_id: UUID,
    *,
    session_factory: SessionFactory | None = None,
) -> dict[str, Any]:
    """Execute a journey component run once and return the summary payload."""

    factory = session_factory or _default_session_factory
    async_factory = factory()  # type: ignore[call-arg]
    async with async_factory as session:  # type: ignore[attr-defined]
        service = JourneyRuntimeService(session)
        run = await service.mark_run_started(run_id)
        logger.info(
            "Journey component run started",
            run_id=str(run.id),
            component_id=str(run.component_id),
            attempts=run.attempts,
            product_id=str(run.product_id) if run.product_id else None,
        )
        executor = JourneyRuntimeExecutor()
        run_with_context = await service.get_run_with_context(run_id)
        if not run_with_context:
            raise ValueError("Journey component run not found")
        execution = await executor.execute(run_with_context)
        completed = await _finalize_run(service, run_id, execution, component=run_with_context.component)
        return {
            "runId": str(run_id),
            "status": completed.status.value,
            "attempts": completed.attempts,
            "error": completed.error_message,
        }


def process_journey_run_sync(
    run_id: str | UUID,
    *,
    session_factory: SessionFactory | None = None,
) -> dict[str, Any]:
    """Convenience wrapper so Celery/cron integrations can call the async worker."""

    run_uuid = UUID(str(run_id))
    return asyncio.run(process_journey_run(run_uuid, session_factory=session_factory))


async def _finalize_run(
    service: JourneyRuntimeService,
    run_id: UUID,
    execution: JourneyRuntimeExecutionResult,
    *,
    component: Any,
) -> Any:
    if execution.success:
        completed = await service.mark_run_completed(run_id, result=execution.result, telemetry=execution.telemetry)
        logger.info("Journey component run completed", run_id=str(run_id), status=completed.status.value)
        _log_run_telemetry(run_id, component, execution)
        return completed
    error_message = execution.error or "Journey component script failed"
    completed = await service.mark_run_completed(
        run_id,
        error=error_message,
        status=JourneyComponentRunStatusEnum.FAILED,
        telemetry=execution.telemetry,
    )
    logger.warning(
        "Journey component run failed",
        run_id=str(run_id),
        status=completed.status.value,
        error=error_message,
        attempts=completed.attempts,
    )
    _log_run_telemetry(run_id, component, execution)
    await _maybe_retry(service, completed, run_id, component)
    return completed


async def _maybe_retry(
    service: JourneyRuntimeService,
    completed: Any,
    run_id: UUID,
    component: Any,
) -> None:
    if component is None or not getattr(component, "retry_policy", None):
        return
    policy = component.retry_policy or {}
    max_attempts = _safe_int(policy.get("maxAttempts") or policy.get("max_attempts"))
    if not max_attempts:
        return
    attempts = completed.attempts or 0
    if attempts >= max_attempts:
        return
    await service.requeue_run(completed)
    logger.info(
        "Journey component run scheduled for retry",
        run_id=str(run_id),
        attempts=attempts,
        max_attempts=max_attempts,
    )


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _log_run_telemetry(run_id: UUID, component: Any, execution: JourneyRuntimeExecutionResult) -> None:
    telemetry = dict(execution.telemetry or {})
    logger.info(
        "Journey component run telemetry",
        run_id=str(run_id),
        component_id=str(getattr(component, "id", None)) if component else None,
        success=execution.success,
        runner=telemetry.get("runner"),
        latency_ms=telemetry.get("latencyMs"),
        bindings_count=telemetry.get("bindingsCount"),
        output_preview=telemetry.get("outputPreview"),
        error_preview=telemetry.get("errorPreview"),
    )


__all__ = ["process_journey_run", "process_journey_run_sync"]

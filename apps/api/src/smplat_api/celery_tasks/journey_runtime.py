from __future__ import annotations

from loguru import logger

from smplat_api.celery_app import celery_app
from smplat_api.core.settings import settings
from smplat_api.tasks.journey_runtime import process_journey_run_sync


@celery_app.task(
    name="journey_runtime.execute_component_run",
    queue=settings.journey_runtime_task_queue,
)
def execute_component_run(run_id: str) -> dict[str, object]:
    """Celery entrypoint for executing a single journey component run."""

    try:
        return process_journey_run_sync(run_id)
    except Exception as exc:  # pragma: no cover - Celery handles retries/logging
        logger.exception("Journey component run failed", run_id=run_id)
        raise exc

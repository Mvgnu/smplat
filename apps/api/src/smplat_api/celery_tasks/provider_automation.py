from __future__ import annotations

from loguru import logger

from smplat_api.celery_app import celery_app
from smplat_api.core.settings import settings
from smplat_api.tasks.provider_alerts import run_provider_alerts_sync
from smplat_api.tasks.provider_replay import run_scheduled_replays_sync


@celery_app.task(
    name="provider_automation.run_replay_batch",
    queue=settings.provider_automation_replay_task_queue,
)
def run_provider_replay_batch(limit: int | None = None) -> dict[str, object]:
    """Execute the provider replay worker once via Celery."""

    if not settings.provider_replay_worker_enabled:
        logger.info("Provider replay worker disabled; skipping Celery task.")
        return {"processed": 0, "succeeded": 0, "failed": 0, "skipped": True}
    return run_scheduled_replays_sync(limit=limit)


@celery_app.task(
    name="provider_automation.evaluate_alerts",
    queue=settings.provider_automation_alert_task_queue,
)
def run_provider_alert_evaluation() -> dict[str, object]:
    """Execute one iteration of the provider automation alert worker via Celery."""

    if not settings.provider_automation_alert_worker_enabled:
        logger.info("Provider automation alert worker disabled; skipping Celery task.")
        return {"alertsSent": 0, "skipped": True}
    return run_provider_alerts_sync()

"""Celery application setup for provider automation and future background jobs."""

from __future__ import annotations

from celery import Celery

from smplat_api.core.settings import settings


def _resolve_backend_url() -> str:
    if settings.celery_result_backend:
        return settings.celery_result_backend
    return settings.redis_url


def _resolve_broker_url() -> str:
    if settings.celery_broker_url:
        return settings.celery_broker_url
    return settings.redis_url


celery_app = Celery(
    "smplat_api",
    broker=_resolve_broker_url(),
    backend=_resolve_backend_url(),
)

celery_app.conf.update(
    task_default_queue=settings.celery_default_queue,
    timezone="UTC",
    broker_connection_retry_on_startup=True,
)

celery_app.autodiscover_tasks(["smplat_api.celery_tasks"])

__all__ = ["celery_app"]

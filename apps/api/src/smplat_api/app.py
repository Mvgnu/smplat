import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.db.session import async_session
from smplat_api.domain.fulfillment import provider_registry
from .api.routes import api_router
from .core.logging import configure_logging
from .observability.tracing import configure_tracing
from .services.fulfillment import TaskProcessor
from .services.notifications import WeeklyDigestScheduler
from .scheduling import CatalogJobScheduler
from .workers import (
    BundleExperimentGuardrailWorker,
    HostedSessionRecoveryWorker,
    JourneyRuntimeWorker,
    ProviderAutomationAlertWorker,
    ProviderOrderReplayWorker,
)


APP_VERSION = "0.1.0"


def _session_factory():
    return async_session()


@asynccontextmanager
async def lifespan(app: FastAPI):
    processor = TaskProcessor(
        session_factory=_session_factory,
        poll_interval_seconds=settings.fulfillment_poll_interval_seconds,
        batch_size=settings.fulfillment_batch_size,
    )
    recovery_worker = HostedSessionRecoveryWorker(
        session_factory=_session_factory,
        interval_seconds=settings.hosted_recovery_interval_seconds,
        limit=settings.hosted_recovery_limit,
        max_attempts=settings.hosted_recovery_max_attempts,
        trigger_label=settings.hosted_recovery_trigger_label,
    )

    guardrail_worker = BundleExperimentGuardrailWorker(
        session_factory=_session_factory,
        interval_seconds=settings.bundle_experiment_guardrail_interval_seconds,
    )

    provider_replay_worker = ProviderOrderReplayWorker(
        session_factory=_session_factory,
        interval_seconds=settings.provider_replay_worker_interval_seconds,
        limit=settings.provider_replay_worker_limit,
    )
    provider_alert_worker = ProviderAutomationAlertWorker(
        session_factory=_session_factory,
        interval_seconds=settings.provider_automation_alert_interval_seconds,
        snapshot_limit=settings.provider_automation_alert_snapshot_limit,
    )
    journey_runtime_worker = JourneyRuntimeWorker(
        session_factory=_session_factory,
        interval_seconds=settings.journey_runtime_poll_interval_seconds,
        batch_size=settings.journey_runtime_batch_size,
    )

    schedule_path = Path(settings.catalog_job_schedule_path)
    if not schedule_path.is_absolute():
        schedule_path = Path(__file__).resolve().parent.parent.parent / schedule_path
    job_scheduler = CatalogJobScheduler(
        session_factory=_session_factory,
        config_path=schedule_path,
    )

    digest_scheduler = WeeklyDigestScheduler(
        session_factory=_session_factory,
        interval_seconds=settings.weekly_digest_interval_seconds,
        dry_run=settings.weekly_digest_dry_run,
    )

    async with async_session() as session:
        await provider_registry.refresh_catalog(session, force=True)

    app.state.fulfillment_processor = processor
    worker_task: asyncio.Task | None = None
    app.state.weekly_digest_scheduler = digest_scheduler
    app.state.hosted_recovery_worker = recovery_worker
    app.state.bundle_experiment_guardrail_worker = guardrail_worker
    app.state.provider_replay_worker = provider_replay_worker
    app.state.provider_automation_alert_worker = provider_alert_worker
    app.state.journey_runtime_worker = journey_runtime_worker
    app.state.catalog_job_scheduler = job_scheduler

    if settings.fulfillment_worker_enabled:
        worker_task = asyncio.create_task(processor.start())
        app.state.fulfillment_worker_task = worker_task
        logger.info("Fulfillment worker enabled", poll_interval=processor.poll_interval, batch_size=processor.batch_size)
    else:
        app.state.fulfillment_worker_task = None
        logger.info(
            "Fulfillment worker disabled",
            reason="fulfillment_worker_enabled is false",
        )

    digest_enabled = settings.weekly_digest_enabled
    if digest_enabled:
        digest_scheduler.start()
        logger.info(
            "Weekly digest scheduler enabled",
            interval_seconds=digest_scheduler.interval_seconds,
            dry_run=settings.weekly_digest_dry_run,
        )
    else:
        logger.info(
            "Weekly digest scheduler disabled",
            reason="weekly_digest_enabled is false",
        )

    recovery_enabled = settings.hosted_recovery_worker_enabled
    if recovery_enabled:
        recovery_worker.start()
        logger.info(
            "Hosted session recovery worker enabled",
            interval_seconds=recovery_worker.interval_seconds,
            limit=settings.hosted_recovery_limit,
            max_attempts=settings.hosted_recovery_max_attempts,
        )
    else:
        logger.info(
            "Hosted session recovery worker disabled",
            reason="hosted_recovery_worker_enabled is false",
        )

    guardrail_enabled = settings.bundle_experiment_guardrail_worker_enabled
    scheduler_enabled = settings.catalog_job_scheduler_enabled
    if scheduler_enabled:
        try:
            job_scheduler.start()
        except FileNotFoundError as exc:
            logger.exception("Catalog job scheduler failed to start", error=str(exc))
        else:
            logger.info(
                "Catalog job scheduler enabled",
                schedule_path=str(schedule_path),
            )
    else:
        logger.info(
            "Catalog job scheduler disabled",
            reason="catalog_job_scheduler_enabled is false",
        )

    if guardrail_enabled and not scheduler_enabled:
        guardrail_worker.start()
        logger.info(
            "Bundle experiment guardrail worker enabled",
            interval_seconds=guardrail_worker.interval_seconds,
        )
    elif guardrail_enabled and scheduler_enabled:
        logger.info(
            "Bundle experiment guardrail worker managed via scheduler",
            schedule_path=str(schedule_path),
        )
    else:
        logger.info(
            "Bundle experiment guardrail worker disabled",
            reason="bundle_experiment_guardrail_worker_enabled is false",
        )

    provider_replay_enabled = settings.provider_replay_worker_enabled
    if provider_replay_enabled:
        provider_replay_worker.start()
        logger.info(
            "Provider order replay worker enabled",
            interval_seconds=provider_replay_worker.interval_seconds,
            limit=settings.provider_replay_worker_limit,
        )
    else:
        logger.info(
            "Provider order replay worker disabled",
            reason="provider_replay_worker_enabled is false",
        )

    provider_alerts_enabled = settings.provider_automation_alert_worker_enabled
    if provider_alerts_enabled:
        provider_alert_worker.start()
        logger.info(
            "Provider automation alert worker enabled",
            interval_seconds=provider_alert_worker.interval_seconds,
            snapshot_limit=settings.provider_automation_alert_snapshot_limit,
        )
    else:
        logger.info(
            "Provider automation alert worker disabled",
            reason="provider_automation_alert_worker_enabled is false",
        )

    runtime_worker_started = False
    if settings.journey_runtime_worker_enabled and not settings.celery_broker_url:
        journey_runtime_worker.start()
        runtime_worker_started = True
        logger.info(
            "Journey runtime worker enabled (in-process)",
            interval_seconds=journey_runtime_worker.interval_seconds,
            batch_size=settings.journey_runtime_batch_size,
        )
    elif settings.journey_runtime_worker_enabled and settings.celery_broker_url:
        logger.info(
            "Journey runtime Celery worker enabled",
            queue=settings.journey_runtime_task_queue,
        )
    else:
        logger.info(
            "Journey runtime worker disabled",
            reason="journey_runtime_worker_enabled is false",
        )

    try:
        yield
    finally:
        if processor.is_running:
            processor.stop()
        if worker_task:
            await worker_task
        if digest_enabled:
            await digest_scheduler.stop()
        if recovery_enabled and recovery_worker.is_running:
            await recovery_worker.stop()
        if scheduler_enabled and job_scheduler.is_running:
            await job_scheduler.stop()
        if guardrail_enabled and not scheduler_enabled and guardrail_worker.is_running:
            await guardrail_worker.stop()
        if provider_replay_enabled and provider_replay_worker.is_running:
            await provider_replay_worker.stop()
        if provider_alerts_enabled and provider_alert_worker.is_running:
            await provider_alert_worker.stop()
        if runtime_worker_started and journey_runtime_worker.is_running:
            await journey_runtime_worker.stop()


def create_app() -> FastAPI:
    """Application factory for SMPLAT FastAPI service."""
    configure_logging(
        service_name="smplat-api",
        environment=settings.environment,
        version=APP_VERSION,
    )

    app = FastAPI(
        title="SMPLAT API",
        version=APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    configure_tracing(
        app,
        service_name="smplat-api",
        service_version=APP_VERSION,
        environment=settings.environment,
    )

    app.include_router(api_router)

    @app.get("/healthz", tags=["Health"])
    async def health_check() -> dict[str, str]:
        return {
            "status": "ok",
            "environment": settings.environment,
            "version": APP_VERSION,
        }

    return app

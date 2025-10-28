import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.db.session import async_session
from .api.routes import api_router
from .core.logging import configure_logging
from .services.fulfillment import TaskProcessor
from .services.notifications import WeeklyDigestScheduler
from .workers import HostedSessionRecoveryWorker


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

    digest_scheduler = WeeklyDigestScheduler(
        session_factory=_session_factory,
        interval_seconds=settings.weekly_digest_interval_seconds,
        dry_run=settings.weekly_digest_dry_run,
    )

    app.state.fulfillment_processor = processor
    worker_task: asyncio.Task | None = None
    app.state.weekly_digest_scheduler = digest_scheduler
    app.state.hosted_recovery_worker = recovery_worker

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


def create_app() -> FastAPI:
    """Application factory for SMPLAT FastAPI service."""
    configure_logging()

    app = FastAPI(
        title="SMPLAT API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.include_router(api_router)

    @app.get("/healthz", tags=["Health"])
    async def health_check() -> dict[str, str]:
        return {
            "status": "ok",
            "environment": settings.environment,
            "version": "0.1.0",
        }

    return app

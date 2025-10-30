from __future__ import annotations

from typing import Dict, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from smplat_api.core.settings import settings
from smplat_api.observability.scheduler import get_catalog_scheduler_store


router = APIRouter()


class ComponentStatus(BaseModel):
    status: Literal["ready", "starting", "disabled", "error"]
    detail: str | None = Field(default=None, description="Human readable status detail")
    last_error_at: str | None = Field(default=None, description="ISO timestamp of most recent error")


class ReadinessPayload(BaseModel):
    status: Literal["ready", "degraded", "error"]
    components: Dict[str, ComponentStatus]

@router.get("/healthz", summary="Service health check")
async def service_health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/healthz", include_in_schema=False)
async def service_health_alias() -> dict[str, str]:
    """Backward-compatible alias under /health."""

    return await service_health()


@router.get("/readyz", summary="Service readiness", response_model=ReadinessPayload)
async def service_readiness(request: Request) -> ReadinessPayload:
    components: Dict[str, ComponentStatus] = {}
    status: Literal["ready", "degraded", "error"] = "ready"

    processor = getattr(request.app.state, "fulfillment_processor", None)
    if settings.fulfillment_worker_enabled and processor is not None:
        metrics = processor.metrics
        running = processor.is_running
        component_status: Literal["ready", "starting", "disabled", "error"]
        component_status = "ready" if running else "starting"
        detail: str | None = None
        if metrics.last_error:
            component_status = "error"
            detail = metrics.last_error
            status = "error"
        elif not running:
            detail = "Fulfillment processor not running"
            status = "degraded" if status != "error" else status
        components["fulfillment_worker"] = ComponentStatus(
            status=component_status,
            detail=detail,
            last_error_at=metrics.last_error_at.isoformat() if metrics.last_error_at else None,
        )
    else:
        components["fulfillment_worker"] = ComponentStatus(
            status="disabled",
            detail="Fulfillment worker disabled via settings",
        )

    digest_scheduler = getattr(request.app.state, "weekly_digest_scheduler", None)
    if settings.weekly_digest_enabled and digest_scheduler is not None:
        running = bool(getattr(digest_scheduler, "is_running", False))
        scheduler_status: Literal["ready", "starting", "disabled", "error"] = "ready" if running else "starting"
        detail = None if running else "Weekly digest scheduler not running"
        if not running:
            status = "degraded" if status != "error" else status
        components["weekly_digest"] = ComponentStatus(status=scheduler_status, detail=detail)
    else:
        components["weekly_digest"] = ComponentStatus(
            status="disabled",
            detail="Weekly digest scheduler disabled via settings",
        )

    recovery_worker = getattr(request.app.state, "hosted_recovery_worker", None)
    if settings.hosted_recovery_worker_enabled and recovery_worker is not None:
        running = bool(getattr(recovery_worker, "is_running", False))
        recovery_status: Literal["ready", "starting", "disabled", "error"] = "ready" if running else "starting"
        detail = None if running else "Hosted session recovery worker not running"
        if not running:
            status = "degraded" if status != "error" else status
        components["hosted_session_recovery"] = ComponentStatus(status=recovery_status, detail=detail)
    else:
        components["hosted_session_recovery"] = ComponentStatus(
            status="disabled",
            detail="Hosted recovery worker disabled via settings",
        )

    guardrail_worker = getattr(request.app.state, "bundle_experiment_guardrail_worker", None)
    scheduler_enabled = settings.catalog_job_scheduler_enabled
    guardrail_enabled = settings.bundle_experiment_guardrail_worker_enabled
    if guardrail_enabled and guardrail_worker is not None:
        running = bool(getattr(guardrail_worker, "is_running", False))
        guardrail_status: Literal["ready", "starting", "disabled", "error"] = "ready" if running else "starting"
        detail = None if running else "Bundle guardrail worker not running"
        if not running and not scheduler_enabled:
            status = "degraded" if status != "error" else status
        components["bundle_guardrails"] = ComponentStatus(status=guardrail_status, detail=detail)
    elif scheduler_enabled:
        components["bundle_guardrails"] = ComponentStatus(
            status="ready",
            detail="Managed by catalog scheduler",
        )
    else:
        components["bundle_guardrails"] = ComponentStatus(
            status="disabled",
            detail="Guardrail worker disabled via settings",
        )

    scheduler = getattr(request.app.state, "catalog_job_scheduler", None)
    if scheduler_enabled and scheduler is not None:
        running = bool(getattr(scheduler, "is_running", False))
        detail = None if running else "Catalog scheduler not running"
        scheduler_status: Literal["ready", "starting", "disabled", "error"] = "ready" if running else "starting"
        snapshot = get_catalog_scheduler_store().snapshot()
        failing_jobs = [
            job_id
            for job_id, job in snapshot.jobs.items()
            if job.totals.get("consecutive_failures", 0) > 0
        ]
        if failing_jobs:
            scheduler_status = "error"
            detail = f"Jobs failing: {', '.join(failing_jobs)}"
            status = "error"
        elif not running:
            status = "degraded" if status != "error" else status
        components["catalog_scheduler"] = ComponentStatus(status=scheduler_status, detail=detail)
    else:
        components["catalog_scheduler"] = ComponentStatus(
            status="disabled",
            detail="Catalog scheduler disabled via settings",
        )

    return ReadinessPayload(status=status, components=components)


@router.get("/health/readyz", include_in_schema=False)
async def service_readiness_alias(request: Request) -> ReadinessPayload:
    """Backward-compatible alias for readiness checks under /health."""

    return await service_readiness(request)

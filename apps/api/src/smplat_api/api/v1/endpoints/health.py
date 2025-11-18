from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Literal

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from smplat_api.core.settings import settings
from smplat_api.db.session import get_session
from smplat_api.models.receipt_storage_probe import ReceiptStorageProbeTelemetry
from smplat_api.observability.scheduler import get_catalog_scheduler_store
from sqlalchemy.ext.asyncio import AsyncSession


router = APIRouter()


class ComponentStatus(BaseModel):
    status: Literal["ready", "starting", "disabled", "error", "degraded"]
    detail: str | None = Field(default=None, description="Human readable status detail")
    last_error_at: str | None = Field(default=None, description="ISO timestamp of most recent error")
    last_success_at: str | None = Field(default=None, description="ISO timestamp of most recent success")


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
async def service_readiness(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ReadinessPayload:
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
        detail = None if running else "Weekly digest scheduler not running (conversion snapshot unavailable)"
        if not running:
            status = "degraded" if status != "error" else status
        components["weekly_digest"] = ComponentStatus(status=scheduler_status, detail=detail)
    else:
        components["weekly_digest"] = ComponentStatus(
            status="disabled",
            detail="Weekly digest scheduler disabled via settings (conversion metrics fallback to empty rows)",
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

    provider_alert_worker = getattr(request.app.state, "provider_automation_alert_worker", None)
    provider_alerts_enabled = settings.provider_automation_alert_worker_enabled
    if provider_alerts_enabled and provider_alert_worker is not None:
        running = bool(getattr(provider_alert_worker, "is_running", False))
        alert_status: Literal["ready", "starting", "disabled", "error"] = "ready" if running else "starting"
        detail = None if running else "Provider automation alert worker not running"
        if not running:
            status = "degraded" if status != "error" else status
        components["provider_automation_alerts"] = ComponentStatus(status=alert_status, detail=detail)
    else:
        components["provider_automation_alerts"] = ComponentStatus(
            status="disabled",
            detail="Provider automation alert worker disabled via settings",
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

    receipt_storage_status = await _evaluate_receipt_storage_component(session=session)
    components["receipt_storage"] = receipt_storage_status
    if receipt_storage_status.status == "error":
        status = "error"
    elif receipt_storage_status.status == "degraded" and status == "ready":
        status = "degraded"

    return ReadinessPayload(status=status, components=components)


@router.get("/health/readyz", include_in_schema=False)
async def service_readiness_alias(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ReadinessPayload:
    """Backward-compatible alias for readiness checks under /health."""

    return await service_readiness(request, session)


async def _evaluate_receipt_storage_component(session: AsyncSession | None = None) -> ComponentStatus:
    bucket = (settings.receipt_storage_bucket or "").strip()
    public_base = (settings.receipt_storage_public_base_url or "").strip()
    if not bucket:
        return ComponentStatus(
            status="disabled",
            detail="Receipt storage bucket not configured",
        )
    if not public_base:
        return ComponentStatus(
            status="error",
            detail="Receipt storage public base URL missing",
            last_error_at=datetime.now(timezone.utc).isoformat(),
        )

    client = _build_receipt_s3_client()
    if client is None:
        return ComponentStatus(
            status="error",
            detail="Receipt storage client could not be initialized",
            last_error_at=datetime.now(timezone.utc).isoformat(),
        )
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        detail = f"Bucket check failed ({code or 'unknown error'})"
        return ComponentStatus(
            status="error",
            detail=detail,
            last_error_at=datetime.now(timezone.utc).isoformat(),
        )
    except BotoCoreError as error:
        return ComponentStatus(
            status="error",
            detail=f"Receipt storage unreachable ({error})",
            last_error_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as error:  # pragma: no cover - defensive guard
        return ComponentStatus(
            status="error",
            detail=f"Receipt storage unexpected error ({error})",
            last_error_at=datetime.now(timezone.utc).isoformat(),
        )
    telemetry = await _fetch_receipt_storage_probe(session)
    detail = f"Bucket {bucket} reachable"
    status: Literal["ready", "starting", "disabled", "error", "degraded"] = "ready"
    last_error_at: str | None = None
    last_success_at: str | None = None
    if telemetry is None:
        detail = f"{detail} (probe telemetry unavailable)"
    else:
        last_error_at = _isoformat(telemetry.last_error_at)
        last_success_at = _isoformat(telemetry.last_success_at)
        if telemetry.last_detail:
            detail = telemetry.last_detail
        if _probe_failure_active(telemetry):
            status = "error"
            detail = telemetry.last_error_message or "Receipt storage probe failure"
        elif telemetry.last_success_at is None:
            status = "degraded"
            detail = "Receipt storage probe has not completed successfully yet"
        elif _probe_stale(telemetry.last_success_at):
            status = "degraded"
            detail = (
                f"Last successful probe at {telemetry.last_success_at.isoformat()} "
                f"(>{settings.receipt_storage_probe_max_stale_hours}h ago)"
            )
    return ComponentStatus(
        status=status,
        detail=detail,
        last_error_at=last_error_at,
        last_success_at=last_success_at,
    )


def _build_receipt_s3_client():
    try:
        config = None
        if settings.receipt_storage_force_path_style:
            config = Config(s3={"addressing_style": "path"})
        return boto3.client(
            "s3",
            region_name=settings.receipt_storage_region,
            endpoint_url=settings.receipt_storage_endpoint or None,
            config=config,
        )
    except Exception:  # pragma: no cover - boto client creation rarely fails
        return None


async def _fetch_receipt_storage_probe(session: AsyncSession | None) -> ReceiptStorageProbeTelemetry | None:
    if session is None:
        return None
    try:
        telemetry = await session.get(ReceiptStorageProbeTelemetry, "receipt_storage")
    except Exception:  # pragma: no cover - defensive guard if session closed
        return None
    return telemetry


def _probe_failure_active(telemetry: ReceiptStorageProbeTelemetry) -> bool:
    if telemetry.last_error_at is None:
        return False
    if telemetry.last_success_at is None:
        return True
    error_at = _ensure_aware(telemetry.last_error_at)
    success_at = _ensure_aware(telemetry.last_success_at)
    return error_at >= success_at


def _probe_stale(last_success_at: datetime | None) -> bool:
    if last_success_at is None:
        return True
    success_at = _ensure_aware(last_success_at)
    max_age = settings.receipt_storage_probe_max_stale_hours
    if max_age <= 0:
        return False
    delta = datetime.now(timezone.utc) - success_at
    return delta > timedelta(hours=max_age)


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = _ensure_aware(value)
    return aware.isoformat()


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

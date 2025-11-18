"""CLI entry points for provider automation alert evaluations."""

from __future__ import annotations

import argparse
import asyncio
from typing import Any, Mapping

import httpx

from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.db.session import async_session
from smplat_api.services.fulfillment import (
    ProviderAutomationRunService,
    ProviderAutomationRunTypeEnum,
)
from smplat_api.services.fulfillment.automation_status_service import AutomationStatusService
from smplat_api.workers.provider_automation_alerts import ProviderAutomationAlertWorker


async def run_provider_alerts(
    *,
    worker: ProviderAutomationAlertWorker | None = None,
) -> dict[str, Any]:
    """Execute one alert-evaluation iteration."""

    local_worker = worker or ProviderAutomationAlertWorker(
        session_factory=async_session,
        interval_seconds=settings.provider_automation_alert_interval_seconds,
        snapshot_limit=settings.provider_automation_alert_snapshot_limit,
    )
    summary = await local_worker.run_once()
    logger.info("Provider automation alerts evaluated", summary=summary)
    await _record_alert_status(summary)
    await _record_alert_run_history(summary)
    return summary


async def _async_main() -> None:
    await run_provider_alerts()


def cli() -> None:
    argparse.ArgumentParser(description="Run a single provider automation alert evaluation.").parse_args()
    asyncio.run(_async_main())


if __name__ == "__main__":  # pragma: no cover
    cli()


def run_provider_alerts_sync(
    *,
    worker: ProviderAutomationAlertWorker | None = None,
) -> dict[str, Any]:
    """Synchronous helper exposed for Celery/cron runners."""

    return asyncio.run(run_provider_alerts(worker=worker))


async def _record_alert_status(summary: Any) -> None:
    service = AutomationStatusService()
    try:
        await service.record_alert_summary(summary)
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to record alert status", error=str(exc))


async def _record_alert_run_history(summary: Mapping[str, Any]) -> None:
    try:
        async with async_session() as session:  # type: ignore[arg-type]
            service = ProviderAutomationRunService(session)
            metadata: dict[str, Any] = {}
            digest = summary.get("alertsDigest")
            if isinstance(digest, list):
                metadata["alertsDigest"] = digest
            load_digest = summary.get("loadAlertsDigest")
            if isinstance(load_digest, list):
                metadata["loadAlertsDigest"] = load_digest
            auto_paused = summary.get("autoPausedProviders")
            if isinstance(auto_paused, list):
                metadata["autoPausedProviders"] = auto_paused
            auto_resumed = summary.get("autoResumedProviders")
            if isinstance(auto_resumed, list):
                metadata["autoResumedProviders"] = auto_resumed
            workflow_summary = summary.get("workflowTelemetry")
            if not isinstance(workflow_summary, Mapping):
                workflow_summary = await _fetch_guardrail_workflow_summary()
            if workflow_summary:
                metadata["workflowTelemetry"] = workflow_summary
            metadata_payload = metadata if metadata else None
            await service.record_run(
                run_type=ProviderAutomationRunTypeEnum.ALERT,
                summary=dict(summary),
                metadata=metadata_payload,
                alerts_sent=_safe_int(summary.get("alertsSent")),
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to record alert run history", error=str(exc))


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def _fetch_guardrail_workflow_summary() -> Mapping[str, Any] | None:
    url = settings.guardrail_workflow_telemetry_summary_url
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, timeout=10)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, Mapping):
                return dict(payload)
    except httpx.HTTPError as exc:  # pragma: no cover - observational
        logger.warning("Failed to fetch guardrail workflow telemetry summary", error=str(exc))
    except ValueError:  # pragma: no cover - defensive
        logger.warning("Guardrail workflow telemetry summary payload could not be parsed")
    return None

"""CLI entry points for provider automation alert evaluations."""

from __future__ import annotations

import argparse
import asyncio
from typing import Any, Mapping

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
            metadata: dict[str, Any] | None = None
            digest = summary.get("alertsDigest")
            if isinstance(digest, list):
                metadata = {"alertsDigest": digest}
            load_digest = summary.get("loadAlertsDigest")
            if isinstance(load_digest, list):
                if metadata is None:
                    metadata = {}
                metadata["loadAlertsDigest"] = load_digest
            await service.record_run(
                run_type=ProviderAutomationRunTypeEnum.ALERT,
                summary=dict(summary),
                metadata=metadata,
                alerts_sent=_safe_int(summary.get("alertsSent")),
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to record alert run history", error=str(exc))


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

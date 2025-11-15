"""Worker that inspects provider automation telemetry and emits alerts."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Mapping, Sequence
from urllib.parse import quote_plus, urlencode, urljoin

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.fulfillment import ProviderAutomationService
from smplat_api.services.fulfillment.provider_automation_alerts import (
    ProviderAutomationAlert,
    ProviderAutomationAlertEvaluator,
    ProviderAutomationAlertNotifier,
    ProviderLoadAlert,
)
from smplat_api.services.reporting import BlueprintMetricsService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]
AutomationFactory = Callable[[AsyncSession], ProviderAutomationService]
MetricsFactory = Callable[[AsyncSession], BlueprintMetricsService]


class ProviderAutomationAlertWorker:
    """Periodically evaluates provider automation telemetry and notifies operators."""

    # meta: worker: provider-automation-alerts

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        automation_factory: AutomationFactory | None = None,
        evaluator: ProviderAutomationAlertEvaluator | None = None,
        notifier: ProviderAutomationAlertNotifier | None = None,
        metrics_factory: MetricsFactory | None = None,
        interval_seconds: int | None = None,
        snapshot_limit: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._automation_factory = automation_factory or (lambda session: ProviderAutomationService(session))
        self._evaluator = evaluator or ProviderAutomationAlertEvaluator(
            guardrail_fail_threshold=settings.provider_automation_alert_guardrail_fail_threshold,
            guardrail_warn_threshold=settings.provider_automation_alert_guardrail_warn_threshold,
            replay_failure_threshold=settings.provider_automation_alert_replay_failure_threshold,
        )
        self._notifier = notifier or ProviderAutomationAlertNotifier(settings)
        self._metrics_factory = metrics_factory or (lambda session: BlueprintMetricsService(session))
        self.interval_seconds = interval_seconds or settings.provider_automation_alert_interval_seconds
        self._snapshot_limit = snapshot_limit or settings.provider_automation_alert_snapshot_limit
        self._load_alert_enabled = settings.provider_load_alert_enabled
        self._load_alert_short_window = settings.provider_load_alert_short_window_days
        self._load_alert_long_window = settings.provider_load_alert_long_window_days
        self._load_alert_share_threshold = settings.provider_load_alert_share_threshold
        self._load_alert_delta_threshold = settings.provider_load_alert_delta_threshold
        self._load_alert_min_engagements = settings.provider_load_alert_min_engagements
        self._load_alert_limit = settings.provider_load_alert_max_results
        self._frontend_url = settings.frontend_url
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False

    async def run_once(self) -> dict[str, Any]:
        """Evaluate telemetry a single time."""

        session = await self._ensure_session()
        snapshot: ProviderAutomationSnapshotResponse
        load_alerts: list[ProviderLoadAlert] = []
        async with session as db:
            automation = self._automation_factory(db)
            snapshot = await automation.build_snapshot(limit_per_provider=self._snapshot_limit)
            load_alerts = await self._collect_load_alerts(db)
        alerts = self._evaluator.evaluate(snapshot)
        await self._dispatch(alerts, load_alerts)
        digest = [alert.to_digest() for alert in alerts]
        load_digest = [alert.to_digest() for alert in load_alerts]
        return {
            "alerts": len(alerts),
            "alertsSent": len(alerts),
            "alertsDigest": digest,
            "loadAlerts": len(load_alerts),
            "loadAlertsDigest": load_digest,
        }

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        self.is_running = True
        logger.info(
            "Provider automation alert worker started",
            interval_seconds=self.interval_seconds,
        )

    async def stop(self) -> None:
        if not self.is_running:
            return
        self._stop_event.set()
        if self._task:
            await self._task
        self.is_running = False
        logger.info("Provider automation alert worker stopped")

    async def _dispatch(
        self,
        alerts: Sequence[ProviderAutomationAlert],
        load_alerts: Sequence[ProviderLoadAlert],
    ) -> None:
        if not alerts and not load_alerts:
            return
        try:
            await self._notifier.notify(alerts, load_alerts)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Provider automation alert dispatch failed", error=str(exc))

    async def _collect_load_alerts(self, session: AsyncSession) -> list[ProviderLoadAlert]:
        if not self._load_alert_enabled:
            return []
        service = self._metrics_factory(session)
        metrics = await service.fetch_metrics(
            window_days=max(self._load_alert_long_window, 30),
            provider_limit=self._load_alert_limit,
            preset_limit=self._load_alert_limit,
            load_alert_short_window=self._load_alert_short_window,
            load_alert_long_window=self._load_alert_long_window,
            load_alert_share_threshold=self._load_alert_share_threshold,
            load_alert_delta_threshold=self._load_alert_delta_threshold,
            load_alert_min_engagements=self._load_alert_min_engagements,
            load_alert_limit=self._load_alert_limit,
        )
        payloads = metrics.get("providerLoadAlerts") or []
        alerts: list[ProviderLoadAlert] = []
        for entry in payloads:
            if not isinstance(entry, dict):
                continue
            provider_id = entry.get("providerId")
            preset_id = entry.get("presetId")
            if not provider_id or not preset_id:
                continue
            provider_id_str = str(provider_id)
            preset_id_str = str(preset_id)
            links_payload = entry.get("links")
            normalized_links = self._normalize_links(
                preset_id=preset_id_str,
                provider_id=provider_id_str,
                payload=links_payload if isinstance(links_payload, Mapping) else None,
            )
            alerts.append(
                ProviderLoadAlert(
                    provider_id=provider_id_str,
                    provider_name=entry.get("providerName"),
                    preset_id=preset_id_str,
                    preset_label=entry.get("presetLabel"),
                    service_id=entry.get("serviceId"),
                    service_action=entry.get("serviceAction"),
                    currency=entry.get("currency"),
                    short_window_days=int(entry.get("shortWindowDays") or self._load_alert_short_window),
                    long_window_days=int(entry.get("longWindowDays") or self._load_alert_long_window),
                    short_share=float(entry.get("shortShare") or 0.0),
                    long_share=float(entry.get("longShare") or 0.0),
                    share_delta=float(entry.get("shareDelta") or 0.0),
                    short_engagements=int(entry.get("shortEngagements") or 0),
                    long_engagements=int(entry.get("longEngagements") or 0),
                    short_amount_total=float(entry.get("shortAmountTotal") or 0.0),
                    long_amount_total=float(entry.get("longAmountTotal") or 0.0),
                    merchandising_url=self._build_admin_url(normalized_links.get("merchandising")),
                    fulfillment_url=self._build_admin_url(normalized_links.get("fulfillment")),
                    orders_url=self._build_admin_url(normalized_links.get("orders")),
                )
            )
        return alerts

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.run_once()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Provider automation alert iteration failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

    def _normalize_links(
        self,
        *,
        preset_id: str | None,
        provider_id: str | None,
        payload: Mapping[str, Any] | None,
    ) -> dict[str, str]:
        links: dict[str, str] = {}

        def _clean(value: Any) -> str | None:
            if isinstance(value, str) and value.strip():
                return value.strip()
            return None

        if payload:
            for key in ("merchandising", "fulfillment", "orders"):
                candidate = _clean(payload.get(key))
                if candidate:
                    links[key] = candidate

        preset_value = preset_id.strip() if preset_id else None
        provider_value = provider_id.strip() if provider_id else None

        if "merchandising" not in links and preset_value:
            links["merchandising"] = f"/admin/merchandising?presetId={quote_plus(preset_value)}"
        if "fulfillment" not in links and provider_value:
            links["fulfillment"] = f"/admin/fulfillment/providers?providerId={quote_plus(provider_value)}"

        if "orders" not in links:
            query_parts: list[tuple[str, str]] = []
            if preset_value:
                query_parts.append(("presetId", preset_value))
            if provider_value:
                query_parts.append(("providerId", provider_value))
            if query_parts:
                links["orders"] = f"/admin/orders?{urlencode(query_parts)}"

        return links

    def _build_admin_url(self, value: str | None) -> str | None:
        if not value:
            return None
        candidate = value.strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            return candidate
        base = self._frontend_url.rstrip("/") + "/"
        relative = candidate.lstrip("/")
        return urljoin(base, relative)


__all__ = ["ProviderAutomationAlertWorker"]

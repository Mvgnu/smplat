"""Worker that inspects provider automation telemetry and emits alerts."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Mapping, Sequence
from urllib.parse import quote_plus, urlencode, urljoin

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.fulfillment import ProviderAutomationService
from smplat_api.services.fulfillment.provider_automation_alerts import (
    ProviderAutomationAlert,
    ProviderAutomationAlertEvaluator,
    ProviderAutomationAlertNotifier,
    ProviderLoadAlert,
)
from smplat_api.services.reporting import BlueprintMetricsService
from smplat_api.services.reporting.guardrail_followups import GuardrailFollowUpService
from smplat_api.services.reporting.guardrail_followup_notifier import GuardrailFollowUpNotifier

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
        follow_up_notifier: GuardrailFollowUpNotifier | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._automation_factory = automation_factory or (lambda session: ProviderAutomationService(session))
        self._guardrail_fail_threshold = settings.provider_automation_alert_guardrail_fail_threshold
        self._guardrail_warn_threshold = settings.provider_automation_alert_guardrail_warn_threshold
        self._replay_failure_threshold = settings.provider_automation_alert_replay_failure_threshold
        self._evaluator = evaluator or ProviderAutomationAlertEvaluator(
            guardrail_fail_threshold=self._guardrail_fail_threshold,
            guardrail_warn_threshold=self._guardrail_warn_threshold,
            replay_failure_threshold=self._replay_failure_threshold,
        )
        self._notifier = notifier or ProviderAutomationAlertNotifier(settings)
        self._follow_up_notifier = follow_up_notifier or GuardrailFollowUpNotifier()
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
        self._workflow_summary_url = settings.guardrail_workflow_telemetry_summary_url
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False

    async def run_once(self) -> dict[str, Any]:
        """Evaluate telemetry a single time."""

        session = await self._ensure_session()
        snapshot: ProviderAutomationSnapshotResponse
        load_alerts: list[ProviderLoadAlert] = []
        auto_summary = {
            "autoPaused": 0,
            "autoResumed": 0,
            "autoPausedProviders": [],
            "autoResumedProviders": [],
        }
        alerts: Sequence[ProviderAutomationAlert] = []
        async with session as db:
            automation = self._automation_factory(db)
            snapshot = await automation.build_snapshot(limit_per_provider=self._snapshot_limit)
            load_alerts = await self._collect_load_alerts(db)
            alerts = self._evaluator.evaluate(snapshot)
            auto_summary = await self._sync_guardrail_status(db, alerts)
        workflow_summary = await self._fetch_workflow_summary()
        await self._dispatch(alerts, load_alerts, auto_summary, workflow_summary)
        digest = [alert.to_digest() for alert in alerts]
        load_digest = [alert.to_digest() for alert in load_alerts]
        payload: dict[str, Any] = {
            "alerts": len(alerts),
            "alertsSent": len(alerts),
            "alertsDigest": digest,
            "loadAlerts": len(load_alerts),
            "loadAlertsDigest": load_digest,
            **auto_summary,
        }
        if workflow_summary:
            payload["workflowTelemetry"] = workflow_summary
        return payload

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
        auto_summary: Mapping[str, Any] | None,
        workflow_summary: Mapping[str, Any] | None,
    ) -> None:
        has_auto_actions = self._has_auto_guardrail_actions(auto_summary)
        if not alerts and not load_alerts and not has_auto_actions:
            return
        try:
            await self._notifier.notify(alerts, load_alerts, auto_summary, workflow_summary)
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

    async def _sync_guardrail_status(
        self,
        session: AsyncSession,
        alerts: Sequence[ProviderAutomationAlert],
    ) -> dict[str, int]:
        summary: dict[str, Any] = {
            "autoPaused": 0,
            "autoResumed": 0,
            "autoPausedProviders": [],
            "autoResumedProviders": [],
        }
        service = GuardrailFollowUpService(session)
        notifier = self._follow_up_notifier
        alerts_by_provider = {alert.provider_id: alert for alert in alerts}
        auto_pause_targets = {
            provider_id
            for provider_id, alert in alerts_by_provider.items()
            if self._should_auto_pause(alert)
        }
        status_by_provider = await self._load_relevant_statuses(session, set(alerts_by_provider.keys()))

        # Auto-pause providers breaching guardrails
        for provider_id in sorted(auto_pause_targets):
            matching_alert = alerts_by_provider.get(provider_id)
            if matching_alert is None:
                continue
            current_status = status_by_provider.get(provider_id)
            if current_status and current_status.is_paused:
                if current_status.last_source != "automation":
                    continue
                # already auto-paused
                continue
            provider_name = matching_alert.provider_name
            notes = "Auto pause triggered by provider automation alerts worker"
            entry, status = await service.record_follow_up(
                provider_id=provider_id,
                provider_name=provider_name,
                action="pause",
                notes=notes,
                platform_context=None,
                source="automation",
                conversion_cursor=None,
                conversion_href=None,
                attachments=None,
            )
            if notifier:
                await notifier.notify(entry=entry, status=status)
            status_by_provider[provider_id] = status
            provider_payload = {
                "providerId": provider_id,
                "providerName": provider_name,
                "action": "pause",
                "notes": notes,
                "guardrailFailures": matching_alert.guardrail_failures,
                "guardrailWarnings": matching_alert.guardrail_warnings,
                "replayFailures": matching_alert.replay_failures,
                "replayTotal": matching_alert.replay_total,
                "reasons": matching_alert.reasons,
                "followUpId": str(entry.id),
            }
            summary["autoPausedProviders"].append(provider_payload)
            summary["autoPaused"] += 1

        # Resume providers previously auto-paused once alerts clear entirely
        for provider_id, status in status_by_provider.items():
            if not status.is_paused or status.last_source != "automation":
                continue
            if provider_id in alerts_by_provider:
                continue
            provider_name = status.provider_name or provider_id
            previous_follow_up_id = status.last_follow_up_id
            entry, updated_status = await service.record_follow_up(
                provider_id=provider_id,
                provider_name=provider_name,
                action="resume",
                notes="Automation worker resumed provider after guardrails cleared",
                platform_context=None,
                source="automation",
                conversion_cursor=None,
                conversion_href=None,
                attachments=None,
            )
            if notifier:
                await notifier.notify(entry=entry, status=updated_status)
            status_by_provider[provider_id] = updated_status
            provider_payload = {
                "providerId": provider_id,
                "providerName": provider_name,
                "action": "resume",
                "notes": "Automation worker resumed provider after guardrails cleared",
                "followUpId": str(entry.id),
                "previousFollowUpId": str(previous_follow_up_id) if previous_follow_up_id else None,
            }
            summary["autoResumedProviders"].append(provider_payload)
            summary["autoResumed"] += 1

        return summary

    async def _load_relevant_statuses(
        self,
        session: AsyncSession,
        provider_ids: set[str],
    ) -> dict[str, ProviderGuardrailStatus]:
        status_by_provider: dict[str, ProviderGuardrailStatus] = {}
        if provider_ids:
            result = await session.execute(
                select(ProviderGuardrailStatus).where(ProviderGuardrailStatus.provider_id.in_(list(provider_ids)))
            )
            for status in result.scalars():
                status_by_provider[status.provider_id] = status

        result = await session.execute(
            select(ProviderGuardrailStatus).where(ProviderGuardrailStatus.is_paused.is_(True))
        )
        for status in result.scalars():
            status_by_provider.setdefault(status.provider_id, status)
        return status_by_provider

    @staticmethod
    def _has_auto_guardrail_actions(summary: Mapping[str, Any] | None) -> bool:
        if not summary:
            return False
        auto_paused = summary.get("autoPausedProviders")
        auto_resumed = summary.get("autoResumedProviders")
        if isinstance(auto_paused, Sequence) and auto_paused:
            return True
        if isinstance(auto_resumed, Sequence) and auto_resumed:
            return True
        paused_count = summary.get("autoPaused")
        resumed_count = summary.get("autoResumed")
        return bool(paused_count or resumed_count)

    def _should_auto_pause(self, alert: ProviderAutomationAlert) -> bool:
        if alert.guardrail_failures >= self._guardrail_fail_threshold:
            return True
        if alert.replay_failures >= self._replay_failure_threshold:
            return True
        return False

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session

    async def _fetch_workflow_summary(self) -> Mapping[str, Any] | None:
        if not self._workflow_summary_url:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(self._workflow_summary_url, timeout=10)
                response.raise_for_status()
                payload = response.json()
                if isinstance(payload, Mapping):
                    return dict(payload)
        except httpx.HTTPError as exc:  # pragma: no cover
            logger.warning("Failed to fetch guardrail workflow telemetry summary", error=str(exc))
        except ValueError:  # pragma: no cover
            logger.warning("Guardrail workflow telemetry summary payload could not be parsed")
        return None

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

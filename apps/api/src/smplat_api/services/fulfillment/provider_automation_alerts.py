"""Alert evaluation + notification helpers for provider automation telemetry."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote_plus, urljoin

import httpx
from loguru import logger

from smplat_api.core.settings import Settings
from smplat_api.db.session import async_session
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.analytics.experiment_analytics import (
    ExperimentAnalyticsService,
    ExperimentConversionDigest,
)
from smplat_api.services.notifications.backend import EmailBackend, SMTPEmailBackend
from smplat_api.services.providers.platform_context_cache import (
    ProviderPlatformContextCacheService,
    ProviderPlatformContextRecord,
)


@dataclass(slots=True)
class ProviderAutomationAlert:
    """Alert payload surfaced to operators when automation telemetry breaches thresholds."""

    provider_id: str
    provider_name: str
    guardrail_failures: int
    guardrail_warnings: int
    replay_failures: int
    replay_total: int
    guardrail_hotspots: dict[str, dict[str, int]]
    rule_overrides: dict[str, list[dict[str, Any]]]

    @property
    def reasons(self) -> list[str]:
        messages: list[str] = []
        if self.guardrail_failures:
            messages.append(f"{self.guardrail_failures} guardrail fail(s)")
        if self.guardrail_warnings:
            messages.append(f"{self.guardrail_warnings} guardrail warn(s)")
        if self.replay_failures:
            label = f"{self.replay_failures} replay failure(s)"
            if self.replay_total:
                label = f"{self.replay_failures}/{self.replay_total} replay failures"
            messages.append(label)
        return messages

    def to_digest(self) -> dict[str, Any]:
        return {
            "providerId": self.provider_id,
            "providerName": self.provider_name,
            "reasons": self.reasons,
            "guardrailFailures": self.guardrail_failures,
            "guardrailWarnings": self.guardrail_warnings,
            "replayFailures": self.replay_failures,
            "replayTotal": self.replay_total,
            "guardrailHotspots": self.guardrail_hotspots,
            "ruleOverrides": self.rule_overrides,
        }


@dataclass(slots=True)
class ProviderLoadAlert:
    """Alert emitted when preset cohorts overload a provider compared to baseline windows."""

    provider_id: str
    provider_name: str | None
    preset_id: str
    preset_label: str | None
    service_id: str | None
    service_action: str | None
    currency: str | None
    short_window_days: int
    long_window_days: int
    short_share: float
    long_share: float
    share_delta: float
    short_engagements: int
    long_engagements: int
    short_amount_total: float
    long_amount_total: float
    merchandising_url: str | None = None
    fulfillment_url: str | None = None
    orders_url: str | None = None

    @property
    def summary(self) -> str:
        short_pct = f"{self.short_share * 100:.0f}%"
        long_pct = f"{self.long_share * 100:.0f}%"
        return (
            f"{self.provider_name or self.provider_id} owns {short_pct} of "
            f"{self.preset_label or self.preset_id} traffic (baseline {long_pct})"
        )

    def to_digest(self) -> dict[str, Any]:
        payload = {
            "providerId": self.provider_id,
            "providerName": self.provider_name,
            "presetId": self.preset_id,
            "presetLabel": self.preset_label,
            "serviceId": self.service_id,
            "serviceAction": self.service_action,
            "currency": self.currency,
            "shortWindowDays": self.short_window_days,
            "longWindowDays": self.long_window_days,
            "shortShare": self.short_share,
            "longShare": self.long_share,
            "shareDelta": self.share_delta,
            "shortEngagements": self.short_engagements,
            "longEngagements": self.long_engagements,
            "shortAmountTotal": self.short_amount_total,
            "longAmountTotal": self.long_amount_total,
        }
        links = {
            "merchandising": self.merchandising_url,
            "fulfillment": self.fulfillment_url,
            "orders": self.orders_url,
        }
        filtered_links = {key: value for key, value in links.items() if value}
        if filtered_links:
            payload["links"] = filtered_links
        return payload


@dataclass(slots=True)
class ExperimentConversionDigest:
    slug: str
    order_currency: str | None
    order_total: float
    order_count: int
    journey_count: int
    loyalty_points: int
    last_activity: datetime | None


class ProviderAutomationAlertEvaluator:
    """Reduces automation telemetry into actionable alerts."""

    def __init__(
        self,
        *,
        guardrail_fail_threshold: int,
        guardrail_warn_threshold: int,
        replay_failure_threshold: int,
    ) -> None:
        self._guardrail_fail_threshold = max(guardrail_fail_threshold, 1)
        self._guardrail_warn_threshold = max(guardrail_warn_threshold, 1)
        self._replay_failure_threshold = max(replay_failure_threshold, 1)

    def evaluate(self, snapshot: ProviderAutomationSnapshotResponse) -> list[ProviderAutomationAlert]:
        alerts: list[ProviderAutomationAlert] = []
        for entry in snapshot.providers:
            telemetry = entry.telemetry
            guardrail_summary = telemetry.guardrails
            replays = telemetry.replays

            guardrail_fails = guardrail_summary.fail
            guardrail_warns = guardrail_summary.warn
            replay_failures = replays.failed
            triggered = False

            if guardrail_fails >= self._guardrail_fail_threshold:
                triggered = True
            elif guardrail_warns >= self._guardrail_warn_threshold:
                triggered = True

            if replay_failures >= self._replay_failure_threshold:
                triggered = True

            if not triggered:
                continue

            hotspots: dict[str, dict[str, int]] = {}
            for service_id, bucket in telemetry.guardrail_hits_by_service.items():
                hotspots[service_id] = {
                    "fail": bucket.fail,
                    "warn": bucket.warn,
                    "pass": bucket.pass_count,
                    "evaluated": bucket.evaluated,
                }

            rule_overrides: dict[str, list[dict[str, Any]]] = {}
            overrides = telemetry.rule_overrides_by_service or {}
            for service_id, summary in overrides.items():
                entries = list(summary.rules.values()) if summary.rules else []
                ranked = sorted(entries, key=lambda item: item.count, reverse=True)
                rule_overrides[service_id] = [
                    {"id": item.id, "label": item.label, "count": item.count}
                    for item in ranked[:3]
                ]

            alerts.append(
                ProviderAutomationAlert(
                    provider_id=entry.id,
                    provider_name=entry.name,
                    guardrail_failures=guardrail_fails,
                    guardrail_warnings=guardrail_warns,
                    replay_failures=replay_failures,
                    replay_total=replays.total,
                    guardrail_hotspots=hotspots,
                    rule_overrides=rule_overrides,
                )
            )
        return alerts


class ProviderAutomationAlertNotifier:
    """Dispatches automation alerts across configured channels."""

    def __init__(
        self,
        settings: Settings,
        *,
        email_backend: EmailBackend | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._email_backend = email_backend or self._build_email_backend(settings)
        self._http_client = http_client

    async def notify(
        self,
        alerts: Sequence[ProviderAutomationAlert],
        load_alerts: Sequence[ProviderLoadAlert] | None = None,
        auto_summary: Mapping[str, Any] | None = None,
        workflow_summary: Mapping[str, Any] | None = None,
    ) -> None:
        load_alerts = load_alerts or []
        auto_actions = self._extract_auto_actions(auto_summary)
        if not alerts and not load_alerts and not auto_actions:
            return
        await asyncio.gather(
            self._notify_email(alerts, load_alerts, auto_actions, workflow_summary),
            self._notify_slack(alerts, load_alerts, auto_actions, workflow_summary),
        )

    async def _notify_email(
        self,
        alerts: Sequence[ProviderAutomationAlert],
        load_alerts: Sequence[ProviderLoadAlert],
        auto_actions: Sequence[dict[str, Any]],
        workflow_summary: Mapping[str, Any] | None,
    ) -> None:
        recipients = self._settings.provider_automation_alert_email_recipients
        backend = self._email_backend
        if not recipients or backend is None:
            return

        subject = "Provider automation alerts"
        lines: list[str] = []
        if alerts:
            lines.append("The following providers breached automation guardrails:")
            lines.append("")
            for alert in alerts:
                reasons = ", ".join(alert.reasons) or "Unknown breach"
                lines.append(f"- {alert.provider_name} ({alert.provider_id}): {reasons}")
                if alert.guardrail_hotspots:
                    lines.append("  Guardrail hotspots:")
                    for service_id, summary in alert.guardrail_hotspots.items():
                        detail = f"{summary.get('fail', 0)} fail / {summary.get('warn', 0)} warn"
                        lines.append(f"    • {service_id}: {detail}")
                if alert.rule_overrides:
                    lines.append("  Rule overrides triggering automation:")
                    for service_id, rules in alert.rule_overrides.items():
                        if not rules:
                            continue
                        best = ", ".join(
                            f"{rule.get('label') or rule.get('id')} ({rule.get('count', 0)})" for rule in rules
                        )
                        lines.append(f"    • {service_id}: {best}")
                lines.append("")

        if load_alerts:
            lines.append("Preset/provider cohort pressure detected:")
            lines.append("")
            for alert in load_alerts:
                short_pct = f"{alert.short_share * 100:.1f}%"
                long_pct = f"{alert.long_share * 100:.1f}%"
                lines.append(
                    f"- {alert.provider_name or alert.provider_id} dominating "
                    f"{alert.preset_label or alert.preset_id} ({short_pct} vs {long_pct} baseline)"
                )
                lines.append(
                    f"  Window {alert.short_window_days}d vs {alert.long_window_days}d · "
                    f"{alert.short_engagements} vs {alert.long_engagements} engagements"
                )
                if alert.short_amount_total:
                    currency = alert.currency or "USD"
                    lines.append(
                        f"  Provider spend {currency} "
                        f"{alert.short_amount_total:,.0f} short / {alert.long_amount_total:,.0f} long"
                    )
                if alert.service_action:
                    lines.append(f"  Service {alert.service_id or '-'} · {alert.service_action}")
                link_lines = []
                if alert.merchandising_url:
                    link_lines.append(f"Merchandising: {alert.merchandising_url}")
                if alert.fulfillment_url:
                    link_lines.append(f"Fulfillment: {alert.fulfillment_url}")
                if alert.orders_url:
                    link_lines.append(f"Orders: {alert.orders_url}")
                if link_lines:
                    lines.append("  Links:")
                    for link in link_lines:
                        lines.append(f"    • {link}")
                lines.append("")

        if auto_actions:
            lines.append("Automation guardrail actions taken automatically:")
            lines.append("")
            for action in auto_actions:
                scope = f"{action['provider_name']} ({action['provider_id']})"
                label = "Paused" if action["action"] == "pause" else "Resumed"
                reason_label = ", ".join(action["reasons"]) if action["reasons"] else action.get("notes")
                if reason_label:
                    lines.append(f"- {label}: {scope} — {reason_label}")
                else:
                    lines.append(f"- {label}: {scope}")
                link = self._build_provider_admin_url(action["provider_id"])
                if link:
                    lines.append(f"  Dashboard: {link}")
            lines.append("")
        workflow_lines = self._format_workflow_summary(workflow_summary)
        if workflow_lines:
            lines.append("Guardrail workflow telemetry snapshot:")
            for entry in workflow_lines:
                lines.append(f"- {entry}")
            lines.append("")

        if not lines:
            return
        lines.append("Investigate these providers before rerunning automated fulfillments.")
        body_text = "\n".join(lines)

        for recipient in recipients:
            try:
                await backend.send_email(recipient, subject, body_text)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "Provider automation alert email failed",
                    recipient=recipient,
                    error=str(exc),
                )

    async def _notify_slack(
        self,
        alerts: Sequence[ProviderAutomationAlert],
        load_alerts: Sequence[ProviderLoadAlert],
        auto_actions: Sequence[dict[str, Any]],
        workflow_summary: Mapping[str, Any] | None,
    ) -> None:
        webhook = self._settings.provider_automation_alert_slack_webhook_url
        if not webhook:
            return

        platform_contexts, conversion_snapshot_payload = await asyncio.gather(
            self._fetch_platform_contexts(alerts),
            self._fetch_conversion_snapshot(limit=3),
        )
        conversion_snapshot, conversion_cursor = conversion_snapshot_payload
        text_lines: list[str] = []
        if alerts:
            text_lines.append(":warning: Provider automation alerts detected")
            for alert in alerts:
                reasons = ", ".join(alert.reasons) or "Unknown breach"
                text_lines.append(f"• {alert.provider_name} ({alert.provider_id}) — {reasons}")
                contexts = platform_contexts.get(alert.provider_id)
                if contexts:
                    text_lines.append(f"    contexts: {', '.join(contexts)}")
        if auto_actions:
            text_lines.append(":robot_face: Guardrail playbook actions")
            for action in auto_actions:
                provider = f"{action['provider_name']} ({action['provider_id']})"
                verb = "Auto-pause" if action["action"] == "pause" else "Auto-resume"
                reasons = ", ".join(action["reasons"]) if action["reasons"] else action.get("notes")
                line = f"• {verb} — {provider}"
                if reasons:
                    line += f" — {reasons}"
                text_lines.append(line)
                link = self._build_provider_admin_url(action["provider_id"])
                if link:
                    text_lines.append(f"    <{link}|Open automation tab>")
        if load_alerts:
            text_lines.append(":bar_chart: Provider cohort pressure detected")
            for alert in load_alerts:
                short_pct = f"{alert.short_share * 100:.0f}%"
                long_pct = f"{alert.long_share * 100:.0f}%"
                text_lines.append(
                    f"• {alert.provider_name or alert.provider_id} / {alert.preset_label or alert.preset_id} "
                    f"{short_pct} vs {long_pct} baseline"
                )
                link_tokens: list[str] = []
                if alert.merchandising_url:
                    link_tokens.append(f"<{alert.merchandising_url}|Merchandising>")
                if alert.fulfillment_url:
                    link_tokens.append(f"<{alert.fulfillment_url}|Fulfillment>")
                if alert.orders_url:
                    link_tokens.append(f"<{alert.orders_url}|Orders>")
                if link_tokens:
                    text_lines.append("    " + " · ".join(link_tokens))
        workflow_lines = self._format_workflow_summary(workflow_summary)
        if workflow_lines:
            text_lines.append(":clipboard: Workflow telemetry snapshot")
            for entry in workflow_lines:
                text_lines.append(f"    {entry}")
        if conversion_snapshot:
            text_lines.append(":moneybag: Experiment conversion impact")
            for metric in conversion_snapshot:
                text_lines.append("    " + self._format_conversion_line(metric))
            conversion_link = self._build_conversion_link(conversion_cursor)
            if conversion_link:
                label = "Historical conversions" if conversion_cursor else "Live conversions"
                cursor_hint = f" (cursor {conversion_cursor})" if conversion_cursor else ""
                text_lines.append(f"    {label}: <{conversion_link}|Open dashboard>{cursor_hint}")
        if not text_lines:
            return
        payload: dict[str, str] = {"text": "\n".join(text_lines)}
        channel = self._settings.provider_automation_alert_slack_channel
        if channel:
            payload["channel"] = channel

        close_client = False
        client = self._http_client
        if client is None:
            client = httpx.AsyncClient(timeout=10)
            close_client = True

        try:
            response = await client.post(webhook, json=payload)
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Provider automation alert slack dispatch failed", error=str(exc))
        finally:
            if close_client:
                await client.aclose()

    def _extract_auto_actions(self, summary: Mapping[str, Any] | None) -> list[dict[str, Any]]:
        if not summary:
            return []
        actions: list[dict[str, Any]] = []
        actions.extend(self._normalize_auto_action_list(summary.get("autoPausedProviders"), "pause"))
        actions.extend(self._normalize_auto_action_list(summary.get("autoResumedProviders"), "resume"))
        return actions

    def _normalize_auto_action_list(
        self,
        payload: Any,
        action: str,
    ) -> list[dict[str, Any]]:
        if not isinstance(payload, Iterable) or isinstance(payload, (str, bytes)):
            return []
        normalized: list[dict[str, Any]] = []
        for entry in payload:
            if not isinstance(entry, Mapping):
                continue
            provider_id_raw = entry.get("providerId")
            provider_id = str(provider_id_raw).strip() if provider_id_raw else ""
            if not provider_id:
                continue
            provider_name_raw = entry.get("providerName") or provider_id
            provider_name = str(provider_name_raw).strip() or provider_id
            reasons_raw = entry.get("reasons")
            reasons = [str(reason).strip() for reason in reasons_raw if str(reason).strip()] if isinstance(reasons_raw, Iterable) and not isinstance(reasons_raw, (str, bytes)) else []
            notes = entry.get("notes")
            normalized.append(
                {
                    "provider_id": provider_id,
                    "provider_name": provider_name,
                    "action": action,
                    "reasons": reasons,
                    "notes": notes if isinstance(notes, str) and notes.strip() else None,
                }
            )
        return normalized

    def _build_provider_admin_url(self, provider_id: str) -> str | None:
        base = (self._settings.frontend_url or "").strip()
        if not base:
            return None
        url = urljoin(base if base.endswith("/") else f"{base}/", f"admin/fulfillment/providers/{provider_id}?tab=automation")
        return url

    async def _fetch_platform_contexts(
        self,
        alerts: Sequence[ProviderAutomationAlert],
    ) -> dict[str, list[str]]:
        provider_ids = list({alert.provider_id for alert in alerts})
        if not provider_ids:
            return {}
        try:
            async with async_session() as session:  # type: ignore[arg-type]
                service = ProviderPlatformContextCacheService(session)
                mapping = await service.fetch_contexts_for_providers(provider_ids, limit_per_provider=3)
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to load cached platform contexts for alerts", error=str(exc))
            return {}
        formatted: dict[str, list[str]] = {}
        for provider_id, entries in mapping.items():
            labels = [self._format_platform_context(entry) for entry in entries if entry]
            if labels:
                formatted[provider_id] = labels
        return formatted

    async def _fetch_conversion_snapshot(self, limit: int = 3) -> tuple[list[ExperimentConversionDigest], str | None]:
        try:
            async with async_session() as session:  # type: ignore[arg-type]
                service = ExperimentAnalyticsService(session)
                snapshot = await service.fetch_conversion_snapshot(limit=limit)
                return snapshot.metrics, snapshot.cursor
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to load experiment conversion metrics for Slack digest", error=str(exc))
            return [], None

    @staticmethod
    def _format_currency_value(amount: float, currency: str | None) -> str:
        if amount <= 0:
            return "no revenue yet"
        code = currency or "USD"
        return f"{code} {amount:,.0f}"

    @staticmethod
    def _format_number(value: int) -> str:
        return f"{value:,}" if value else "0"

    def _format_conversion_line(self, metric: ExperimentConversionDigest) -> str:
        revenue = self._format_currency_value(metric.order_total, metric.order_currency)
        loyalty = self._format_number(metric.loyalty_points)
        last_seen = metric.last_activity.strftime("%b %d") if metric.last_activity else "n/a"
        return (
            f"{metric.slug}: {revenue} · "
            f"{metric.order_count} orders / {metric.journey_count} journeys · "
            f"{loyalty} pts · last {last_seen}"
        )

    def _build_conversion_link(self, cursor: str | None) -> str | None:
        base = (self._settings.frontend_url or "").strip()
        if not base:
            return None
        base = base.rstrip("/")
        if cursor:
            return f"{base}/admin/reports?conversionCursor={quote_plus(cursor)}#experiment-analytics"
        return f"{base}/admin/reports#experiment-analytics"

    @staticmethod
    def _format_platform_context(entry: ProviderPlatformContextRecord) -> string:
        details: list[str] = []
        if entry.handle and entry.handle not in entry.label:
            details.append(entry.handle)
        if entry.platform_type:
            details.append(entry.platform_type)
        if details:
            return f"{entry.label} ({', '.join(details)})"
        return entry.label

    def _format_workflow_summary(self, summary: Mapping[str, Any] | None) -> list[str]:
        if not summary or not isinstance(summary, Mapping):
            return []
        total_events = summary.get("totalEvents")
        attachment_totals = summary.get("attachmentTotals")
        action_counts = summary.get("actionCounts")
        lines: list[str] = []
        if isinstance(total_events, int):
            lines.append(f"Actions captured: {total_events}")
        if isinstance(attachment_totals, Mapping):
            uploads = attachment_totals.get("upload") or 0
            removals = attachment_totals.get("remove") or 0
            copies = attachment_totals.get("copy") or 0
            tags = attachment_totals.get("tag") or 0
            lines.append(f"Attachments — upload {uploads}, remove {removals}, copy {copies}, tag {tags}")
        if isinstance(action_counts, Sequence) and action_counts:
            top_entry = action_counts[0]
            if isinstance(top_entry, Mapping):
                action = top_entry.get("action")
                count = top_entry.get("count")
                if action and count is not None:
                    lines.append(f"Top action: {action} ({count})")
        last_capture = summary.get("lastCapturedAt")
        if isinstance(last_capture, str) and last_capture:
            lines.append(f"Last captured: {last_capture}")
        return lines

    @staticmethod
    def _build_email_backend(settings: Settings) -> EmailBackend | None:
        if not settings.smtp_host or not settings.smtp_sender_email:
            return None
        return SMTPEmailBackend(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
            sender_email=settings.smtp_sender_email,
        )


__all__ = [
    "ProviderAutomationAlert",
    "ProviderLoadAlert",
    "ProviderAutomationAlertEvaluator",
    "ProviderAutomationAlertNotifier",
]

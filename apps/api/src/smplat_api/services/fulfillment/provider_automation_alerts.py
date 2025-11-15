"""Alert evaluation + notification helpers for provider automation telemetry."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import httpx
from loguru import logger

from smplat_api.core.settings import Settings
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.notifications.backend import EmailBackend, SMTPEmailBackend


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
    ) -> None:
        load_alerts = load_alerts or []
        if not alerts and not load_alerts:
            return
        await asyncio.gather(
            self._notify_email(alerts, load_alerts),
            self._notify_slack(alerts, load_alerts),
        )

    async def _notify_email(
        self,
        alerts: Sequence[ProviderAutomationAlert],
        load_alerts: Sequence[ProviderLoadAlert],
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
    ) -> None:
        webhook = self._settings.provider_automation_alert_slack_webhook_url
        if not webhook:
            return

        text_lines: list[str] = []
        if alerts:
            text_lines.append(":warning: Provider automation alerts detected")
            for alert in alerts:
                reasons = ", ".join(alert.reasons) or "Unknown breach"
                text_lines.append(f"• {alert.provider_name} ({alert.provider_id}) — {reasons}")
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

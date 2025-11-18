from __future__ import annotations

import httpx
from urllib.parse import quote_plus

from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.models.provider_guardrail_followup import ProviderGuardrailFollowUp
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.services.provider_telemetry import (
    GuardrailSummary,
    ProviderAutomationTelemetrySummary,
    RuleOverrideServiceSummary,
)


class GuardrailFollowUpNotifier:
    """Dispatches Slack notifications when guardrail follow-ups are recorded."""

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http_client = http_client
        self._webhook = settings.provider_automation_alert_slack_webhook_url
        self._channel = settings.provider_automation_alert_slack_channel
        self._frontend_url = (settings.frontend_url or "").rstrip("/")

    async def notify(
        self,
        *,
        entry: ProviderGuardrailFollowUp,
        status: ProviderGuardrailStatus | None,
        conversion_cursor: str | None = None,
        conversion_href: str | None = None,
        telemetry_summary: ProviderAutomationTelemetrySummary | None = None,
    ) -> None:
        if not self._webhook:
            return

        action_label = entry.action.replace("_", " ").title()
        provider_label = entry.provider_name or entry.provider_id
        notes = entry.notes.strip() if entry.notes else "No notes provided."
        paused_state = None
        if status is not None:
            paused_state = "Paused" if status.is_paused else "Active"

        text_lines = [
            f":warning: Guardrail follow-up recorded for *{provider_label}* (`{entry.provider_id}`)",
            f"• Action: *{action_label}*",
            f"• Notes: {notes}",
        ]
        attachments = self._format_attachments(entry)
        if attachments:
            text_lines.append(f"• Attachments: {attachments}")
        if paused_state:
            text_lines.append(f"• Status: *{paused_state}*")
        platform_label = self._format_platform_context(entry)
        if platform_label:
            text_lines.append(f"• Context: {platform_label}")
        text_lines.append(self._build_provider_link(entry.provider_id))
        if telemetry_summary:
            text_lines.extend(self._format_telemetry_summary(telemetry_summary))

        link = conversion_href or self._build_conversion_link(conversion_cursor)
        if link:
            label = "Historical conversion slice" if conversion_cursor else "Live conversion snapshot"
            cursor_hint = f" (cursor {conversion_cursor})" if conversion_cursor else ""
            text_lines.append(f"• {label}: <{link}|Open conversions>{cursor_hint}")

        payload: dict[str, str] = {"text": "\n".join(text_lines)}
        if self._channel:
            payload["channel"] = self._channel

        close_client = False
        client = self._http_client
        if client is None:
            client = httpx.AsyncClient(timeout=10)
            close_client = True

        try:
            response = await client.post(self._webhook, json=payload)
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Guardrail follow-up Slack dispatch failed", error=str(exc))
        finally:
            if close_client:
                await client.aclose()

    @staticmethod
    def _format_telemetry_summary(telemetry: ProviderAutomationTelemetrySummary) -> list[str]:
        lines = [":bar_chart: Provider automation telemetry"]
        lines.append(f"• Routed orders: {telemetry.total_orders}")
        replay = telemetry.replays
        if replay.total or replay.scheduled:
            lines.append(
                f"• Replays executed {replay.executed}/{replay.total} · Failed {replay.failed} · Scheduled {replay.scheduled}"
            )
        guardrail = telemetry.guardrails
        if guardrail.evaluated:
            lines.append(
                f"• Guardrail checks {guardrail.evaluated}: pass {guardrail.passed} · warn {guardrail.warned} · fail {guardrail.failed}"
            )
        hotspots = _select_guardrail_hotspots(telemetry.guardrail_hits_by_service)
        if hotspots:
            lines.append(f"• Services under watch: {', '.join(hotspots)}")
        overrides = _select_rule_override_hotspots(telemetry.rule_overrides_by_service)
        if overrides:
            lines.append(f"• Rule overrides triggered: {', '.join(overrides)}")
        return lines

    def _build_provider_link(self, provider_id: str) -> str:
        return f"<{self._frontend_url}/admin/fulfillment/providers/{provider_id}?tab=automation|Open dashboard>"

    def _build_conversion_link(self, cursor: str | None) -> str | None:
        base = self._frontend_url
        if not base:
            return None
        if cursor:
            return f"{base}/admin/reports?conversionCursor={quote_plus(cursor)}#experiment-analytics"
        return f"{base}/admin/reports#experiment-analytics"

    @staticmethod
    def _format_platform_context(entry: ProviderGuardrailFollowUp) -> str | None:
        context = entry.platform_context or {}
        label = context.get("label")
        handle = context.get("handle")
        if not label and not handle:
            return None
        if label and handle:
            return f"{label} ({handle})"
        return str(label or handle)

    @staticmethod
    def _format_attachments(entry: ProviderGuardrailFollowUp) -> str | None:
        attachments = entry.attachments or []
        if not isinstance(attachments, list):
            return None
        labels: list[str] = []
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            name = attachment.get("fileName") or attachment.get("file_name") or attachment.get("assetUrl")
            url = attachment.get("assetUrl")
            if name and url:
                labels.append(f"<{url}|{name}>")
            elif name:
                labels.append(str(name))
        if not labels:
            return None
        return ", ".join(labels[:5])


def _select_guardrail_hotspots(
    summary_map: dict[str, GuardrailSummary],
    limit: int = 3,
) -> list[str]:
    scored = sorted(
        summary_map.items(),
        key=lambda item: (item[1].failed, item[1].warned, item[1].passed),
        reverse=True,
    )
    hotspots: list[str] = []
    for service_id, summary in scored[:limit]:
        if summary.failed == 0 and summary.warned == 0:
            continue
        hotspots.append(f"{service_id} (warn {summary.warned}, fail {summary.failed})")
    return hotspots


def _select_rule_override_hotspots(
    summary_map: dict[str, RuleOverrideServiceSummary],
    limit: int = 3,
) -> list[str]:
    scored = sorted(
        summary_map.items(),
        key=lambda item: item[1].total_overrides,
        reverse=True,
    )
    overrides: list[str] = []
    for service_id, summary in scored[:limit]:
        if summary.total_overrides <= 0:
            continue
        overrides.append(f"{service_id} ({summary.total_overrides})")
    return overrides


__all__ = ["GuardrailFollowUpNotifier"]

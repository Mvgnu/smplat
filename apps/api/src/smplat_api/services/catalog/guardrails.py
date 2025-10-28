"""Guardrail alert helpers for bundle experimentation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

import httpx
from loguru import logger

from smplat_api.core.settings import Settings
from smplat_api.services.notifications.backend import EmailBackend, SMTPEmailBackend


@dataclass(slots=True)
class ExperimentGuardrailAlert:
    """Alert payload surfaced to operators when guardrails breach."""

    experiment_slug: str
    variant_key: str
    bundle_slug: str | None
    breaches: Sequence[str]
    latest_metric: dict[str, Any] | None
    triggered_at: datetime


class ExperimentGuardrailNotifier:
    """Dispatch guardrail alerts over configured operator channels."""

    # meta: provenance: bundle-experiments

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

    async def notify(self, alerts: Iterable[ExperimentGuardrailAlert]) -> None:
        """Send notifications for the provided guardrail alerts."""

        alerts_list = list(alerts)
        if not alerts_list:
            return

        tasks = [
            self._notify_email(alerts_list),
            self._notify_slack(alerts_list),
        ]
        await asyncio.gather(*tasks)

    async def _notify_email(self, alerts: list[ExperimentGuardrailAlert]) -> None:
        recipients = self._settings.bundle_experiment_guardrail_email_recipients
        backend = self._email_backend
        if not recipients or backend is None:
            return

        subject = "Bundle experiment guardrail triggered"
        lines = [
            "The following experiments breached configured guardrails:",
            "",
        ]
        for alert in alerts:
            metric = alert.latest_metric or {}
            acceptance = metric.get("acceptance_rate")
            sample = metric.get("sample_size")
            lines.append(
                f"- {alert.experiment_slug} • variant {alert.variant_key} (bundle {alert.bundle_slug or 'n/a'})"
            )
            lines.append(f"  Breaches: {', '.join(alert.breaches)}")
            if acceptance is not None or sample is not None:
                lines.append(
                    f"  Acceptance: {acceptance} | Sample Size: {sample}"
                )
            lines.append("")
        lines.append("Experiments have been paused automatically. Review overrides before re-enabling.")
        body_text = "\n".join(lines)

        for recipient in recipients:
            try:
                await backend.send_email(
                    recipient,
                    subject,
                    body_text,
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "Guardrail email dispatch failed",
                    recipient=recipient,
                    error=str(exc),
                )

    async def _notify_slack(self, alerts: list[ExperimentGuardrailAlert]) -> None:
        webhook = self._settings.bundle_experiment_guardrail_slack_webhook_url
        if not webhook:
            return

        text_lines = [":warning: Bundle experiment guardrail triggered"]
        for alert in alerts:
            breaches = ", ".join(alert.breaches)
            text_lines.append(
                f"• {alert.experiment_slug} → variant {alert.variant_key} ({breaches or 'unknown breach'})"
            )
        payload: dict[str, Any] = {"text": "\n".join(text_lines)}
        channel = self._settings.bundle_experiment_guardrail_slack_channel
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
            logger.exception("Guardrail slack webhook failed", error=str(exc))
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


def build_alerts(payload: dict[str, Any]) -> list[ExperimentGuardrailAlert]:
    """Convert guardrail evaluation payload into alert envelopes."""

    experiment = str(payload.get("experiment"))
    evaluated_at = payload.get("evaluated_at")
    if not isinstance(evaluated_at, datetime):
        evaluated_at = datetime.now(timezone.utc)

    alerts: list[ExperimentGuardrailAlert] = []
    breaches_payload = payload.get("breaches")
    if not isinstance(breaches_payload, Iterable):
        return alerts

    for entry in breaches_payload:
        if not isinstance(entry, dict):
            continue
        breaches = entry.get("breaches")
        if not breaches:
            continue
        variant_key = str(entry.get("variant_key"))
        latest_metric = entry.get("latest_metric")
        bundle_slug = entry.get("bundle_slug")
        alerts.append(
            ExperimentGuardrailAlert(
                experiment_slug=experiment,
                variant_key=variant_key,
                bundle_slug=bundle_slug if isinstance(bundle_slug, str) else None,
                breaches=[str(breach) for breach in breaches],
                latest_metric=latest_metric if isinstance(latest_metric, dict) else None,
                triggered_at=evaluated_at,
            )
        )
    return alerts


__all__ = [
    "ExperimentGuardrailAlert",
    "ExperimentGuardrailNotifier",
    "build_alerts",
]

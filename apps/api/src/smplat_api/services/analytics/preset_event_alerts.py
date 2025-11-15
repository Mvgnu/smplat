"""Preset analytics alert dispatch helpers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Awaitable, Callable, Iterable, Mapping, Sequence

import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import Settings, settings as app_settings
from smplat_api.models.preset_event_alert_run import PresetEventAlertRun
from smplat_api.services.analytics.preset_events import PresetEventAnalyticsService
from smplat_api.services.notifications.backend import EmailBackend, SMTPEmailBackend


SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


@dataclass(slots=True)
class PresetEventAlert:
    """Normalized preset alert payload."""

    code: str
    severity: str
    message: str
    metrics: dict[str, Any]

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "PresetEventAlert":
        metrics = payload.get("metrics")
        normalized_metrics = dict(metrics) if isinstance(metrics, Mapping) else {}
        return cls(
            code=str(payload.get("code") or "unknown"),
            severity=str(payload.get("severity") or "info"),
            message=str(payload.get("message") or ""),
            metrics=normalized_metrics,
        )


class PresetEventAlertNotifier:
    """Dispatch preset analytics alerts through configured channels."""

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

    async def notify(self, alerts: Sequence[PresetEventAlert], *, summary: Mapping[str, Any]) -> None:
        """Send alerts over available transports."""

        alerts_list = list(alerts)
        if not alerts_list:
            return

        tasks = []
        if self._settings.preset_event_alert_email_recipients and self._email_backend:
            tasks.append(self._notify_email(alerts_list, summary))
        if self._settings.preset_event_alert_slack_webhook_url:
            tasks.append(self._notify_slack(alerts_list, summary))
        if tasks:
            await asyncio.gather(*tasks)

    async def _notify_email(self, alerts: Sequence[PresetEventAlert], summary: Mapping[str, Any]) -> None:
        recipients = self._settings.preset_event_alert_email_recipients
        backend = self._email_backend
        if not recipients or backend is None:
            return

        subject = "Preset analytics alert notification"
        lines = [
            "Preset analytics triggered the following alerts:",
            f"- Window: {self._format_window(summary)}",
            "",
        ]
        for alert in alerts:
            metrics_line = ", ".join(f"{key}={value}" for key, value in alert.metrics.items())
            lines.append(f"* [{alert.severity}] {alert.code}: {alert.message}")
            if metrics_line:
                lines.append(f"    metrics: {metrics_line}")
        lines.append("")
        lines.append(f"Dashboard: {self._settings.frontend_url}/admin/merchandising")
        body_text = "\n".join(lines)

        for recipient in recipients:
            try:
                await backend.send_email(recipient, subject, body_text)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Preset alert email dispatch failed", recipient=recipient, error=str(exc))

    async def _notify_slack(self, alerts: Sequence[PresetEventAlert], summary: Mapping[str, Any]) -> None:
        webhook = self._settings.preset_event_alert_slack_webhook_url
        if not webhook:
            return

        text_lines = [
            ":warning: Preset analytics alert triggered",
            f"Window: {self._format_window(summary)}",
        ]
        for alert in alerts:
            metrics_line = ", ".join(f"{key}={value}" for key, value in alert.metrics.items())
            text_lines.append(f"• {alert.code} ({alert.severity}): {alert.message}")
            if metrics_line:
                text_lines.append(f"    {metrics_line}")
        payload: dict[str, Any] = {"text": "\n".join(text_lines)}
        channel = self._settings.preset_event_alert_slack_channel
        if channel:
            payload["channel"] = channel

        client = self._http_client
        close_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=10)
            close_client = True

        try:
            response = await client.post(webhook, json=payload)
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Preset alert Slack dispatch failed", error=str(exc))
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

    @staticmethod
    def _format_window(summary: Mapping[str, Any]) -> str:
        window = summary.get("window") or {}
        start = window.get("start")
        days = window.get("days")
        return f"{start or 'unknown'} ({days or '?'}d)"


class PresetEventAlertJob:
    """Coordinates preset analytics alert evaluation and notifications."""

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        notifier: PresetEventAlertNotifier | None = None,
        settings: Settings | None = None,
        window_days: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings or app_settings
        configured_window = window_days or self._settings.preset_event_alert_window_days
        self._window_days = max(1, min(int(configured_window), 90))
        self._notifier = notifier or PresetEventAlertNotifier(self._settings)

    async def run_once(self) -> dict[str, Any]:
        """Execute a single preset alert evaluation pass."""

        session = await self._ensure_session()
        async with session as db:
            service = PresetEventAnalyticsService(db)
            summary = await service.fetch_summary(window_days=self._window_days)
            alerts_payload = summary.get("alerts") or []
            alerts = [PresetEventAlert.from_payload(entry) for entry in alerts_payload]
            alerts_sent = 0
            status = "success"
            error_message: str | None = None

            if alerts and self._settings.preset_event_alert_notifications_enabled:
                try:
                    await self._notifier.notify(alerts, summary=summary)
                    alerts_sent = len(alerts)
                except Exception as exc:  # pragma: no cover - defensive logging
                    status = "error"
                    error_message = str(exc)
                    logger.exception("Preset event alert notification failed", error=error_message)

            run = await self._record_run(
                db,
                summary=summary,
                alerts=alerts,
                alerts_sent=alerts_sent,
                status=status,
                error_message=error_message,
            )
            return {
                "alerts": len(alerts),
                "alertsSent": alerts_sent,
                "status": status,
                "runId": str(run.id),
                "window": summary.get("window"),
            }

    async def _record_run(
        self,
        session: AsyncSession,
        *,
        summary: Mapping[str, Any],
        alerts: Sequence[PresetEventAlert],
        alerts_sent: int,
        status: str,
        error_message: str | None,
    ) -> PresetEventAlertRun:
        window = summary.get("window") or {}
        window_days = int(window.get("days") or self._window_days)
        window_start = self._resolve_window_start(window.get("start"), window_days)
        run = PresetEventAlertRun(
            status=status,
            window_start_date=window_start,
            window_days=window_days,
            alerts_sent=alerts_sent,
            alert_codes=[alert.code for alert in alerts],
            summary=dict(summary),
            error_message=error_message,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return run

    @staticmethod
    def _resolve_window_start(start_value: Any, window_days: int) -> date:
        if isinstance(start_value, date):
            return start_value
        if isinstance(start_value, str):
            try:
                return date.fromisoformat(start_value)
            except ValueError:
                pass
        days = max(1, window_days)
        return date.today() - timedelta(days=days - 1)

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session


__all__ = [
    "PresetEventAlert",
    "PresetEventAlertJob",
    "PresetEventAlertNotifier",
]

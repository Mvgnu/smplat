"""Hosted checkout session recovery automation communications."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Iterable, Mapping

import httpx
from loguru import logger

from smplat_api.models.hosted_checkout_session import HostedCheckoutSession

if TYPE_CHECKING:
    from smplat_api.core.settings import Settings

RecoveryAttempt = Mapping[str, Any]
NotificationCallable = Callable[[HostedCheckoutSession, RecoveryAttempt, str], Any]


@dataclass(slots=True)
class RecoveryNotificationContext:
    """Structured notification payload for analytics and auditing."""

    channel: str
    template: str
    notified_at: datetime


@dataclass(slots=True)
class RecoveryNotificationResult:
    """Outcome details from a notification dispatch."""

    delivered: bool
    provider: str


class HostedSessionRecoveryCommunicator:
    """Coordinates outbound messaging for hosted session recovery automation."""

    # meta: hosted-session: recovery-communicator

    def __init__(
        self,
        *,
        email_sender: NotificationCallable | None = None,
        sms_sender: NotificationCallable | None = None,
    ) -> None:
        self._email_sender = email_sender or self._log_email_dispatch
        self._sms_sender = sms_sender or self._log_sms_dispatch
        self._email_provider_label = "custom-email" if email_sender else "stub-email"
        self._sms_provider_label = "custom-sms" if sms_sender else "stub-sms"

    @classmethod
    def from_settings(
        cls,
        settings: "Settings",
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> "HostedSessionRecoveryCommunicator":
        """Construct a communicator wired to configured providers with graceful fallbacks."""

        communicator = cls()
        communicator._email_provider_label = "stub-email"
        communicator._sms_provider_label = "stub-sms"

        async def email_sender(
            session: HostedCheckoutSession,
            attempt: RecoveryAttempt,
            template: str,
        ) -> dict[str, Any]:
            if not settings.hosted_recovery_email_enabled:
                return await communicator._log_email_dispatch(session, attempt, template)

            recipients = settings.hosted_recovery_email_recipients
            sender = settings.sendgrid_sender_email
            api_key = settings.sendgrid_api_key

            if not recipients or not sender or not api_key:
                logger.warning(
                    "Hosted session recovery email dispatch fallback",
                    reason="sendgrid configuration incomplete",
                )
                return await communicator._log_email_dispatch(session, attempt, template)

            subject = (
                f"Hosted recovery attempt {attempt.get('attempt')} for session {session.session_id}"
            )
            next_retry = attempt.get("next_retry_at", "unknown")
            invoice_id = getattr(session, "invoice_id", "")
            body_lines = [
                f"Session ID: {session.session_id}",
                f"Invoice ID: {invoice_id}",
                f"Status: {attempt.get('status')}",
                f"Attempt: {attempt.get('attempt')}",
                f"Next Retry At: {next_retry}",
            ]
            workspace = getattr(session, "workspace_id", None)
            if workspace:
                body_lines.append(f"Workspace: {workspace}")
            if session.invoice and getattr(session.invoice, "invoice_number", None):
                body_lines.append(f"Invoice Number: {session.invoice.invoice_number}")

            payload = {
                "personalizations": [
                    {
                        "to": [{"email": email} for email in recipients],
                        "subject": subject,
                    }
                ],
                "from": {"email": sender},
                "content": [
                    {
                        "type": "text/plain",
                        "value": "\n".join(body_lines),
                    }
                ],
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            close_client = False
            client = http_client
            if client is None:
                client = httpx.AsyncClient(timeout=10)
                close_client = True

            try:
                response = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                communicator._email_provider_label = "sendgrid"
                return {"provider": "sendgrid", "delivered": True}
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "SendGrid recovery notification failed",
                    error=str(exc),
                )
                return await communicator._log_email_dispatch(session, attempt, template)
            finally:
                if close_client:
                    await client.aclose()

        async def slack_sender(
            session: HostedCheckoutSession,
            attempt: RecoveryAttempt,
            template: str,
        ) -> dict[str, Any]:
            if not settings.hosted_recovery_slack_enabled or not settings.hosted_recovery_slack_webhook_url:
                return await communicator._log_sms_dispatch(session, attempt, template)

            text = (
                f"Hosted checkout session {session.session_id} needs attention. "
                f"Status: {attempt.get('status')} | Attempt: {attempt.get('attempt')}"
            )
            link_hint = attempt.get("next_retry_at")
            if link_hint:
                text += f" | Next retry at {link_hint}"

            payload: dict[str, Any] = {"text": text}
            if settings.hosted_recovery_slack_channel:
                payload["channel"] = settings.hosted_recovery_slack_channel

            close_client = False
            client = http_client
            if client is None:
                client = httpx.AsyncClient(timeout=10)
                close_client = True

            try:
                response = await client.post(
                    settings.hosted_recovery_slack_webhook_url,
                    json=payload,
                )
                response.raise_for_status()
                communicator._sms_provider_label = "slack-webhook"
                return {"provider": "slack-webhook", "delivered": True}
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception(
                    "Slack webhook recovery notification failed",
                    error=str(exc),
                )
                return await communicator._log_sms_dispatch(session, attempt, template)
            finally:
                if close_client:
                    await client.aclose()

        communicator._email_sender = email_sender
        communicator._sms_sender = slack_sender
        return communicator

    def should_notify(
        self,
        session: HostedCheckoutSession,
        *,
        prior_attempts: Iterable[RecoveryAttempt],
        current_attempt: RecoveryAttempt,
    ) -> bool:
        """Return True when a state transition merits operator notification."""

        attempts = list(prior_attempts)
        if not attempts:
            return True

        previous = attempts[-1]
        if previous.get("status") != current_attempt.get("status"):
            return True

        metadata = session.metadata_json or {}
        last_notified_raw = metadata.get("last_notified_at")
        if not last_notified_raw:
            return True

        try:
            last_notified = _parse_iso_datetime(last_notified_raw)
        except ValueError:
            return True

        # Notify again if more than six hours have passed since the last alert.
        return datetime.now(timezone.utc) - last_notified >= timedelta(hours=6)

    async def dispatch_notification(
        self,
        session: HostedCheckoutSession,
        attempt: RecoveryAttempt,
    ) -> RecoveryNotificationResult:
        """Send structured notifications for the provided attempt."""

        channel = "email" if attempt.get("attempt", 1) < 3 else "sms"
        template = "billing/session-recovery/state-change"
        payload = RecoveryNotificationContext(
            channel=channel,
            template=template,
            notified_at=datetime.now(timezone.utc),
        )

        provider_label = (
            self._email_provider_label if channel == "email" else self._sms_provider_label
        )

        sender = self._email_sender if channel == "email" else self._sms_sender
        result = await _maybe_await(sender(session, attempt, template))
        delivered = True
        if isinstance(result, dict):
            provider_label = result.get("provider", provider_label)
            delivered = bool(result.get("delivered", delivered))
        elif isinstance(result, str):
            provider_label = result
        elif isinstance(result, bool):
            delivered = result

        metadata = dict(session.metadata_json or {})
        communication_log = list(metadata.get("communication_log", []))
        communication_log.append(
            {
                "channel": payload.channel,
                "template": payload.template,
                "notified_at": payload.notified_at.isoformat(),
                "attempt": attempt.get("attempt"),
                "status": attempt.get("status"),
                "provider": provider_label,
            }
        )
        metadata["communication_log"] = communication_log[-50:]
        session.metadata_json = metadata
        return RecoveryNotificationResult(delivered=delivered, provider=provider_label)

    async def _log_email_dispatch(
        self,
        session: HostedCheckoutSession,
        attempt: RecoveryAttempt,
        template: str,
    ) -> dict[str, Any]:
        """Fallback email sender that records structured metadata."""

        metadata = dict(session.metadata_json or {})
        log = list(metadata.get("email_stub_log", []))
        log.append(
            {
                "template": template,
                "attempt": attempt.get("attempt"),
                "status": attempt.get("status"),
            }
        )
        metadata["email_stub_log"] = log[-20:]
        session.metadata_json = metadata
        return {"provider": "stub-email", "delivered": True}

    async def _log_sms_dispatch(
        self,
        session: HostedCheckoutSession,
        attempt: RecoveryAttempt,
        template: str,
    ) -> dict[str, Any]:
        """Fallback SMS sender that records structured metadata."""

        metadata = dict(session.metadata_json or {})
        log = list(metadata.get("sms_stub_log", []))
        log.append(
            {
                "template": template,
                "attempt": attempt.get("attempt"),
                "status": attempt.get("status"),
            }
        )
        metadata["sms_stub_log"] = log[-20:]
        session.metadata_json = metadata
        return {"provider": "stub-sms", "delivered": True}


def _parse_iso_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _maybe_await(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value  # type: ignore[func-returns-value]
    return value

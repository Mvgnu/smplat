"""Hosted checkout session recovery automation communications."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping

from smplat_api.models.hosted_checkout_session import HostedCheckoutSession

RecoveryAttempt = Mapping[str, Any]
NotificationCallable = Callable[[HostedCheckoutSession, RecoveryAttempt, str], Any]


@dataclass(slots=True)
class RecoveryNotificationContext:
    """Structured notification payload for analytics and auditing."""

    channel: str
    template: str
    notified_at: datetime


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
    ) -> bool:
        """Send structured notifications for the provided attempt."""

        channel = "email" if attempt.get("attempt", 1) < 3 else "sms"
        template = "billing/session-recovery/state-change"
        payload = RecoveryNotificationContext(
            channel=channel,
            template=template,
            notified_at=datetime.now(timezone.utc),
        )

        if channel == "email":
            await _maybe_await(self._email_sender(session, attempt, template))
        else:
            await _maybe_await(self._sms_sender(session, attempt, template))

        metadata = dict(session.metadata_json or {})
        communication_log = list(metadata.get("communication_log", []))
        communication_log.append(
            {
                "channel": payload.channel,
                "template": payload.template,
                "notified_at": payload.notified_at.isoformat(),
                "attempt": attempt.get("attempt"),
                "status": attempt.get("status"),
            }
        )
        metadata["communication_log"] = communication_log[-50:]
        session.metadata_json = metadata
        return True

    async def _log_email_dispatch(
        self,
        session: HostedCheckoutSession,
        attempt: RecoveryAttempt,
        template: str,
    ) -> None:
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

    async def _log_sms_dispatch(
        self,
        session: HostedCheckoutSession,
        attempt: RecoveryAttempt,
        template: str,
    ) -> None:
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


async def _maybe_await(value: Any) -> None:
    if hasattr(value, "__await__"):
        await value  # type: ignore[func-returns-value]


def _parse_iso_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)

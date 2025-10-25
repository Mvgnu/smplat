"""In-memory observability helper for checkout + Stripe webhook flows."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Dict


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CheckoutEventLog:
    last_success_at: datetime | None = None
    last_success_payment_id: str | None = None
    last_failure_at: datetime | None = None
    last_failure_reason: str | None = None


@dataclass
class WebhookEventLog:
    last_event_at: datetime | None = None
    last_event_type: str | None = None
    last_event_delivery_id: str | None = None
    last_failure_at: datetime | None = None
    last_failure_type: str | None = None
    last_failure_reason: str | None = None


@dataclass
class PaymentObservabilitySnapshot:
    checkout_totals: Dict[str, int]
    webhook_totals: Dict[str, Dict[str, int]]
    checkout_events: CheckoutEventLog
    webhook_events: WebhookEventLog

    def as_dict(self) -> Dict[str, object]:
        return {
            "checkout": {
                "totals": self.checkout_totals,
                "events": {
                    "last_success_at": self.checkout_events.last_success_at.isoformat()
                    if self.checkout_events.last_success_at
                    else None,
                    "last_success_payment_id": self.checkout_events.last_success_payment_id,
                    "last_failure_at": self.checkout_events.last_failure_at.isoformat()
                    if self.checkout_events.last_failure_at
                    else None,
                    "last_failure_reason": self.checkout_events.last_failure_reason,
                },
            },
            "webhooks": {
                "totals": self.webhook_totals,
                "events": {
                    "last_event_at": self.webhook_events.last_event_at.isoformat()
                    if self.webhook_events.last_event_at
                    else None,
                    "last_event_type": self.webhook_events.last_event_type,
                    "last_event_delivery_id": self.webhook_events.last_event_delivery_id,
                    "last_failure_at": self.webhook_events.last_failure_at.isoformat()
                    if self.webhook_events.last_failure_at
                    else None,
                    "last_failure_type": self.webhook_events.last_failure_type,
                    "last_failure_reason": self.webhook_events.last_failure_reason,
                },
            },
        }


@dataclass
class PaymentObservabilityStore:
    _lock: Lock = field(default_factory=Lock)
    _checkout_totals: Counter = field(default_factory=Counter)
    _checkout_events: CheckoutEventLog = field(default_factory=CheckoutEventLog)
    _webhook_totals: Dict[str, Counter] = field(
        default_factory=lambda: {"processed": Counter(), "failed": Counter()}
    )
    _webhook_events: WebhookEventLog = field(default_factory=WebhookEventLog)

    def record_checkout_success(self, payment_id: str | None) -> None:
        with self._lock:
            self._checkout_totals["succeeded"] += 1
            self._checkout_events.last_success_at = _utcnow()
            self._checkout_events.last_success_payment_id = payment_id

    def record_checkout_failure(self, reason: str) -> None:
        with self._lock:
            self._checkout_totals["failed"] += 1
            self._checkout_events.last_failure_at = _utcnow()
            self._checkout_events.last_failure_reason = reason

    def record_webhook(self, event_type: str, success: bool, delivery_id: str | None, error: str | None) -> None:
        with self._lock:
            bucket = "processed" if success else "failed"
            self._webhook_totals[bucket][event_type] += 1
            now = _utcnow()
            self._webhook_events.last_event_at = now
            self._webhook_events.last_event_type = event_type
            self._webhook_events.last_event_delivery_id = delivery_id
            if not success:
                self._webhook_events.last_failure_at = now
                self._webhook_events.last_failure_type = event_type
                self._webhook_events.last_failure_reason = error

    def snapshot(self) -> PaymentObservabilitySnapshot:
        with self._lock:
            checkout_totals = dict(self._checkout_totals)
            webhook_totals = {bucket: dict(counter) for bucket, counter in self._webhook_totals.items()}
            checkout_events = CheckoutEventLog(
                last_success_at=self._checkout_events.last_success_at,
                last_success_payment_id=self._checkout_events.last_success_payment_id,
                last_failure_at=self._checkout_events.last_failure_at,
                last_failure_reason=self._checkout_events.last_failure_reason,
            )
            webhook_events = WebhookEventLog(
                last_event_at=self._webhook_events.last_event_at,
                last_event_type=self._webhook_events.last_event_type,
                last_event_delivery_id=self._webhook_events.last_event_delivery_id,
                last_failure_at=self._webhook_events.last_failure_at,
                last_failure_type=self._webhook_events.last_failure_type,
                last_failure_reason=self._webhook_events.last_failure_reason,
            )
        return PaymentObservabilitySnapshot(
            checkout_totals=checkout_totals,
            webhook_totals=webhook_totals,
            checkout_events=checkout_events,
            webhook_events=webhook_events,
        )

    def reset(self) -> None:
        with self._lock:
            self._checkout_totals.clear()
            for counter in self._webhook_totals.values():
                counter.clear()
            self._checkout_events = CheckoutEventLog()
            self._webhook_events = WebhookEventLog()


_PAYMENT_STORE = PaymentObservabilityStore()


def get_payment_store() -> PaymentObservabilityStore:
    return _PAYMENT_STORE

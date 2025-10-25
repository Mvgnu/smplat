"""In-memory fulfillment observability store for runtime metrics."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, Iterable


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class FulfillmentEventLog:
    """Stores details about noteworthy fulfillment events."""

    last_failure_at: datetime | None = None
    last_failure_message: str | None = None
    last_dead_letter_at: datetime | None = None
    last_dead_letter_task: str | None = None
    last_retry_scheduled_at: datetime | None = None
    last_retry_delay_seconds: int | None = None


@dataclass
class FulfillmentMetricsSnapshot:
    """Serializable snapshot returned to API consumers."""

    totals: Dict[str, int]
    per_type: Dict[str, Dict[str, int]]
    events: FulfillmentEventLog

    def as_dict(self) -> Dict[str, object]:
        return {
            "totals": self.totals,
            "per_task_type": self.per_type,
            "events": {
                "last_failure_at": self.events.last_failure_at.isoformat()
                if self.events.last_failure_at
                else None,
                "last_failure_message": self.events.last_failure_message,
                "last_dead_letter_at": self.events.last_dead_letter_at.isoformat()
                if self.events.last_dead_letter_at
                else None,
                "last_dead_letter_task": self.events.last_dead_letter_task,
                "last_retry_scheduled_at": self.events.last_retry_scheduled_at.isoformat()
                if self.events.last_retry_scheduled_at
                else None,
                "last_retry_delay_seconds": self.events.last_retry_delay_seconds,
            },
        }


@dataclass
class FulfillmentObservabilityStore:
    """Tracks fulfillment counters and recent events."""

    _lock: Lock = field(default_factory=Lock)
    _totals: Counter = field(default_factory=Counter)
    _per_type: Dict[str, Counter] = field(
        default_factory=lambda: {
            "processed": Counter(),
            "failed": Counter(),
            "retried": Counter(),
            "dead_lettered": Counter(),
        }
    )
    _events: FulfillmentEventLog = field(default_factory=FulfillmentEventLog)

    def record_processed(self, task_type: str) -> None:
        with self._lock:
            self._totals["processed"] += 1
            self._per_type["processed"][task_type] += 1

    def record_failure(self, task_type: str, error_message: str) -> None:
        with self._lock:
            self._totals["failed"] += 1
            self._per_type["failed"][task_type] += 1
            self._events.last_failure_at = _utcnow()
            self._events.last_failure_message = error_message

    def record_retry(self, task_type: str, next_run_at: datetime | None, delay_seconds: int) -> None:
        with self._lock:
            self._totals["retried"] += 1
            self._per_type["retried"][task_type] += 1
            self._events.last_retry_scheduled_at = next_run_at
            self._events.last_retry_delay_seconds = delay_seconds

    def record_dead_letter(self, task_type: str) -> None:
        with self._lock:
            self._totals["dead_lettered"] += 1
            self._per_type["dead_lettered"][task_type] += 1
            self._events.last_dead_letter_at = _utcnow()
            self._events.last_dead_letter_task = task_type

    def snapshot(self) -> FulfillmentMetricsSnapshot:
        with self._lock:
            totals = dict(self._totals)
            per_type = {key: dict(counter) for key, counter in self._per_type.items()}
            events_copy = FulfillmentEventLog(
                last_failure_at=self._events.last_failure_at,
                last_failure_message=self._events.last_failure_message,
                last_dead_letter_at=self._events.last_dead_letter_at,
                last_dead_letter_task=self._events.last_dead_letter_task,
                last_retry_scheduled_at=self._events.last_retry_scheduled_at,
                last_retry_delay_seconds=self._events.last_retry_delay_seconds,
            )
        return FulfillmentMetricsSnapshot(totals=totals, per_type=per_type, events=events_copy)

    def reset(self) -> None:
        with self._lock:
            self._totals.clear()
            for counter in self._per_type.values():
                counter.clear()
            self._events = FulfillmentEventLog()


_FULFILLMENT_STORE = FulfillmentObservabilityStore()


def get_fulfillment_store() -> FulfillmentObservabilityStore:
    return _FULFILLMENT_STORE


def merge_task_types(task_types: Iterable[str]) -> Dict[str, int]:
    counter: Counter[str] = Counter(task_types)
    return dict(counter)

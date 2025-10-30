from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from threading import Lock
from typing import Dict, Iterable


@dataclass
class LoyaltySnapshot:
    referrals: Dict[str, int]
    guardrails: Dict[str, int]
    nudges: Dict[str, Dict[str, int]]

    def as_dict(self) -> Dict[str, object]:
        return {
            "referrals": dict(self.referrals),
            "guardrails": dict(self.guardrails),
            "nudges": {key: dict(value) for key, value in self.nudges.items()},
        }


class LoyaltyObservabilityStore:
    """Collect loyalty pipeline telemetry for dashboards and alerting."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._referrals: Dict[str, int] = defaultdict(int)
        self._guardrails: Dict[str, int] = defaultdict(int)
        self._nudge_totals: Dict[str, int] = defaultdict(int)
        self._nudge_channels: Dict[str, int] = defaultdict(int)

    def record_referral_event(self, event: str) -> None:
        with self._lock:
            self._referrals[event] += 1

    def record_guardrail_override(self, scope: str) -> None:
        with self._lock:
            self._guardrails["total_overrides"] += 1
            scope_key = f"scope:{scope}"
            self._guardrails[scope_key] += 1

    def record_nudge_dispatch(self, nudge_type: str, channels: Iterable[str]) -> None:
        with self._lock:
            self._nudge_totals[nudge_type] += 1
            for channel in channels:
                channel_key = channel or "unknown"
                self._nudge_channels[channel_key] += 1

    def snapshot(self) -> LoyaltySnapshot:
        with self._lock:
            referrals = dict(self._referrals)
            guardrails = dict(self._guardrails)
            nudges = {
                "by_type": dict(self._nudge_totals),
                "by_channel": dict(self._nudge_channels),
            }
        return LoyaltySnapshot(referrals=referrals, guardrails=guardrails, nudges=nudges)

    def reset(self) -> None:
        with self._lock:
            self._referrals.clear()
            self._guardrails.clear()
            self._nudge_totals.clear()
            self._nudge_channels.clear()


_STORE = LoyaltyObservabilityStore()


def get_loyalty_store() -> LoyaltyObservabilityStore:
    return _STORE


__all__ = ["get_loyalty_store", "LoyaltyObservabilityStore", "LoyaltySnapshot"]

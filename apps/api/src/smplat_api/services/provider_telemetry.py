"""Helper utilities for summarizing provider automation telemetry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import FulfillmentProviderOrder


@dataclass
class ReplaySummary:
    total: int = 0
    executed: int = 0
    failed: int = 0
    scheduled: int = 0


@dataclass
class GuardrailSummary:
    evaluated: int = 0
    passed: int = 0
    warned: int = 0
    failed: int = 0


@dataclass
class RuleOverrideStat:
    label: str | None = None
    count: int = 0


@dataclass
class RuleOverrideServiceSummary:
    total_overrides: int = 0
    rules: dict[str, RuleOverrideStat] = field(default_factory=dict)


@dataclass
class ProviderAutomationTelemetrySummary:
    total_orders: int = 0
    replays: ReplaySummary = field(default_factory=ReplaySummary)
    guardrails: GuardrailSummary = field(default_factory=GuardrailSummary)
    guardrail_hits_by_service: dict[str, GuardrailSummary] = field(default_factory=dict)
    rule_overrides_by_service: dict[str, RuleOverrideServiceSummary] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def summarize_provider_orders(
    provider_orders: Sequence[FulfillmentProviderOrder],
) -> ProviderAutomationTelemetrySummary:
    summary = ProviderAutomationTelemetrySummary(total_orders=len(provider_orders))
    for provider_order in provider_orders:
        payload = provider_order.payload if isinstance(provider_order.payload, Mapping) else {}
        service_key = provider_order.service_id or provider_order.provider_id or "unknown"
        _apply_replay_stats(summary.replays, payload)
        _apply_scheduled_replays(summary.replays, payload)
        overrides = _extract_rule_overrides(payload)
        if overrides:
            bucket = summary.rule_overrides_by_service.setdefault(service_key, RuleOverrideServiceSummary())
            bucket.total_overrides += len(overrides)
            for entry in overrides:
                stat = bucket.rules.setdefault(entry["id"], RuleOverrideStat(label=entry.get("label")))
                stat.count += 1
        guardrails = _extract_guardrails(payload)
        provider_cost = _safe_number(payload.get("providerCostAmount"))
        customer_price = _safe_number(provider_order.amount)
        status = _evaluate_guardrail_status(guardrails, provider_cost, customer_price)
        if status == "idle":
            continue
        summary.guardrails.evaluated += 1
        target_summary = _ensure_guardrail_service_summary(summary.guardrail_hits_by_service, service_key)
        target_summary.evaluated += 1
        for container in (summary.guardrails, target_summary):
            if status == "fail":
                container.failed += 1
            elif status == "warn":
                container.warned += 1
            else:
                container.passed += 1
    return summary


async def load_provider_telemetry_summary(
    session: AsyncSession,
    provider_id: str,
    *,
    limit: int = 50,
) -> ProviderAutomationTelemetrySummary | None:
    """Return telemetry summary for recent orders routed to the provider."""

    stmt = (
        select(FulfillmentProviderOrder)
        .where(FulfillmentProviderOrder.provider_id == provider_id)
        .order_by(FulfillmentProviderOrder.created_at.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    orders = list(result.scalars())
    if not orders:
        return None
    summary = summarize_provider_orders(orders)
    if summary.total_orders == 0:
        return None
    return summary


def serialize_provider_automation_telemetry(
    summary: ProviderAutomationTelemetrySummary | None,
) -> dict[str, Any] | None:
    """Convert telemetry summary into camelCase payloads for downstream consumers."""

    if summary is None:
        return None
    return {
        "totalOrders": summary.total_orders,
        "replays": {
            "total": summary.replays.total,
            "executed": summary.replays.executed,
            "failed": summary.replays.failed,
            "scheduled": summary.replays.scheduled,
        },
        "guardrails": _serialize_guardrail_summary(summary.guardrails),
        "guardrailHitsByService": {
            service_id: _serialize_guardrail_summary(bucket)
            for service_id, bucket in summary.guardrail_hits_by_service.items()
        },
        "ruleOverridesByService": {
            service_id: _serialize_rule_override_summary(bucket)
            for service_id, bucket in summary.rule_overrides_by_service.items()
        },
    }


def _apply_replay_stats(summary: ReplaySummary, payload: Mapping[str, Any]) -> None:
    for entry in _extract_entries(payload, ("replays", "replay_entries")):
        status = _coerce_status(entry)
        summary.total += 1
        if status == "executed":
            summary.executed += 1
        elif status == "failed":
            summary.failed += 1


def _apply_scheduled_replays(summary: ReplaySummary, payload: Mapping[str, Any]) -> None:
    scheduled_entries = _extract_entries(payload, ("scheduledReplays", "scheduled_replays"))
    summary.scheduled += sum(1 for entry in scheduled_entries if _coerce_status(entry) == "scheduled")


def _extract_entries(payload: Mapping[str, Any], keys: Sequence[str]) -> list[Mapping[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [entry for entry in value if isinstance(entry, Mapping)]
    return []


def _coerce_status(entry: Mapping[str, Any]) -> str:
    status = entry.get("status")
    if isinstance(status, str):
        return status.strip().lower()
    return ""


def _extract_guardrails(payload: Mapping[str, Any]) -> Mapping[str, Any] | None:
    guardrails = payload.get("guardrails")
    if isinstance(guardrails, Mapping):
        return guardrails
    service_meta = (
        payload.get("service") if isinstance(payload.get("service"), Mapping) else None
    )
    metadata = service_meta.get("metadata") if isinstance(service_meta, Mapping) else None
    if isinstance(metadata, Mapping) and isinstance(metadata.get("guardrails"), Mapping):
        return metadata.get("guardrails")
    return None


def _extract_rule_overrides(payload: Mapping[str, Any]) -> list[dict[str, str | None]]:
    entries = payload.get("serviceRules")
    if not isinstance(entries, list):
        return []
    overrides: list[dict[str, str | None]] = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        identifier = entry.get("id")
        if not isinstance(identifier, str):
            continue
        normalized = identifier.strip()
        if not normalized:
            continue
        label = entry.get("label")
        overrides.append(
            {
                "id": normalized,
                "label": label.strip() if isinstance(label, str) and label.strip() else None,
            }
        )
    return overrides


def _evaluate_guardrail_status(
    guardrails: Mapping[str, Any] | None,
    provider_cost: float | None,
    customer_price: float | None,
) -> str:
    if guardrails is None or provider_cost is None or customer_price is None or customer_price <= 0:
        return "idle"
    margin_value = customer_price - provider_cost
    margin_percent = (margin_value / customer_price) * 100
    status = "pass"
    min_absolute = _extract_guardrail_number(guardrails, ("minimumMarginAbsolute", "minimum_margin_absolute"))
    min_percent = _extract_guardrail_number(guardrails, ("minimumMarginPercent", "minimum_margin_percent"))
    warn_percent = _extract_guardrail_number(guardrails, ("warningMarginPercent", "warning_margin_percent"))
    if min_absolute is not None and margin_value < min_absolute:
        status = "fail"
    if min_percent is not None and margin_percent < min_percent:
        status = "fail"
    if status != "fail" and warn_percent is not None and margin_percent < warn_percent:
        status = "warn"
    return status


def _ensure_guardrail_service_summary(
    container: dict[str, GuardrailSummary],
    key: str,
) -> GuardrailSummary:
    if key not in container:
        container[key] = GuardrailSummary()
    return container[key]


def _safe_number(value: Any) -> float | None:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def _extract_guardrail_number(guardrails: Mapping[str, Any], keys: Sequence[str]) -> float | None:
    for key in keys:
        value = guardrails.get(key)
        number = _safe_number(value)
        if number is not None:
            return number
    return None


def _serialize_guardrail_summary(summary: GuardrailSummary) -> dict[str, int]:
    return {
        "evaluated": summary.evaluated,
        "pass": summary.passed,
        "warn": summary.warned,
        "fail": summary.failed,
    }


def _serialize_rule_override_summary(summary: RuleOverrideServiceSummary) -> dict[str, object]:
    rules: dict[str, dict[str, object]] = {}
    for rule_id, entry in summary.rules.items():
        rules[rule_id] = {
            "id": rule_id,
            "label": entry.label,
            "count": entry.count,
        }
    return {
        "totalOverrides": summary.total_overrides,
        "rules": rules,
    }


__all__ = [
    "ReplaySummary",
    "GuardrailSummary",
    "ProviderAutomationTelemetrySummary",
    "RuleOverrideServiceSummary",
    "RuleOverrideStat",
    "summarize_provider_orders",
    "load_provider_telemetry_summary",
    "serialize_provider_automation_telemetry",
]

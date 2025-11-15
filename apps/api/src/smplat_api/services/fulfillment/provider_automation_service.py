from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping, MutableMapping, Sequence
from uuid import UUID, uuid4

import httpx
from sqlalchemy import select, cast, String, func
from sqlalchemy.ext.asyncio import AsyncSession

from loguru import logger

from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.services.fulfillment.provider_catalog_service import ProviderCatalogService
from smplat_api.services.fulfillment.provider_endpoints import (
    ProviderEndpointError,
    append_refill_entry,
    build_metadata_context,
    extract_balance_from_payload,
    extract_endpoint,
    invoke_provider_endpoint,
)
from smplat_api.schemas.fulfillment_provider import (
    ProviderAutomationSnapshotProviderEntry,
    ProviderAutomationSnapshotResponse,
    ProviderAutomationTelemetry,
)


class ProviderAutomationService:
    """Operational helpers for wallet snapshots and provider order actions."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._session = session
        self._http_client = http_client
        self._catalog = ProviderCatalogService(session)

    async def refresh_balance(self, provider_id: str) -> None:
        provider = await self._catalog.get_provider(provider_id)
        if not provider:
            raise ValueError("Provider not found")
        endpoint = extract_endpoint(provider.metadata_json, "balance")
        if not endpoint:
            raise ProviderEndpointError("Balance endpoint is not configured for provider")

        context = build_metadata_context(provider.metadata_json)
        invocation = await invoke_provider_endpoint(
            endpoint,
            context=context,
            http_client=self._http_client,
            default_timeout=endpoint.get("timeoutSeconds") or 8.0,
        )
        amount, currency = extract_balance_from_payload(invocation.payload, endpoint)
        await self._catalog.record_balance_snapshot(
            provider,
            amount=amount,
            currency=currency,
            payload=invocation.payload,
            retrieved_at=datetime.now(timezone.utc),
        )

    async def list_provider_orders(self, provider_id: str, limit: int = 50) -> Sequence[FulfillmentProviderOrder]:
        stmt = (
            select(FulfillmentProviderOrder)
            .where(FulfillmentProviderOrder.provider_id == provider_id)
            .order_by(FulfillmentProviderOrder.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def list_orders_for_order(
        self,
        order_id: UUID,
        limit: int = 250,
    ) -> Sequence[FulfillmentProviderOrder]:
        normalized_id = self._normalize_uuid_value(order_id)
        if not normalized_id:
            return []
        stmt = (
            select(FulfillmentProviderOrder)
            .where(self._normalized_uuid_column(FulfillmentProviderOrder.order_id) == normalized_id)
            .order_by(FulfillmentProviderOrder.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def list_orders_for_orders(
        self,
        order_ids: Sequence[UUID],
    ) -> dict[UUID, list[FulfillmentProviderOrder]]:
        normalized_pairs: dict[str, UUID] = {}
        for order_id in order_ids:
            normalized = self._normalize_uuid_value(order_id)
            if normalized and isinstance(order_id, UUID):
                normalized_pairs.setdefault(normalized, order_id)
        if not normalized_pairs:
            return {}
        stmt = (
            select(FulfillmentProviderOrder)
            .where(
                self._normalized_uuid_column(FulfillmentProviderOrder.order_id).in_(normalized_pairs.keys())
            )
            .order_by(FulfillmentProviderOrder.created_at.desc())
        )
        result = await self._session.execute(stmt)
        grouped: dict[UUID, list[FulfillmentProviderOrder]] = {order_id: [] for order_id in normalized_pairs.values()}
        for provider_order in result.scalars():
            normalized = self._normalize_uuid_value(provider_order.order_id)
            if not normalized:
                continue
            target_order_id = normalized_pairs.get(normalized)
            if target_order_id is None:
                continue
            grouped.setdefault(target_order_id, []).append(provider_order)
        return grouped

    async def get_provider_order(self, provider_id: str, provider_order_id: UUID) -> FulfillmentProviderOrder | None:
        stmt = (
            select(FulfillmentProviderOrder)
            .where(
                FulfillmentProviderOrder.id == provider_order_id,
                FulfillmentProviderOrder.provider_id == provider_id,
            )
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def trigger_refill(
        self,
        provider_order: FulfillmentProviderOrder,
        *,
        amount: float | None = None,
    ) -> Mapping[str, Any]:
        provider = await self._catalog.get_provider(provider_order.provider_id)
        if not provider:
            raise ValueError("Provider not found")

        endpoint = extract_endpoint(provider.metadata_json, "refill")
        if not endpoint:
            raise ProviderEndpointError("Refill endpoint is not configured for provider")

        payload: MutableMapping[str, Any] = (
            dict(provider_order.payload) if isinstance(provider_order.payload, Mapping) else {}
        )
        provider_order_id = self._resolve_provider_order_id(payload)
        if not provider_order_id:
            raise ValueError("Provider order identifier is missing; cannot trigger refill")

        requested_amount = amount
        if requested_amount is None and provider_order.amount is not None:
            requested_amount = float(provider_order.amount)

        context = build_metadata_context(provider.metadata_json)
        context.update(
            {
                "providerOrderId": provider_order_id,
                "orderId": str(provider_order.order_id),
                "orderItemId": str(provider_order.order_item_id),
                "serviceId": provider_order.service_id,
                "serviceAction": provider_order.service_action,
            }
        )
        if requested_amount is not None:
            context.setdefault("amount", requested_amount)
            context.setdefault("requestedAmount", requested_amount)
        if provider_order.currency:
            context.setdefault("currency", provider_order.currency)
        if provider_order.provider_name:
            context.setdefault("providerName", provider_order.provider_name)

        for key, value in payload.items():
            if isinstance(value, (str, int, float)):
                context.setdefault(key, value)

        invocation = await invoke_provider_endpoint(
            endpoint,
            context=context,
            http_client=self._http_client,
            default_timeout=endpoint.get("timeoutSeconds") or 10.0,
        )

        entry = {
            "id": str(uuid4()),
            "amount": requested_amount,
            "currency": provider_order.currency,
            "performedAt": datetime.now(timezone.utc).isoformat(),
            "response": invocation.payload,
        }
        append_refill_entry(payload, entry)
        provider_order.payload = dict(payload)
        await self._session.commit()
        await self._session.refresh(provider_order)

        return entry

    async def replay_provider_order(
        self,
        provider_order: FulfillmentProviderOrder,
        *,
        amount: float | None = None,
    ) -> Mapping[str, Any]:
        provider = await self._catalog.get_provider(provider_order.provider_id)
        if not provider:
            raise ValueError("Provider not found")

        endpoint = extract_endpoint(provider.metadata_json, "order")
        if not endpoint:
            raise ProviderEndpointError("Order endpoint is not configured for provider")

        payload: MutableMapping[str, Any] = (
            dict(provider_order.payload) if isinstance(provider_order.payload, Mapping) else {}
        )
        requested_amount = amount
        if requested_amount is None and provider_order.amount is not None:
            requested_amount = float(provider_order.amount)
        if requested_amount is None:
            requested_amount = payload.get("requestedAmount")
            if isinstance(requested_amount, str):
                try:
                    requested_amount = float(requested_amount)
                except ValueError:
                    requested_amount = None

        context = build_metadata_context(provider.metadata_json)
        context.update(
            {
                "orderId": str(provider_order.order_id),
                "orderItemId": str(provider_order.order_item_id),
                "serviceId": provider_order.service_id,
                "serviceAction": provider_order.service_action,
            }
        )
        if requested_amount is not None:
            context.setdefault("requestedAmount", requested_amount)
        if provider_order.currency:
            context.setdefault("currency", provider_order.currency)
        if provider_order.provider_name:
            context.setdefault("providerName", provider_order.provider_name)
        if payload.get("serviceRules") is not None:
            context.setdefault("serviceRules", payload.get("serviceRules"))

        for key, value in payload.items():
            if isinstance(value, (str, int, float)):
                context.setdefault(key, value)

        invocation = await invoke_provider_endpoint(
            endpoint,
            context=context,
            http_client=self._http_client,
            default_timeout=endpoint.get("timeoutSeconds") or 10.0,
        )

        rule_ids, rule_metadata = self._extract_rule_context(payload)

        entry = {
            "id": str(uuid4()),
            "requestedAmount": requested_amount,
            "currency": provider_order.currency,
            "performedAt": datetime.now(timezone.utc).isoformat(),
            "status": "executed",
            "response": invocation.payload,
        }
        if rule_ids:
            entry["ruleIds"] = rule_ids
        if rule_metadata:
            entry["ruleMetadata"] = rule_metadata

        replays = payload.get("replays")
        if isinstance(replays, list):
            replays.append(entry)
        else:
            payload["replays"] = [entry]
        payload["providerResponse"] = invocation.payload

        provider_order.payload = dict(payload)
        await self._session.commit()
        await self._session.refresh(provider_order)

        rule_labels = self._summarize_rule_labels(rule_ids, rule_metadata)
        logger.info(
            "Provider order replay executed",
            provider_id=provider_order.provider_id,
            provider_order_id=str(provider_order.id),
            order_id=str(provider_order.order_id),
            rule_ids=rule_ids,
            rule_labels=rule_labels,
            amount=requested_amount,
            status=entry["status"],
        )

        return entry

    async def schedule_provider_order_replay(
        self,
        provider_order: FulfillmentProviderOrder,
        *,
        run_at: datetime,
        amount: float | None = None,
    ) -> Mapping[str, Any]:
        if run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=timezone.utc)

        payload: MutableMapping[str, Any] = (
            dict(provider_order.payload) if isinstance(provider_order.payload, Mapping) else {}
        )
        rule_ids, rule_metadata = self._extract_rule_context(payload)
        entry = {
            "id": str(uuid4()),
            "requestedAmount": amount,
            "currency": provider_order.currency,
            "scheduledFor": run_at.isoformat(),
            "status": "scheduled",
        }
        if rule_ids:
            entry["ruleIds"] = rule_ids
        if rule_metadata:
            entry["ruleMetadata"] = rule_metadata
        schedule = payload.get("scheduledReplays")
        if isinstance(schedule, list):
            schedule.append(entry)
        else:
            payload["scheduledReplays"] = [entry]

        provider_order.payload = dict(payload)
        await self._session.commit()
        await self._session.refresh(provider_order)
        return entry

    async def build_snapshot(self, *, limit_per_provider: int = 25) -> ProviderAutomationSnapshotResponse:
        providers = await self._catalog.list_providers()
        aggregated = self._create_empty_telemetry()
        provider_entries: list[ProviderAutomationSnapshotProviderEntry] = []
        for provider in providers:
            orders = await self.list_provider_orders(provider.id, limit_per_provider)
            telemetry_dict = self._summarize_orders(orders)
            telemetry = ProviderAutomationTelemetry.model_validate(telemetry_dict)
            provider_entries.append(
                ProviderAutomationSnapshotProviderEntry(
                    id=provider.id,
                    name=provider.name,
                    telemetry=telemetry,
                )
            )
            self._merge_telemetry(aggregated, telemetry_dict)
        aggregated_model = ProviderAutomationTelemetry.model_validate(aggregated)
        return ProviderAutomationSnapshotResponse(aggregated=aggregated_model, providers=provider_entries)

    async def calculate_replay_backlog_metrics(self) -> dict[str, Any]:
        stmt = select(FulfillmentProviderOrder.payload).where(FulfillmentProviderOrder.payload.isnot(None))
        result = await self._session.execute(stmt)
        total = 0
        next_eta: datetime | None = None
        for payload in result.scalars():
            if not isinstance(payload, dict):
                continue
            schedule = payload.get("scheduledReplays")
            if not isinstance(schedule, list):
                continue
            for entry in schedule:
                if not isinstance(entry, dict):
                    continue
                if entry.get("status", "scheduled") != "scheduled":
                    continue
                total += 1
                candidate = self._parse_iso_timestamp(entry.get("scheduledFor"))
                if candidate is None:
                    continue
                if next_eta is None or candidate < next_eta:
                    next_eta = candidate
        return {
            "scheduledBacklog": total,
            "nextScheduledAt": next_eta.isoformat() if next_eta else None,
        }

    @staticmethod
    def _resolve_provider_order_id(payload: Mapping[str, Any]) -> str | None:
        candidates = [
            payload.get("providerOrderId"),
            payload.get("provider_order_id"),
            payload.get("providerOrderID"),
            payload.get("orderId"),
        ]
        for value in candidates:
            if isinstance(value, (str, int)):
                text = str(value).strip()
                if text:
                    return text
        return None

    @staticmethod
    def _extract_rule_context(
        payload: Mapping[str, Any] | None,
    ) -> tuple[list[str] | None, dict[str, Any] | None]:
        if not isinstance(payload, Mapping):
            return (None, None)
        rules = payload.get("serviceRules")
        if not isinstance(rules, list):
            return (None, None)
        rule_ids: list[str] = []
        metadata: dict[str, Any] = {}
        for rule in rules:
            if not isinstance(rule, Mapping):
                continue
            rule_id = rule.get("id")
            if not isinstance(rule_id, str):
                continue
            normalized_id = rule_id.strip()
            if not normalized_id:
                continue
            rule_ids.append(normalized_id)
            snapshot = ProviderAutomationService._serialize_rule_snapshot(normalized_id, rule)
            if snapshot:
                metadata[normalized_id] = snapshot
        return (rule_ids or None, metadata or None)

    @staticmethod
    def _serialize_rule_snapshot(rule_id: str, rule: Mapping[str, Any]) -> dict[str, Any] | None:
        snapshot: dict[str, Any] = {"id": rule_id}
        label = rule.get("label")
        if isinstance(label, str):
            text = label.strip()
            if text:
                snapshot["label"] = text
        description = rule.get("description")
        if isinstance(description, str):
            text = description.strip()
            if text:
                snapshot["description"] = text
        priority = rule.get("priority")
        if isinstance(priority, (int, float)):
            snapshot["priority"] = int(priority)
        conditions = rule.get("conditions")
        if isinstance(conditions, list):
            normalized_conditions = [
                dict(condition)
                for condition in conditions
                if isinstance(condition, Mapping)
            ]
            if normalized_conditions:
                snapshot["conditions"] = normalized_conditions
        overrides = rule.get("overrides")
        if isinstance(overrides, Mapping):
            snapshot["overrides"] = dict(overrides)
        return snapshot

    @staticmethod
    def _summarize_rule_labels(
        rule_ids: Sequence[str] | None,
        rule_metadata: Mapping[str, Any] | None,
    ) -> list[str]:
        if not rule_ids:
            return []
        labels: list[str] = []
        metadata = dict(rule_metadata) if isinstance(rule_metadata, Mapping) else {}
        for rule_id in rule_ids:
            label = metadata.get(rule_id, {}).get("label") if isinstance(metadata.get(rule_id), Mapping) else None
            labels.append(label or rule_id)
        return labels

    @staticmethod
    def _create_empty_telemetry() -> dict[str, Any]:
        return {
            "totalOrders": 0,
            "replays": {"total": 0, "executed": 0, "failed": 0, "scheduled": 0},
            "guardrails": {"evaluated": 0, "pass": 0, "warn": 0, "fail": 0},
            "guardrailHitsByService": {},
            "ruleOverridesByService": {},
        }

    def _summarize_orders(self, orders: Sequence[FulfillmentProviderOrder]) -> dict[str, Any]:
        summary = self._create_empty_telemetry()
        summary["totalOrders"] = len(orders)
        for order in orders:
            payload = self._safe_payload(order.payload)
            service_key = order.service_id or order.provider_id or "unknown"
            replays = payload.get("replays")
            if isinstance(replays, list):
                for entry in replays:
                    if not isinstance(entry, Mapping):
                        continue
                    summary["replays"]["total"] += 1
                    status = entry.get("status")
                    if status == "executed":
                        summary["replays"]["executed"] += 1
                    elif status == "failed":
                        summary["replays"]["failed"] += 1
            scheduled = payload.get("scheduledReplays")
            if isinstance(scheduled, list):
                for entry in scheduled:
                    if not isinstance(entry, Mapping):
                        continue
                    if entry.get("status") == "scheduled":
                        summary["replays"]["scheduled"] += 1

            guardrails = self._extract_guardrails(payload)
            provider_cost = self._safe_number(payload.get("providerCostAmount"))
            customer_price = self._safe_number(order.amount)

            if guardrails and provider_cost is not None and customer_price is not None:
                status = self._evaluate_guardrail_status(guardrails, provider_cost, customer_price)
                self._apply_guardrail_status(summary["guardrails"], status)
                service_bucket = summary["guardrailHitsByService"].setdefault(
                    service_key,
                    self._create_guardrail_summary(),
                )
                self._apply_guardrail_status(service_bucket, status)

            rules = payload.get("serviceRules")
            if isinstance(rules, list) and rules:
                override_bucket = summary["ruleOverridesByService"].setdefault(
                    service_key,
                    self._create_rule_override_summary(),
                )
                for rule in rules:
                    if isinstance(rule, Mapping):
                        self._record_rule_override(override_bucket, rule)

        return summary

    @staticmethod
    def _merge_telemetry(target: dict[str, Any], source: dict[str, Any]) -> None:
        target["totalOrders"] += source.get("totalOrders", 0)
        target_replays = target["replays"]
        source_replays = source.get("replays") or {}
        target_replays["total"] += source_replays.get("total", 0)
        target_replays["executed"] += source_replays.get("executed", 0)
        target_replays["failed"] += source_replays.get("failed", 0)
        target_replays["scheduled"] += source_replays.get("scheduled", 0)

        target_guardrails = target["guardrails"]
        source_guardrails = source.get("guardrails") or {}
        target_guardrails["evaluated"] += source_guardrails.get("evaluated", 0)
        target_guardrails["pass"] += source_guardrails.get("pass", 0)
        target_guardrails["warn"] += source_guardrails.get("warn", 0)
        target_guardrails["fail"] += source_guardrails.get("fail", 0)

        target_hits: dict[str, dict[str, Any]] = target["guardrailHitsByService"]
        source_hits = source.get("guardrailHitsByService") or {}
        for service_id, summary in source_hits.items():
            bucket = target_hits.setdefault(service_id, ProviderAutomationService._create_guardrail_summary())
            bucket["evaluated"] += summary.get("evaluated", 0)
            bucket["pass"] += summary.get("pass", 0)
            bucket["warn"] += summary.get("warn", 0)
            bucket["fail"] += summary.get("fail", 0)

        target_overrides: dict[str, dict[str, Any]] = target["ruleOverridesByService"]
        source_overrides = source.get("ruleOverridesByService") or {}
        for service_id, rule_summary in source_overrides.items():
            bucket = target_overrides.setdefault(
                service_id,
                ProviderAutomationService._create_rule_override_summary(),
            )
            bucket["totalOverrides"] += rule_summary.get("totalOverrides", 0)
            target_rules = bucket.setdefault("rules", {})
            source_rules: Mapping[str, Any] = rule_summary.get("rules") or {}
            for rule_id, entry in source_rules.items():
                normalized_id = rule_id or entry.get("id")
                if not normalized_id:
                    continue
                rule_bucket = target_rules.setdefault(
                    normalized_id,
                    {
                        "id": normalized_id,
                        "label": entry.get("label"),
                        "count": 0,
                    },
                )
                if not rule_bucket.get("label") and entry.get("label"):
                    rule_bucket["label"] = entry.get("label")
                rule_bucket["count"] += entry.get("count", 0)

    @staticmethod
    def _create_guardrail_summary() -> dict[str, int]:
        return {"evaluated": 0, "pass": 0, "warn": 0, "fail": 0}

    @staticmethod
    def _create_rule_override_summary() -> dict[str, Any]:
        return {"totalOverrides": 0, "rules": {}}

    @staticmethod
    def _record_rule_override(summary: dict[str, Any], rule: Mapping[str, Any]) -> None:
        rule_id = rule.get("id")
        if not isinstance(rule_id, str):
            return
        normalized_id = rule_id.strip()
        if not normalized_id:
            return
        summary["totalOverrides"] += 1
        rules: dict[str, Any] = summary.setdefault("rules", {})
        bucket = rules.setdefault(
            normalized_id,
            {"id": normalized_id, "label": None, "count": 0},
        )
        label = rule.get("label")
        if isinstance(label, str) and label.strip():
            bucket["label"] = label.strip()
        bucket["count"] += 1

    @staticmethod
    def _safe_payload(payload: Mapping[str, Any] | None) -> dict[str, Any]:
        return dict(payload) if isinstance(payload, Mapping) else {}

    @staticmethod
    def _extract_guardrails(payload: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
        if not isinstance(payload, Mapping):
            return None
        guardrails = payload.get("guardrails")
        if isinstance(guardrails, Mapping):
            return guardrails
        service = payload.get("service")
        if isinstance(service, Mapping):
            metadata = service.get("metadata")
            if isinstance(metadata, Mapping):
                service_guardrails = metadata.get("guardrails")
                if isinstance(service_guardrails, Mapping):
                    return service_guardrails
        return None

    @staticmethod
    def _safe_number(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                return float(text)
            except ValueError:
                return None
        return None

    @staticmethod
    def _evaluate_guardrail_status(
        guardrails: Mapping[str, Any],
        provider_cost: float,
        customer_price: float,
    ) -> str:
        if customer_price <= 0:
            return "idle"
        margin_value = customer_price - provider_cost
        margin_percent = (margin_value / customer_price) * 100
        minimum_margin_abs = ProviderAutomationService._safe_number(guardrails.get("minimumMarginAbsolute"))
        minimum_margin_percent = ProviderAutomationService._safe_number(guardrails.get("minimumMarginPercent"))
        warning_margin_percent = ProviderAutomationService._safe_number(guardrails.get("warningMarginPercent"))

        if (minimum_margin_abs is not None and margin_value < minimum_margin_abs) or (
            minimum_margin_percent is not None and margin_percent < minimum_margin_percent
        ):
            return "fail"
        if warning_margin_percent is not None and margin_percent < warning_margin_percent:
            return "warn"
        return "pass"

    @staticmethod
    def _apply_guardrail_status(summary: dict[str, int], status: str) -> None:
        summary["evaluated"] += 1
        if status in ("pass", "warn", "fail"):
            summary[status] += 1

    @staticmethod
    def _parse_iso_timestamp(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None

    @staticmethod
    def _normalize_uuid_value(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, UUID):
            return value.hex
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            return text.replace("-", "").lower()
        return str(value).replace("-", "").lower()

    @staticmethod
    def _normalized_uuid_column(column: Any) -> Any:
        return func.replace(func.lower(cast(column, String)), "-", "")


__all__ = ["ProviderAutomationService"]

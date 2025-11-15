from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentProvider,
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderOrder,
    FulfillmentProviderStatusEnum,
)
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.services.fulfillment import ProviderAutomationService
from smplat_api.workers.provider_automation import ProviderOrderReplayWorker


class StubAutomationService:
    def __init__(self, performed_at: str):
        self._performed_at = performed_at
        self.calls: list[tuple[str, float | None]] = []

    async def replay_provider_order(self, provider_order: FulfillmentProviderOrder, *, amount: float | None = None):
        self.calls.append((str(provider_order.id), amount))
        payload = dict(provider_order.payload or {})
        rule_ids, rule_metadata = ProviderAutomationService._extract_rule_context(payload)
        entry = {
            "id": f"replay-{len(self.calls)}",
            "requestedAmount": amount,
            "currency": provider_order.currency,
            "performedAt": self._performed_at,
            "status": "executed",
            "response": {"ok": True},
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
        provider_order.payload = payload
        return entry

    async def calculate_replay_backlog_metrics(self) -> dict[str, Any]:
        return {"scheduledBacklog": 0, "nextScheduledAt": None}


class FailingAutomationService:
    async def replay_provider_order(self, provider_order: FulfillmentProviderOrder, *, amount: float | None = None):
        raise RuntimeError("provider_endpoint_failed")

    async def calculate_replay_backlog_metrics(self) -> dict[str, Any]:
        return {"scheduledBacklog": 0, "nextScheduledAt": None}


async def _bootstrap_provider_order(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="worker-prov",
            name="Worker Provider",
            base_url="https://provider.example",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
            metadata_json={},
        )
        order = Order(
            id=uuid4(),
            order_number="SM-WORKER-1",
            subtotal=Decimal("40.00"),
            tax=Decimal("0"),
            total=Decimal("40.00"),
            currency=CurrencyEnum.USD,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            id=uuid4(),
            order=order,
            product_id=uuid4(),
            product_title="Worker Product",
            quantity=1,
            unit_price=Decimal("40.00"),
            total_price=Decimal("40.00"),
        )
        order.items.append(order_item)
        provider_order = FulfillmentProviderOrder(
            provider_id=provider.id,
            provider_name=provider.name,
            service_id="svc-worker",
            service_action="replay",
            order_id=order.id,
            order_item_id=order_item.id,
            amount=Decimal("40.00"),
            currency="USD",
            payload={
                "serviceRules": [
                    {
                        "id": "rule-worker",
                        "label": "Worker replay",
                        "conditions": [{"kind": "channel", "channels": ["admin"]}],
                    }
                ]
            },
        )

        session.add_all([provider, order, provider_order])
        await session.commit()
        await session.refresh(provider_order)
        return provider_order.id


@pytest.mark.asyncio
async def test_worker_executes_due_scheduled_replays(session_factory):
    provider_order_id = await _bootstrap_provider_order(session_factory)
    scheduled_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    run_clock = scheduled_time + timedelta(minutes=1)
    performed_at = run_clock.isoformat()

    async with session_factory() as session:
        provider_order = await session.get(FulfillmentProviderOrder, provider_order_id)
        provider_order.payload = {
            "serviceRules": [
                {"id": "rule-worker", "label": "Worker replay", "conditions": [{"kind": "channel", "channels": ["admin"]}]}
            ],
            "scheduledReplays": [
                {
                    "id": "sched-1",
                    "requestedAmount": 12.5,
                    "scheduledFor": scheduled_time.isoformat(),
                    "status": "scheduled",
                    "ruleIds": ["rule-worker"],
                }
            ],
        }
        await session.commit()

    worker = ProviderOrderReplayWorker(
        session_factory,
        automation_factory=lambda session: StubAutomationService(performed_at),
        clock=lambda: run_clock,
    )

    summary = await worker.process_scheduled(limit=5)
    assert summary["processed"] == 1
    assert summary["succeeded"] == 1
    assert summary["failed"] == 0
    assert summary["scheduledBacklog"] == 0

    async with session_factory() as session:
        provider_order = await session.get(FulfillmentProviderOrder, provider_order_id)
        payload = provider_order.payload
        replay_entry = payload["replays"][0]
        assert replay_entry["status"] == "executed"
        assert replay_entry["requestedAmount"] == 12.5
        assert replay_entry["ruleIds"] == ["rule-worker"]
        assert replay_entry["ruleMetadata"]["rule-worker"]["label"] == "Worker replay"

        scheduled_entry = payload["scheduledReplays"][0]
        assert scheduled_entry["status"] == "executed"
        assert scheduled_entry["performedAt"] == performed_at
        assert scheduled_entry["response"]["id"] == replay_entry["id"]
        assert scheduled_entry["ruleIds"] == ["rule-worker"]
        assert scheduled_entry["ruleMetadata"]["rule-worker"]["conditions"][0]["kind"] == "channel"


@pytest.mark.asyncio
async def test_worker_records_failures_and_marks_schedule_entry(session_factory):
    provider_order_id = await _bootstrap_provider_order(session_factory)
    scheduled_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    now = scheduled_time + timedelta(minutes=1)

    async with session_factory() as session:
        provider_order = await session.get(FulfillmentProviderOrder, provider_order_id)
        provider_order.payload = {
            "serviceRules": [
                {"id": "rule-worker", "label": "Worker replay", "conditions": [{"kind": "channel", "channels": ["admin"]}]}
            ],
            "scheduledReplays": [
                {
                    "id": "sched-fail",
                    "requestedAmount": 20.0,
                    "scheduledFor": scheduled_time.isoformat(),
                    "status": "scheduled",
                    "ruleIds": ["rule-worker"],
                }
            ],
            "replays": [],
        }
        await session.commit()

    worker = ProviderOrderReplayWorker(
        session_factory,
        automation_factory=lambda session: FailingAutomationService(),
        clock=lambda: now,
    )

    summary = await worker.process_scheduled(limit=5)
    assert summary["processed"] == 1
    assert summary["succeeded"] == 0
    assert summary["failed"] == 1
    assert summary["scheduledBacklog"] == 0

    async with session_factory() as session:
        provider_order = await session.get(FulfillmentProviderOrder, provider_order_id)
        payload = provider_order.payload
        assert payload["replays"][0]["status"] == "failed"
        assert payload["replays"][0]["response"]["error"] == "provider_endpoint_failed"
        assert payload["replays"][0]["ruleIds"] == ["rule-worker"]
        assert payload["replays"][0]["ruleMetadata"]["rule-worker"]["label"] == "Worker replay"

        scheduled_entry = payload["scheduledReplays"][0]
        assert scheduled_entry["status"] == "failed"
        assert scheduled_entry["performedAt"] == now.isoformat()
        assert scheduled_entry["response"]["error"] == "provider_endpoint_failed"
        assert scheduled_entry["ruleIds"] == ["rule-worker"]
        assert scheduled_entry["ruleMetadata"]["rule-worker"]["conditions"][0]["kind"] == "channel"

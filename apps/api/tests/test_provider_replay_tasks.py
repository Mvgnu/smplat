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
from smplat_api.tasks.provider_replay import replay_single_order, run_scheduled_replays


@pytest.fixture(autouse=True)
def _patch_run_history(monkeypatch):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr("smplat_api.tasks.provider_replay._record_run_history", _noop)


async def _setup_provider_order(session, *, include_schedule: bool = False):
    provider = FulfillmentProvider(
        id="prov-task",
        name="Task Provider",
        base_url="https://provider.example",
        status=FulfillmentProviderStatusEnum.ACTIVE,
        health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
        metadata_json={},
    )
    order = Order(
        id=uuid4(),
        order_number="SM-TASK-1",
        subtotal=Decimal("50.00"),
        tax=Decimal("0"),
        total=Decimal("50.00"),
        currency=CurrencyEnum.USD,
        status=OrderStatusEnum.PENDING,
        source=OrderSourceEnum.CHECKOUT,
    )
    order_item = OrderItem(
        id=uuid4(),
        order=order,
        product_id=uuid4(),
        product_title="Replay Product",
        quantity=1,
        unit_price=Decimal("50.00"),
        total_price=Decimal("50.00"),
    )
    order.items.append(order_item)
    provider_order = FulfillmentProviderOrder(
        provider_id=provider.id,
        provider_name=provider.name,
        service_id="svc-task",
        service_action="replay",
        order_id=order.id,
        order_item_id=order_item.id,
        amount=Decimal("60.00"),
        currency="USD",
        payload={},
    )
    if include_schedule:
        scheduled_time = datetime.now(timezone.utc) - timedelta(minutes=1)
        provider_order.payload = {
            "scheduledReplays": [
                {
                    "id": "sched-task",
                    "requestedAmount": 60.0,
                    "scheduledFor": scheduled_time.isoformat(),
                    "status": "scheduled",
                }
            ],
            "replays": [],
        }
    session.add_all([provider, order, provider_order])
    await session.commit()
    await session.refresh(provider_order)
    return provider, provider_order


class StubAutomationService:
    def __init__(self, session):
        self._session = session

    async def get_provider_order(self, provider_id, provider_order_id):
        return await self._session.get(FulfillmentProviderOrder, provider_order_id)

    async def replay_provider_order(self, provider_order, *, amount: float | None = None):
        payload = dict(provider_order.payload or {})
        entry = {
            "id": "stub-replay",
            "status": "executed",
            "requestedAmount": amount,
        }
        replays = payload.get("replays")
        if isinstance(replays, list):
            replays.append(entry)
        else:
            payload["replays"] = [entry]
        provider_order.payload = payload
        await self._session.commit()
        await self._session.refresh(provider_order)
        return entry

    async def calculate_replay_backlog_metrics(self) -> dict[str, Any]:
        return {"scheduledBacklog": 0, "nextScheduledAt": None}


@pytest.mark.asyncio
async def test_replay_single_order_task(session_factory):
    async with session_factory() as session:
        provider, provider_order = await _setup_provider_order(session)

    result = await replay_single_order(
        provider_id=provider.id,
        provider_order_id=provider_order.id,
        amount=75.0,
        session_factory=session_factory,
        automation_factory=lambda session: StubAutomationService(session),
    )
    assert result["status"] == "executed"


@pytest.mark.asyncio
async def test_run_scheduled_replays_task(session_factory):
    async with session_factory() as session:
        await _setup_provider_order(session, include_schedule=True)

    summary = await run_scheduled_replays(
        limit=5,
        session_factory=session_factory,
        automation_factory=lambda session: StubAutomationService(session),
    )
    assert summary["processed"] == 1
    assert summary["succeeded"] == 1
    assert summary["scheduledBacklog"] == 0

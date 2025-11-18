from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderStatusEnum, OrderSourceEnum
from smplat_api.models.order_state_event import OrderStateEventTypeEnum
from smplat_api.api.v1.endpoints.fulfillment_providers import (
    get_provider_catalog_service,
    get_provider_automation_service,
)


@pytest.mark.asyncio
async def test_trigger_refill_records_timeline_event(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "refill-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM700123",
                subtotal=Decimal("45.00"),
                tax=Decimal("0"),
                total=Decimal("45.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.PROCESSING,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            order_id = order.id

        provider_order = SimpleNamespace(
            id=uuid4(),
            provider_id="provider-x",
            provider_name="Stub Provider",
            order_id=order_id,
            order_item_id=uuid4(),
            service_id="svc-growth",
            service_action="order",
            amount=12.0,
            currency="USD",
            payload={},
        )

        class StubCatalog:
            async def get_provider(self, provider_id: str):
                return SimpleNamespace(id=provider_id, metadata_json={})

        class StubAutomation:
            def __init__(self, record):
                self.record = record

            async def get_provider_order(self, provider_id: str, provider_order_id):
                return self.record

            async def trigger_refill(self, provider_order, amount=None):
                return {
                    "id": "refill-entry",
                    "amount": amount or provider_order.amount,
                    "currency": provider_order.currency,
                    "performedAt": "2025-01-01T00:00:00Z",
                }

        overrides = {
            get_provider_catalog_service: lambda: StubCatalog(),
            get_provider_automation_service: lambda: StubAutomation(provider_order),
        }
        app.dependency_overrides.update(overrides)

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/fulfillment/providers/{provider_order.provider_id}/orders/{provider_order.id}/refill",
                json={"amount": 15.0, "note": "Manual top-up"},
                headers={"X-API-Key": "refill-key"},
            )
        assert response.status_code == 200

        async with AsyncClient(app=app, base_url="http://test") as client:
            timeline = await client.get(
                f"/api/v1/orders/{order_id}/state-events",
                headers={"X-API-Key": "refill-key"},
            )
        assert timeline.status_code == 200
        events = timeline.json()
        assert any(event["eventType"] == OrderStateEventTypeEnum.REFILL_COMPLETED.value for event in events)
    finally:
        settings.checkout_api_key = previous_key
        for key in list(overrides.keys()):
            app.dependency_overrides.pop(key, None)


@pytest.mark.asyncio
async def test_replay_endpoint_records_timeline_event(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "replay-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM700456",
                subtotal=Decimal("100.00"),
                tax=Decimal("0"),
                total=Decimal("100.00"),
                currency=CurrencyEnum.USD,
                status=OrderStatusEnum.PROCESSING,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            order_id = order.id

        provider_order = SimpleNamespace(
            id=uuid4(),
            provider_id="provider-replay",
            provider_name="Replay Provider",
            order_id=order_id,
            order_item_id=uuid4(),
            service_id="svc-replay",
            service_action="replay",
            amount=32.0,
            currency="USD",
            payload={},
        )

        class StubReplayAutomation:
            def __init__(self, record):
                self.record = record

            async def get_provider_order(self, provider_id: str, provider_order_id):
                return self.record

            async def replay_provider_order(self, provider_order, amount=None):
                return {
                    "id": "replay-entry",
                    "requestedAmount": amount or provider_order.amount,
                    "currency": provider_order.currency,
                    "performedAt": "2025-01-01T00:05:00Z",
                    "status": "executed",
                }

        class StubCatalog:
            async def get_provider(self, provider_id: str):
                return SimpleNamespace(id=provider_id)

        overrides = {
            get_provider_catalog_service: lambda: StubCatalog(),
            get_provider_automation_service: lambda: StubReplayAutomation(provider_order),
        }
        app.dependency_overrides.update(overrides)

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/fulfillment/providers/{provider_order.provider_id}/orders/{provider_order.id}/replay",
                json={},
                headers={"X-API-Key": "replay-key"},
            )
        assert response.status_code == 200

        async with AsyncClient(app=app, base_url="http://test") as client:
            timeline = await client.get(
                f"/api/v1/orders/{order_id}/state-events",
                headers={"X-API-Key": "replay-key"},
            )
        assert timeline.status_code == 200
        events = timeline.json()
        assert any(event["eventType"] == OrderStateEventTypeEnum.REPLAY_EXECUTED.value for event in events)
    finally:
        settings.checkout_api_key = previous_key
        for key in list(overrides.keys()):
            app.dependency_overrides.pop(key, None)


@pytest.mark.asyncio
async def test_replay_endpoint_schedules_timeline_event(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "replay-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM700789",
                subtotal=Decimal("80.00"),
                tax=Decimal("0"),
                total=Decimal("80.00"),
                currency=CurrencyEnum.USD,
                status=OrderStatusEnum.ACTIVE,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            order_id = order.id

        provider_order = SimpleNamespace(
            id=uuid4(),
            provider_id="provider-replay",
            provider_name="Replay Provider",
            order_id=order_id,
            order_item_id=uuid4(),
            service_id="svc-replay",
            service_action="replay",
            amount=32.0,
            currency="USD",
            payload={},
        )

        scheduled_for = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

        class StubScheduleAutomation:
            def __init__(self, record):
                self.record = record

            async def get_provider_order(self, provider_id: str, provider_order_id):
                return self.record

            async def schedule_provider_order_replay(self, provider_order, *, run_at, amount=None):
                return {
                    "id": "sched-entry",
                    "scheduledFor": scheduled_for,
                    "requestedAmount": amount,
                    "currency": provider_order.currency,
                    "status": "scheduled",
                }

        class StubCatalog:
            async def get_provider(self, provider_id: str):
                return SimpleNamespace(id=provider_id)

        overrides = {
            get_provider_catalog_service: lambda: StubCatalog(),
            get_provider_automation_service: lambda: StubScheduleAutomation(provider_order),
        }
        app.dependency_overrides.update(overrides)

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/fulfillment/providers/{provider_order.provider_id}/orders/{provider_order.id}/replay",
                json={"runAt": scheduled_for},
                headers={"X-API-Key": "replay-key"},
            )
        assert response.status_code == 200

        async with AsyncClient(app=app, base_url="http://test") as client:
            timeline = await client.get(
                f"/api/v1/orders/{order_id}/state-events",
                headers={"X-API-Key": "replay-key"},
            )
        assert timeline.status_code == 200
        events = timeline.json()
        assert any(event["eventType"] == OrderStateEventTypeEnum.REPLAY_SCHEDULED.value for event in events)
    finally:
        settings.checkout_api_key = previous_key
        for key in list(overrides.keys()):
            app.dependency_overrides.pop(key, None)

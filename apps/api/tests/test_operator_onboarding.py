from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.services.orders.onboarding import OnboardingService


@pytest.mark.asyncio
async def test_operator_journey_detail_includes_multi_provider_guardrail_status(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "ops-key"

    try:
        async def _noop_compute_nudges(self, *args, **kwargs):
            return []

        monkeypatch.setattr(OnboardingService, "compute_nudge_opportunities", _noop_compute_nudges, raising=False)
        async with session_factory() as session:
            order = Order(
                order_number="ORD-1234",
                status=OrderStatusEnum.ACTIVE,
                source=OrderSourceEnum.CHECKOUT,
                subtotal=100,
                tax=0,
                total=100,
                currency=CurrencyEnum.USD,
            )
            session.add(order)
            await session.flush()

            item_a = OrderItem(
                order_id=order.id,
                product_title="Growth preset",
                quantity=1,
                unit_price=100,
                total_price=100,
            )
            item_b = OrderItem(
                order_id=order.id,
                product_title="Automation add-on",
                quantity=1,
                unit_price=50,
                total_price=50,
            )
            item_c = OrderItem(
                order_id=order.id,
                product_title="Provider pack",
                quantity=1,
                unit_price=25,
                total_price=25,
            )
            session.add_all([item_a, item_b, item_c])
            await session.flush()

            session.add_all(
                [
                    FulfillmentProviderOrder(
                        id=uuid4(),
                        order_id=order.id,
                        order_item_id=item_a.id,
                        provider_id="provider-a",
                        provider_name="Provider A",
                        service_id="svc-1",
                        service_action="guardrail.follow_up",
                    ),
                    FulfillmentProviderOrder(
                        id=uuid4(),
                        order_id=order.id,
                        order_item_id=item_b.id,
                        provider_id="provider-a",
                        provider_name="Provider A",
                        service_id="svc-1",
                        service_action="guardrail.follow_up",
                    ),
                    FulfillmentProviderOrder(
                        id=uuid4(),
                        order_id=order.id,
                        order_item_id=item_c.id,
                        provider_id="provider-b",
                        provider_name="Provider B",
                        service_id="svc-2",
                        service_action="guardrail.follow_up",
                    ),
                ]
            )

            session.add(
                ProviderGuardrailStatus(
                    provider_id="provider-b",
                    provider_name="Provider B",
                    is_paused=True,
                    last_action="pause",
                    updated_at=datetime(2024, 1, 5, tzinfo=timezone.utc),
                )
            )

            service = OnboardingService(session)
            journey = await service.ensure_journey(order.id)
            journey.started_at = datetime(2023, 12, 31, tzinfo=timezone.utc)
            journey.updated_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
            for task in journey.tasks:
                task.updated_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/operators/onboarding/journeys/{journey.id}",
                headers={"X-API-Key": "ops-key"},
            )

        assert response.status_code == 200
        payload = response.json()
        providers = payload["providerAutomation"]
        assert len(providers) == 2
        assert {entry["providerId"] for entry in providers} == {"provider-a", "provider-b"}

        provider_a = next(entry for entry in providers if entry["providerId"] == "provider-a")
        assert len(provider_a["orderItems"]) == 2
        assert {item["orderItemLabel"] for item in provider_a["orderItems"]} == {
            "Growth preset",
            "Automation add-on",
        }
        assert provider_a["guardrailStatus"] is None

        provider_b = next(entry for entry in providers if entry["providerId"] == "provider-b")
        assert [item["orderItemLabel"] for item in provider_b["orderItems"]] == ["Provider pack"]
        assert provider_b["guardrailStatus"]["isPaused"] is True
        assert provider_b["guardrailStatus"]["lastAction"] == "pause"
    finally:
        settings.checkout_api_key = previous_key

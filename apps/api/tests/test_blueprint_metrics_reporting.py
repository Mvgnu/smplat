from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.services.reporting import BlueprintMetricsService


@pytest.mark.asyncio
async def test_blueprint_metrics_service_counts_options_addons_and_providers(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM-TEST-1",
            subtotal=Decimal("500.00"),
            tax=Decimal("0.00"),
            total=Decimal("500.00"),
            currency="USD",
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        item = OrderItem(
            order=order,
            product_title="Blueprint Hero",
            quantity=1,
            unit_price=Decimal("500.00"),
            total_price=Decimal("500.00"),
            selected_options={
                "presetId": "preset-growth",
                "presetLabel": "Growth Sprint",
                "options": [
                    {
                        "groupId": "hero",
                        "groupName": "Hero",
                        "optionId": "hero-pro",
                        "label": "Hero Pro",
                        "priceDelta": 125,
                    },
                    {
                        "groupId": "tagline",
                        "groupName": "Tagline",
                        "optionId": "tagline-labs",
                        "label": "Labs tagline",
                        "priceDelta": 45,
                    },
                ],
                "addOns": [
                    {
                        "id": "qa-escort",
                        "label": "QA Escort",
                        "priceDelta": 250,
                        "pricingMode": "flat",
                        "serviceProviderName": "Ops Beta",
                    }
                ],
            },
        )
        session.add_all([order, item])
        await session.flush()

        provider_order = FulfillmentProviderOrder(
            order_id=order.id,
            order_item_id=item.id,
            provider_id="ops-beta",
            provider_name="Ops Beta",
            service_id="qa-escort",
            service_action="qa_support",
            amount=Decimal("250.00"),
            currency="USD",
        )
        session.add(provider_order)
        await session.flush()

        historic_order = Order(
            order_number="SM-TEST-2",
            subtotal=Decimal("400.00"),
            tax=Decimal("0.00"),
            total=Decimal("400.00"),
            currency="USD",
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        historic_order.created_at = datetime.now(timezone.utc) - timedelta(days=60)
        historic_item = OrderItem(
            order=historic_order,
            product_title="Blueprint Hero",
            quantity=1,
            unit_price=Decimal("400.00"),
            total_price=Decimal("400.00"),
            selected_options={
                "presetId": "preset-growth",
                "presetLabel": "Growth Sprint",
                "options": [],
                "addOns": [],
            },
        )
        provider_order_historic = FulfillmentProviderOrder(
            order=historic_order,
            order_item=historic_item,
            provider_id="ops-gamma",
            provider_name="Ops Gamma",
            service_id="qa-escort",
            service_action="qa_support",
            amount=Decimal("150.00"),
            currency="USD",
        )
        provider_order_historic.created_at = historic_order.created_at
        session.add_all([historic_order, historic_item, provider_order_historic])
        await session.commit()

        service = BlueprintMetricsService(session)
        metrics = await service.fetch_metrics(
            window_days=90,
            load_alert_share_threshold=0.5,
            load_alert_delta_threshold=0.1,
            load_alert_min_engagements=1,
            load_alert_short_window=7,
            load_alert_long_window=90,
        )

        assert metrics["orders"]["total"] == 2
        assert metrics["orders"]["items"] == 2
        assert metrics["orders"]["itemRevenue"] == pytest.approx(900.0)

        option_ids = {entry["optionId"] for entry in metrics["options"]}
        assert "hero-pro" in option_ids
        assert "tagline-labs" in option_ids

        add_on_ids = {entry["addOnId"] for entry in metrics["addOns"]}
        assert "qa-escort" in add_on_ids

        provider_entries = metrics["providerEngagements"]
        assert provider_entries
        assert provider_entries[0]["providerId"] == "ops-beta"
        assert provider_entries[0]["engagements"] == 1

        preset_provider_windows = metrics["presetProviderEngagements"]
        assert preset_provider_windows["windows"]["30"]["days"] == 30
        window_entries = preset_provider_windows["windows"]["30"]["entries"]
        assert window_entries
        assert window_entries[0]["presetId"] == "preset-growth"
        assert window_entries[0]["providerId"] == "ops-beta"
        assert window_entries[0]["engagements"] == 1
        assert window_entries[0]["currency"] == "USD"
        assert window_entries[0]["engagementShare"] == pytest.approx(1.0)

        load_alerts = metrics["providerLoadAlerts"]
        assert load_alerts
        alert = load_alerts[0]
        assert alert["providerId"] == "ops-beta"
        assert alert["presetId"] == "preset-growth"
        assert alert["shortShare"] >= 0.5
        assert alert["longShare"] < alert["shortShare"]
        assert "links" in alert
        assert alert["links"]["merchandising"].startswith("/admin/merchandising")

        preset_entries = metrics["presets"]
        assert preset_entries
        assert preset_entries[0]["presetId"] == "preset-growth"
        assert preset_entries[0]["selections"] == 2

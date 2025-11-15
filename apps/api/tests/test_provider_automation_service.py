from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import httpx
import json
import pytest
from uuid import uuid4

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentProvider,
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderOrder,
    FulfillmentProviderStatusEnum,
)
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.services.fulfillment import (
    ProviderAutomationService,
    ProviderAutomationRunTypeEnum,
)
from smplat_api.api.v1.endpoints import fulfillment_providers as fp
from smplat_api.workers.provider_automation import ProviderOrderReplayWorker


@pytest.mark.asyncio
async def test_replay_provider_order_records_entry(session_factory):
    responses: list[dict[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode() or "{}")
        responses.append({"url": str(request.url), "payload": payload})
        return httpx.Response(200, json={"data": {"order_id": "remote-replay"}})

    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)

    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-replay",
            name="Replay Provider",
            base_url="https://provider.example",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
            metadata_json={
                "automation": {
                    "endpoints": {
                        "order": {
                            "method": "POST",
                            "url": "https://provider.example/orders",
                            "payload": {"amount": "{{requestedAmount}}", "rules": "{{serviceRules}}"},
                            "response": {"providerOrderIdPath": "data.order_id"},
                        }
                    }
                }
            },
        )
        order = Order(
            id=uuid4(),
            order_number="SM-REPLAY-1",
            subtotal=Decimal("100.00"),
            tax=Decimal("0"),
            total=Decimal("100.00"),
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
            unit_price=Decimal("100.00"),
            total_price=Decimal("100.00"),
        )
        order.items.append(order_item)
        provider_order = FulfillmentProviderOrder(
            provider_id=provider.id,
            provider_name=provider.name,
            service_id="svc-replay",
            service_action="replay_action",
            order_id=order.id,
            order_item_id=order_item.id,
            amount=Decimal("150.00"),
            currency="USD",
            payload={
                "requestedAmount": 150,
                "serviceRules": [
                    {
                        "id": "rule-replay",
                        "label": "Replay safeguard",
                        "conditions": [{"kind": "channel", "channels": ["storefront"]}],
                        "overrides": {"providerId": "prov-replay"},
                    }
                ],
            },
        )

        session.add_all([provider, order])
        await session.flush()
        session.add(provider_order)
        await session.commit()

        automation = ProviderAutomationService(session, http_client=http_client)
        entry = await automation.replay_provider_order(provider_order)
        await http_client.aclose()

        await session.refresh(provider_order)
        assert entry["status"] == "executed"
        replay_entry = provider_order.payload["replays"][0]
        assert replay_entry["response"]["data"]["order_id"] == "remote-replay"
        assert replay_entry["ruleIds"] == ["rule-replay"]
        assert replay_entry["ruleMetadata"]["rule-replay"]["label"] == "Replay safeguard"
        assert replay_entry["ruleMetadata"]["rule-replay"]["conditions"][0]["kind"] == "channel"
        assert responses and responses[0]["payload"]["rules"][0]["id"] == "rule-replay"


@pytest.mark.asyncio
async def test_schedule_provider_order_replay_tracks_entry(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-schedule",
            name="Schedule Provider",
            base_url="https://provider.example",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
            metadata_json={"automation": {}},
        )
        order = Order(
            id=uuid4(),
            order_number="SM-SCHED-1",
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
            product_title="Schedule Product",
            quantity=1,
            unit_price=Decimal("50.00"),
            total_price=Decimal("50.00"),
        )
        order.items.append(order_item)
        provider_order = FulfillmentProviderOrder(
            provider_id=provider.id,
            provider_name=provider.name,
            service_id="svc-schedule",
            service_action="schedule_action",
            order_id=order.id,
            order_item_id=order_item.id,
            amount=Decimal("75.00"),
            currency="USD",
            payload={
                "serviceRules": [
                    {"id": "rule-schedule", "label": "Nightly retries", "conditions": [{"kind": "drip", "min": 10}]}
                ],
            },
        )

        session.add_all([provider, order])
        await session.flush()
        session.add(provider_order)
        await session.commit()

        automation = ProviderAutomationService(session)
        run_at = datetime.now(timezone.utc) + timedelta(hours=2)
        entry = await automation.schedule_provider_order_replay(provider_order, run_at=run_at, amount=80.0)

        await session.refresh(provider_order)
        assert entry["status"] == "scheduled"
        scheduled_entry = provider_order.payload["scheduledReplays"][0]
        assert scheduled_entry["scheduledFor"] == run_at.isoformat()
        assert scheduled_entry["requestedAmount"] == 80.0
        assert scheduled_entry["ruleIds"] == ["rule-schedule"]
        assert scheduled_entry["ruleMetadata"]["rule-schedule"]["label"] == "Nightly retries"


@pytest.mark.asyncio
async def test_scheduled_replay_worker_updates_provider_orders(session_factory):
    responses: list[dict[str, Any]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode() or "{}")
        responses.append({"url": str(request.url), "payload": payload})
        return httpx.Response(200, json={"data": {"order_id": "remote-scheduled"}})

    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)

    def automation_factory(session):
        return ProviderAutomationService(session, http_client=http_client)

    try:
        async with session_factory() as session:
            provider = FulfillmentProvider(
                id="prov-worker",
                name="Worker Provider",
                base_url="https://provider.example",
                status=FulfillmentProviderStatusEnum.ACTIVE,
                health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
                metadata_json={
                    "automation": {
                        "endpoints": {
                            "order": {
                                "method": "POST",
                                "url": "https://provider.example/orders",
                                "payload": {"amount": "{{requestedAmount}}", "rules": "{{serviceRules}}"},
                                "response": {"providerOrderIdPath": "data.order_id"},
                            }
                        }
                    }
                },
            )
            order = Order(
                id=uuid4(),
                order_number="SM-WORKER-1",
                subtotal=Decimal("90.00"),
                tax=Decimal("0"),
                total=Decimal("90.00"),
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
                unit_price=Decimal("90.00"),
                total_price=Decimal("90.00"),
            )
            order.items.append(order_item)
            provider_order = FulfillmentProviderOrder(
                provider_id=provider.id,
                provider_name=provider.name,
                service_id="svc-worker",
                service_action="automation",
                order_id=order.id,
                order_item_id=order_item.id,
                amount=Decimal("110.00"),
                currency="USD",
                payload={
                    "serviceRules": [
                        {
                            "id": "rule-scheduled",
                            "label": "Provider guardrail",
                            "conditions": [{"kind": "channel", "channels": ["storefront"]}],
                        }
                    ]
                },
            )

            session.add_all([provider, order])
            await session.flush()
            session.add(provider_order)
            await session.commit()
            await session.refresh(provider_order)
            provider_order_id = provider_order.id

            automation = ProviderAutomationService(session, http_client=http_client)
            run_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            scheduled_entry = await automation.schedule_provider_order_replay(
                provider_order,
                run_at=run_at,
                amount=95.0,
            )
            schedule_id = scheduled_entry["id"]

        worker = ProviderOrderReplayWorker(
            session_factory,
            automation_factory=automation_factory,
            clock=lambda: datetime.now(timezone.utc),
            limit=5,
        )
        summary = await worker.process_scheduled(limit=5)
        assert summary["processed"] == 1
        assert summary["succeeded"] == 1
        assert summary.get("scheduledBacklog", 0) == 0

        async with session_factory() as session:
            saved_order = await session.get(FulfillmentProviderOrder, provider_order_id)
            assert saved_order is not None
            payload = saved_order.payload
            assert payload["providerResponse"]["data"]["order_id"] == "remote-scheduled"
            replay_entries = payload["replays"]
            assert replay_entries and replay_entries[0]["status"] == "executed"
            assert replay_entries[0]["response"]["data"]["order_id"] == "remote-scheduled"
            schedule_entries = payload["scheduledReplays"]
            assert schedule_entries[0]["id"] == schedule_id
            assert schedule_entries[0]["status"] == "executed"
            assert schedule_entries[0]["response"]["status"] == "executed"
            assert schedule_entries[0]["response"]["response"]["data"]["order_id"] == "remote-scheduled"
            assert schedule_entries[0]["ruleMetadata"]["rule-scheduled"]["label"] == "Provider guardrail"

            snapshot_service = ProviderAutomationService(session)
            snapshot = await snapshot_service.build_snapshot(limit_per_provider=5)
            assert snapshot.aggregated.replays.executed == 1
            assert snapshot.providers[0].telemetry.replays.executed == 1
    finally:
        await http_client.aclose()

    assert responses and responses[0]["payload"]["rules"][0]["id"] == "rule-scheduled"


@pytest.mark.asyncio
async def test_list_orders_for_order_filters_by_order_id(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-list",
            name="List Provider",
            base_url="https://provider.example",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
            metadata_json={},
        )
        order = Order(
            id=uuid4(),
            order_number="SM-LIST-1",
            subtotal=Decimal("50.00"),
            tax=Decimal("0"),
            total=Decimal("50.00"),
            currency=CurrencyEnum.USD,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        other_order = Order(
            id=uuid4(),
            order_number="SM-LIST-2",
            subtotal=Decimal("75.00"),
            tax=Decimal("0"),
            total=Decimal("75.00"),
            currency=CurrencyEnum.USD,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            id=uuid4(),
            order=order,
            product_id=uuid4(),
            product_title="List Product",
            quantity=1,
            unit_price=Decimal("50.00"),
            total_price=Decimal("50.00"),
        )
        other_item = OrderItem(
            id=uuid4(),
            order=other_order,
            product_id=uuid4(),
            product_title="Other Product",
            quantity=1,
            unit_price=Decimal("75.00"),
            total_price=Decimal("75.00"),
        )
        order.items.append(order_item)
        other_order.items.append(other_item)
        matching_order = FulfillmentProviderOrder(
            provider_id=provider.id,
            provider_name=provider.name,
            service_id="svc-a",
            service_action="action-a",
            order_id=order.id,
            order_item_id=order_item.id,
            amount=Decimal("25.00"),
            currency="USD",
            payload={},
        )
        other_provider_order = FulfillmentProviderOrder(
            provider_id=provider.id,
            provider_name=provider.name,
            service_id="svc-b",
            service_action="action-b",
            order_id=other_order.id,
            order_item_id=other_item.id,
            amount=Decimal("30.00"),
            currency="USD",
            payload={},
        )

        session.add_all([provider, order, other_order, matching_order, other_provider_order])
        await session.commit()

        automation = ProviderAutomationService(session)
        results = await automation.list_orders_for_order(order.id)

        assert len(results) == 1
        assert results[0].order_id == order.id


@pytest.mark.asyncio
async def test_build_snapshot_summarizes_orders(session_factory):
    async with session_factory() as session:
        provider, provider_order = await _seed_provider_order(session, provider_id="prov-snapshot")
        automation = ProviderAutomationService(session)
        snapshot = await automation.build_snapshot(limit_per_provider=10)

        assert snapshot.aggregated.total_orders == 1
        entry = snapshot.providers[0]
        assert entry.id == provider.id
        assert entry.telemetry.total_orders == 1
        assert entry.telemetry.replays.executed == 1
        assert entry.telemetry.replays.failed == 1
        assert entry.telemetry.replays.scheduled == 1
        assert entry.telemetry.guardrails.warn == 1
        guardrail_hits = entry.telemetry.guardrail_hits_by_service
        assert guardrail_hits[provider_order.service_id].warn == 1
        overrides = entry.telemetry.rule_overrides_by_service
        assert overrides[provider_order.service_id].total_overrides == 2
        assert overrides[provider_order.service_id].rules["rule-margin"].count == 1
        assert overrides[provider_order.service_id].rules["rule-drip"].label == "Drip failover"


@pytest.mark.asyncio
async def test_provider_automation_snapshot_endpoint(app_with_db):
    app, session_factory = app_with_db
    async with session_factory() as session:
        await _seed_provider_order(session, provider_id="prov-endpoint")

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/providers/automation/snapshot?limitPerProvider=5")
    assert response.status_code == 200
    payload = response.json()
    assert payload["aggregated"]["totalOrders"] == 1
    assert payload["providers"][0]["telemetry"]["replays"]["executed"] == 1
    service_overrides = payload["aggregated"]["ruleOverridesByService"]["svc-snapshot"]
    assert service_overrides["totalOverrides"] == 2


@pytest.mark.asyncio
async def test_provider_automation_status_endpoint(app_with_db):
    app, _ = app_with_db

    class StubStatus:
        async def get_status(self):
            return {
                "replay": {"ranAt": datetime.now(timezone.utc).isoformat(), "summary": {"processed": 2}},
                "alerts": None,
            }

    class StubRunService:
        def __init__(self):
            self.payload = {
                "ranAt": datetime.now(timezone.utc).isoformat(),
                "summary": {
                    "scheduledBacklog": 4,
                    "nextScheduledAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                },
            }

        async def list_recent_runs(self, *, limit: int, run_type: ProviderAutomationRunTypeEnum):
            if run_type == ProviderAutomationRunTypeEnum.REPLAY:
                return ["stub"]
            return []

        def to_status_payload(self, run):
            return self.payload

    app.dependency_overrides[fp.get_automation_status_service] = lambda: StubStatus()
    app.dependency_overrides[fp.get_provider_automation_run_service] = lambda: StubRunService()

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/providers/automation/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["replay"]["summary"]["processed"] == 2
    # ensure backlog fields filled from history fallback
    assert payload["replay"]["summary"]["scheduledBacklog"] == 4
    assert "nextScheduledAt" in payload["replay"]["summary"]
    app.dependency_overrides.pop(fp.get_automation_status_service, None)
    app.dependency_overrides.pop(fp.get_provider_automation_run_service, None)


@pytest.mark.asyncio
async def test_provider_automation_history_endpoint(app_with_db):
    app, _ = app_with_db

    class StubRun:
        def __init__(self):
            self.created_at = datetime.now(timezone.utc)
            self.summary = {"processed": 1}

    class StubRunService:
        async def list_recent_runs(self, *, limit: int, run_type: ProviderAutomationRunTypeEnum):
            if run_type == ProviderAutomationRunTypeEnum.REPLAY:
                return [StubRun()]
            return []

        @staticmethod
        def to_status_payload(run):
            return {"ranAt": run.created_at.isoformat(), "summary": run.summary}

    app.dependency_overrides[fp.get_provider_automation_run_service] = lambda: StubRunService()

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/providers/automation/status/history?limit=5")

    assert response.status_code == 200
    assert response.json()["replay"][0]["summary"]["processed"] == 1
    app.dependency_overrides.pop(fp.get_provider_automation_run_service, None)


@pytest.mark.asyncio
async def test_trigger_replay_run_endpoint(monkeypatch, app_with_db):
    app, _ = app_with_db

    async def fake_run(**kwargs):
        fake_run.called = True  # type: ignore[attr-defined]

    fake_run.called = False  # type: ignore[attr-defined]
    monkeypatch.setattr(fp, "run_scheduled_replays", fake_run)

    class StubStatus:
        async def get_status(self):
            return {"replay": {"ranAt": datetime.now(timezone.utc).isoformat(), "summary": {"processed": 3}}}

    app.dependency_overrides[fp.get_automation_status_service] = lambda: StubStatus()

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/api/v1/fulfillment/providers/automation/replay/run?limit=5")

    assert response.status_code == 200
    assert fake_run.called  # type: ignore[attr-defined]
    assert response.json()["summary"]["processed"] == 3
    app.dependency_overrides.pop(fp.get_automation_status_service, None)


@pytest.mark.asyncio
async def test_trigger_alert_run_endpoint(monkeypatch, app_with_db):
    app, _ = app_with_db

    async def fake_alerts():
        fake_alerts.called = True  # type: ignore[attr-defined]

    fake_alerts.called = False  # type: ignore[attr-defined]
    monkeypatch.setattr(fp, "run_provider_alerts", fake_alerts)

    class StubStatus:
        async def get_status(self):
            return {"alerts": {"ranAt": datetime.now(timezone.utc).isoformat(), "summary": {"alertsSent": 1}}}

    app.dependency_overrides[fp.get_automation_status_service] = lambda: StubStatus()

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/api/v1/fulfillment/providers/automation/alerts/run")

    assert response.status_code == 200
    assert fake_alerts.called  # type: ignore[attr-defined]
    assert response.json()["summary"]["alertsSent"] == 1
    app.dependency_overrides.pop(fp.get_automation_status_service, None)


async def _seed_provider_order(
    session,
    *,
    provider_id: str,
) -> tuple[FulfillmentProvider, FulfillmentProviderOrder]:
    provider = FulfillmentProvider(
        id=provider_id,
        name="Snapshot Provider",
        base_url="https://provider.example",
        status=FulfillmentProviderStatusEnum.ACTIVE,
        health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
        metadata_json={},
    )
    order = Order(
        id=uuid4(),
        order_number="SM-SNAPSHOT-1",
        subtotal=Decimal("120.00"),
        tax=Decimal("0"),
        total=Decimal("120.00"),
        currency=CurrencyEnum.USD,
        status=OrderStatusEnum.PENDING,
        source=OrderSourceEnum.CHECKOUT,
    )
    order_item = OrderItem(
        id=uuid4(),
        order=order,
        product_id=uuid4(),
        product_title="Snapshot Product",
        quantity=1,
        unit_price=Decimal("120.00"),
        total_price=Decimal("120.00"),
    )
    order.items.append(order_item)
    session.add_all([provider, order])
    await session.flush()

    provider_order = FulfillmentProviderOrder(
        provider_id=provider.id,
        provider_name=provider.name,
        service_id="svc-snapshot",
        service_action="order",
        order_id=order.id,
        order_item_id=order_item.id,
        amount=Decimal("120.00"),
        currency="USD",
        payload={
            "providerCostAmount": 90,
            "guardrails": {"minimumMarginPercent": 20, "warningMarginPercent": 40},
            "refills": [
                {
                    "id": "refill-entry",
                    "amount": 40,
                    "currency": "USD",
                    "performedAt": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "replays": [
                {"id": "replay-ok", "status": "executed"},
                {"id": "replay-fail", "status": "failed"},
            ],
            "scheduledReplays": [
                {"id": "sched-ok", "status": "scheduled"},
                {"id": "sched-fail", "status": "failed"},
            ],
            "serviceRules": [
                {"id": "rule-margin", "label": "Margin override"},
                {"id": "rule-drip", "label": "Drip failover"},
            ],
        },
    )
    session.add(provider_order)
    await session.commit()
    await session.refresh(provider_order)
    return provider, provider_order


@pytest.mark.asyncio
async def test_provider_orders_by_order_response_includes_refills_and_replays(app_with_db):
    app, session_factory = app_with_db

    async with session_factory() as session:
        _, provider_order = await _seed_provider_order(session, provider_id="prov-snapshot-by-order")

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(f"/api/v1/fulfillment/providers/orders/by-order/{provider_order.order_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload and isinstance(payload, list)
    entry = payload[0]
    assert entry["providerId"] == "prov-snapshot-by-order"
    assert entry["refills"][0]["id"] == "refill-entry"
    assert entry["replays"][0]["id"] == "replay-ok"
    assert entry["scheduledReplays"][0]["id"] == "sched-ok"


@pytest.mark.asyncio
async def test_provider_orders_list_endpoint_includes_refills_and_replays(app_with_db):
    app, session_factory = app_with_db

    async with session_factory() as session:
        provider, _ = await _seed_provider_order(session, provider_id="prov-snapshot-list")

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(f"/api/v1/fulfillment/providers/{provider.id}/orders")

    assert response.status_code == 200
    payload = response.json()
    assert payload and isinstance(payload, list)
    entry = payload[0]
    assert entry["providerId"] == provider.id
    assert entry["refills"][0]["id"] == "refill-entry"
    assert entry["replays"][0]["id"] == "replay-ok"
    assert entry["scheduledReplays"][0]["id"] == "sched-ok"

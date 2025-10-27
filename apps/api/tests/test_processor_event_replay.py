from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient

from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.processor_event import (
    ProcessorEvent,
    mark_replay_requested,
    record_processor_event,
)
from smplat_api.models.webhook_event import WebhookProviderEnum
from smplat_api.workers.processor_events import ProcessorEventReplayWorker, ReplayLimitExceededError


@pytest.mark.asyncio
async def test_replay_worker_applies_event(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-6001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("0"),
            tax=Decimal("0"),
            total=Decimal("0"),
            balance_due=Decimal("0"),
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()
        invoice_id = invoice.id
        payload = {
            "id": "evt_worker",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_worker",
                    "metadata": {"invoice_id": str(invoice_id)},
                    "customer": "cus_worker",
                    "charges": {"data": [{"id": "ch_worker", "amount_captured": 1000, "created": 1}]},
                }
            },
        }
        recorded = await record_processor_event(
            session,
            provider=WebhookProviderEnum.STRIPE,
            external_id="evt_worker",
            payload_hash="hash",
            payload=payload,
            correlation_id=str(invoice.id),
            workspace_id=workspace_id,
            invoice_id=invoice_id,
        )
        await mark_replay_requested(session, event=recorded.event, requested_at=datetime.now(timezone.utc))
        await session.commit()

    worker = ProcessorEventReplayWorker(session_factory)
    await worker.replay_event(recorded.event.id, force=True)

    async with session_factory() as session:
        refreshed = await session.get(Invoice, invoice_id)
        assert refreshed is not None
        assert refreshed.status == InvoiceStatusEnum.PAID
        assert refreshed.processor_charge_id == "ch_worker"


@pytest.mark.asyncio
async def test_replay_endpoint_marks_event_for_processing(app_with_db, monkeypatch):
    app, session_factory = app_with_db

    async with session_factory() as session:
        workspace_id = uuid4()
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-6002",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("0"),
            tax=Decimal("0"),
            total=Decimal("0"),
            balance_due=Decimal("0"),
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()
        invoice_id = invoice.id
        payload = {
            "id": "evt_api",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_api",
                    "metadata": {"invoice_id": str(invoice_id)},
                    "customer": "cus_api",
                    "charges": {"data": [{"id": "ch_api", "amount_captured": 1000, "created": 1}]},
                }
            },
        }
        recorded = await record_processor_event(
            session,
            provider=WebhookProviderEnum.STRIPE,
            external_id="evt_api",
            payload_hash="hash",
            payload=payload,
            correlation_id=str(invoice.id),
            workspace_id=workspace_id,
            invoice_id=invoice_id,
        )
        await session.commit()
        event_id = recorded.event.id

    called = {}

    class StubWorker:
        def __init__(self, *_args, **_kwargs) -> None:
            called["instantiated"] = True

        async def process_pending(self, **_kwargs) -> int:
            called["processed"] = True
            return 0

        async def replay_event(self, *_args, **_kwargs):  # pragma: no cover - unused in this test
            raise AssertionError("Unexpected replay invocation")

    monkeypatch.setattr("smplat_api.api.v1.endpoints.billing_replay.ProcessorEventReplayWorker", StubWorker)

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            f"/api/v1/billing/replays/{event_id}/trigger",
            json={"force": False},
        )

    assert response.status_code == 202
    assert response.json()["replayRequested"] is True
    assert called.get("instantiated") is True
    assert called.get("processed") is True

    async with session_factory() as session:
        refreshed = await session.get(ProcessorEvent, event_id)
        assert refreshed is not None
        assert refreshed.replay_requested is True


@pytest.mark.asyncio
async def test_force_replay_guardrail_returns_conflict(app_with_db, monkeypatch):
    app, session_factory = app_with_db

    async with session_factory() as session:
        workspace_id = uuid4()
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-7001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("0"),
            tax=Decimal("0"),
            total=Decimal("0"),
            balance_due=Decimal("0"),
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()
        payload = {
            "id": "evt_force_conflict",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_force_conflict",
                    "metadata": {"invoice_id": str(invoice.id)},
                    "customer": "cus_force",
                    "charges": {"data": [{"id": "ch_force", "amount_captured": 1000, "created": 1}]},
                }
            },
        }
        recorded = await record_processor_event(
            session,
            provider=WebhookProviderEnum.STRIPE,
            external_id="evt_force_conflict",
            payload_hash="hash",
            payload=payload,
            correlation_id=str(invoice.id),
            workspace_id=workspace_id,
            invoice_id=invoice.id,
        )
        await session.commit()
        event_id = recorded.event.id

    class GuardrailWorker:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def process_pending(self, **_kwargs) -> int:  # pragma: no cover - unused
            return 0

        async def replay_event(self, *_args, **_kwargs):
            raise ReplayLimitExceededError("Replay limit reached")

    monkeypatch.setattr("smplat_api.api.v1.endpoints.billing_replay.ProcessorEventReplayWorker", GuardrailWorker)

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            f"/api/v1/billing/replays/{event_id}/trigger",
            json={"force": True},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Replay limit reached"

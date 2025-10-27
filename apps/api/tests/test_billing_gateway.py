from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import stripe
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.models.user import User, UserRoleEnum
from smplat_api.services.billing.gateway import BillingGatewayClient
from smplat_api.services.billing.providers import (
    StripeCaptureResponse,
    StripeHostedSession,
    StripeRefundResponse,
    StripeBillingProvider,
)


class StubStripeProvider:
    """Test double for StripeBillingProvider interactions."""

    def __init__(self) -> None:
        self.webhook_secret = "whsec_test"
        self.captured: list[str] = []
        self.refunded: list[str] = []

    async def capture_payment(self, **_: object) -> StripeCaptureResponse:  # type: ignore[override]
        self.captured.append("capture")
        now = datetime.now(timezone.utc)
        return StripeCaptureResponse(
            intent_id="pi_123",
            charge_id="ch_456",
            amount=Decimal("120.00"),
            currency="EUR",
            customer_id="cus_abc",
            captured_at=now,
        )

    async def refund_payment(self, **_: object) -> StripeRefundResponse:  # type: ignore[override]
        self.refunded.append("refund")
        now = datetime.now(timezone.utc)
        return StripeRefundResponse(
            refund_id="re_789",
            charge_id="ch_456",
            amount=Decimal("120.00"),
            currency="EUR",
            failure_reason=None,
            refunded_at=now,
        )

    async def create_checkout_session(self, **_: object) -> StripeHostedSession:  # type: ignore[override]
        now = datetime.now(timezone.utc)
        return StripeHostedSession(session_id="cs_test", url="https://checkout.test", expires_at=now)


@pytest.mark.asyncio
async def test_gateway_capture_updates_invoice(session_factory):
    stub_provider = StubStripeProvider()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=uuid4(),
            invoice_number="INV-3001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            balance_due=Decimal("120.00"),
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()

        gateway = BillingGatewayClient(session, provider=stub_provider)
        result = await gateway.capture_payment(invoice)

        assert result.intent_id == "pi_123"
        assert result.charge_id == "ch_456"
        assert result.was_new_intent is True
        assert invoice.payment_intent_id == "pi_123"
        assert invoice.processor_charge_id == "ch_456"
        assert invoice.processor_customer_id == "cus_abc"
        assert invoice.status == InvoiceStatusEnum.PAID
        assert invoice.balance_due == Decimal("0")
        assert invoice.payment_timeline_json and invoice.payment_timeline_json[-1]["event"] == "captured"


@pytest.mark.asyncio
async def test_gateway_refund_updates_adjustments(session_factory):
    stub_provider = StubStripeProvider()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=uuid4(),
            invoice_number="INV-3002",
            status=InvoiceStatusEnum.PAID,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            balance_due=Decimal("0"),
            payment_intent_id="pi_123",
            external_processor_id="ch_456",
            processor_charge_id="ch_456",
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()

        gateway = BillingGatewayClient(session, provider=stub_provider)
        result = await gateway.refund_payment(invoice)

        assert result.refund_id == "re_789"
        assert invoice.status == InvoiceStatusEnum.ISSUED
        assert invoice.balance_due == Decimal("120.00")
        assert invoice.adjustments_json[-1]["type"] == "refund"
        assert invoice.payment_timeline_json[-1]["event"] == "refunded"


@pytest.mark.asyncio
async def test_checkout_session_endpoint_returns_hosted_url(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "session-key"
    settings.billing_rollout_stage = "ga"
    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    stub_provider = StubStripeProvider()
    monkeypatch.setattr(StripeBillingProvider, "from_settings", staticmethod(lambda: stub_provider))

    try:
        async with session_factory() as session:
            user = User(id=workspace_id, email="checkout@example.com", role=UserRoleEnum.CLIENT)
            session.add(user)
            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-4001",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("120.00"),
                tax=Decimal("0"),
                total=Decimal("120.00"),
                balance_due=Decimal("120.00"),
                due_at=datetime.now(timezone.utc),
            )
            session.add(invoice)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/billing/invoices/{invoice.id}/checkout?workspace_id={workspace_id}",
                headers={"X-API-Key": "session-key"},
            )

        assert response.status_code == 202
        body = response.json()
        assert body["checkoutUrl"] == "https://checkout.test"
        assert body["sessionId"] == "cs_test"
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces


@pytest.mark.asyncio
async def test_stripe_webhook_updates_invoice(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    stub_provider = StubStripeProvider()
    monkeypatch.setattr(StripeBillingProvider, "from_settings", staticmethod(lambda: stub_provider))

    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="webhook@example.com", role=UserRoleEnum.CLIENT)
        session.add(user)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-5001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            balance_due=Decimal("120.00"),
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.commit()

    event_payload = {
        "id": "evt_test",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": "pi_123",
                "metadata": {"invoice_id": str(invoice.id)},
                "customer": "cus_abc",
                "charges": {
                    "data": [
                        {
                            "id": "ch_456",
                            "amount_captured": 12000,
                            "created": int(datetime.now(timezone.utc).timestamp()),
                        }
                    ]
                },
            }
        },
    }

    def fake_construct_event(payload: bytes, sig_header: str, secret: str) -> dict[str, object]:  # type: ignore[override]
        return event_payload

    monkeypatch.setattr(stripe.Webhook, 'construct_event', staticmethod(fake_construct_event))

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/billing/webhooks/stripe",
            content="{}",
            headers={"Stripe-Signature": "sig"},
        )
    assert response.status_code == 202

    async with session_factory() as session:
        refreshed = await session.get(Invoice, invoice.id)
        assert refreshed is not None
        assert refreshed.status == InvoiceStatusEnum.PAID
        assert refreshed.processor_charge_id == "ch_456"
        assert refreshed.webhook_replay_token == "evt_test"
        assert refreshed.payment_timeline_json[-1]["event"] == "captured"

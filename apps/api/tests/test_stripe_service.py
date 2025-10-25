from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
import stripe

from smplat_api.services.payments.stripe_service import StripeService


@pytest.mark.asyncio
async def test_create_checkout_session_builds_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_kwargs: dict[str, Any] = {}

    def fake_create(**kwargs: Any):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(id="cs_test_123", payment_intent="pi_test_123")

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_create)

    service = StripeService()
    session = await service.create_checkout_session(
        order_id="order-123",
        line_items=[{"price": "price_123", "quantity": 1}],
        customer_email="test@example.com",
        success_url="https://example.com/success",
        cancel_url="https://example.com/cancel",
        metadata={"foo": "bar"},
    )

    assert session.id == "cs_test_123"
    assert captured_kwargs["metadata"]["order_id"] == "order-123"
    assert captured_kwargs["payment_intent_data"]["metadata"]["foo"] == "bar"
    assert captured_kwargs["customer_email"] == "test@example.com"


@pytest.mark.asyncio
async def test_create_checkout_session_raises_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**_: Any):
        raise stripe.StripeError("creation failed")

    monkeypatch.setattr(stripe.checkout.Session, "create", boom)
    service = StripeService()

    with pytest.raises(stripe.StripeError):
        await service.create_checkout_session(
            order_id="order-456",
            line_items=[{"price": "price", "quantity": 1}],
            success_url="https://example.com/success",
            cancel_url="https://example.com/cancel",
        )


@pytest.mark.asyncio
async def test_construct_webhook_event_verifies_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    expected_event = {"type": "payment_intent.succeeded", "id": "evt_123"}

    def fake_construct(payload: bytes, signature: str, secret: str):
        assert signature == "sig_header"
        return expected_event

    monkeypatch.setattr(stripe.Webhook, "construct_event", fake_construct)

    service = StripeService()
    event = await service.construct_webhook_event(b"{}", "sig_header")
    assert event is expected_event


@pytest.mark.asyncio
async def test_construct_webhook_event_raises_on_bad_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: Any, **__: Any):
        raise stripe.SignatureVerificationError("bad signature", "payload")

    monkeypatch.setattr(stripe.Webhook, "construct_event", boom)
    service = StripeService()

    with pytest.raises(stripe.SignatureVerificationError):
        await service.construct_webhook_event(b"{}", "sig_bad")


@pytest.mark.asyncio
async def test_refund_payment_calls_stripe(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_kwargs: dict[str, Any] = {}

    def fake_refund(**kwargs: Any):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(id="re_123", amount=1000)

    monkeypatch.setattr(stripe.Refund, "create", fake_refund)
    service = StripeService()
    refund = await service.refund_payment("pi_123", amount=500, reason="requested_by_customer")

    assert refund.id == "re_123"
    assert captured_kwargs == {
        "payment_intent": "pi_123",
        "amount": 500,
        "reason": "requested_by_customer",
    }

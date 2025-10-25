from __future__ import annotations

from decimal import Decimal
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
import stripe
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from smplat_api.core.settings import settings
from smplat_api.observability.payments import get_payment_store
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.payment import Payment, PaymentProviderEnum, PaymentStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.payments.payment_service import PaymentService
from smplat_api.services.payments.stripe_service import StripeService


async def _persist_order(session_factory):
    async with session_factory() as session:
        product = Product(
            slug="api-checkout-product",
            title="API Checkout Product",
            category="instagram",
            base_price=Decimal("299.00"),
            currency=CurrencyEnum.EUR,
            status=ProductStatusEnum.ACTIVE,
        )

        session.add(product)
        await session.flush()

        order = Order(
            order_number="SM200001",
            subtotal=Decimal("299.00"),
            tax=Decimal("0"),
            total=Decimal("299.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order.items.append(
            OrderItem(
                product_id=product.id,
                product_title=product.title,
                quantity=1,
                unit_price=Decimal("299.00"),
                total_price=Decimal("299.00"),
            )
        )
        session.add(order)
        await session.commit()
        await session.refresh(order)
        return order


@pytest.mark.asyncio
async def test_create_checkout_session_endpoint(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    get_payment_store().reset()
    order = await _persist_order(session_factory)

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "test-key"

    try:
        fake_response = {
            "checkout_session_id": "cs_test_123",
            "checkout_url": "https://stripe.test/session/cs_test_123",
            "payment_id": "pi_test_123",
            "amount": 299.0,
            "currency": "eur",
        }
        monkeypatch.setattr(
            PaymentService,
            "initiate_stripe_checkout",
            AsyncMock(return_value=fake_response),
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/payments/checkout",
                headers={"X-API-Key": "test-key"},
                json={
                    "order_id": str(order.id),
                    "success_url": "https://example.com/success",
                    "cancel_url": "https://example.com/cancel",
                    "customer_email": "buyer@example.com",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["checkout_session_id"] == "cs_test_123"
        PaymentService.initiate_stripe_checkout.assert_awaited_once()
        checkout_snapshot = get_payment_store().snapshot().as_dict()
        assert checkout_snapshot["checkout"]["totals"]["succeeded"] == 1
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_create_checkout_session_requires_api_key(app_with_db):
    app, session_factory = app_with_db
    get_payment_store().reset()
    order = await _persist_order(session_factory)

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "prod-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/payments/checkout",
                json={
                    "order_id": str(order.id),
                    "success_url": "https://example.com/success",
                    "cancel_url": "https://example.com/cancel",
                },
            )
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_checkout_session_missing_order_returns_404(app_with_db, monkeypatch):
    app, _session_factory = app_with_db
    get_payment_store().reset()
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "test-key"

    try:
        monkeypatch.setattr(
            PaymentService,
            "initiate_stripe_checkout",
            AsyncMock(side_effect=AssertionError("Should not be called")),
        )
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/payments/checkout",
                headers={"X-API-Key": "test-key"},
                json={
                    "order_id": str(uuid4()),
                    "success_url": "https://example.com/success",
                    "cancel_url": "https://example.com/cancel",
                },
            )
        assert response.status_code == 404
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_handle_stripe_webhook_success(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    get_payment_store().reset()

    stripe_event = {"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_test"}}}

    monkeypatch.setattr(
        StripeService,
        "construct_webhook_event",
        AsyncMock(return_value=stripe_event),
    )
    monkeypatch.setattr(
        PaymentService,
        "process_stripe_webhook_event",
        AsyncMock(return_value=True),
    )

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/payments/webhooks/stripe",
            content=b"{}",
            headers={"stripe-signature": "sig_test"},
        )

    assert response.status_code == 200
    assert response.json()["success"] is True
    PaymentService.process_stripe_webhook_event.assert_awaited_once()
    snapshot = get_payment_store().snapshot().as_dict()
    assert snapshot["webhooks"]["totals"]["processed"]["payment_intent.succeeded"] == 1


@pytest.mark.asyncio
async def test_handle_stripe_webhook_processing_failure_triggers_retry(app_with_db, monkeypatch):
    app, _session_factory = app_with_db
    get_payment_store().reset()

    stripe_event = {"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_test"}}}

    monkeypatch.setattr(
        StripeService,
        "construct_webhook_event",
        AsyncMock(return_value=stripe_event),
    )
    monkeypatch.setattr(
        PaymentService,
        "process_stripe_webhook_event",
        AsyncMock(return_value=False),
    )

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/payments/webhooks/stripe",
            content=b"{}",
            headers={"stripe-signature": "sig_test"},
        )

    assert response.status_code == 500
    assert response.json()["detail"] == "Webhook processing failed"
    PaymentService.process_stripe_webhook_event.assert_awaited_once()
    snapshot = get_payment_store().snapshot().as_dict()
    assert snapshot["webhooks"]["totals"]["failed"]["payment_intent.succeeded"] == 1


@pytest.mark.asyncio
async def test_handle_stripe_webhook_invalid_signature(app_with_db, monkeypatch):
    app, _session_factory = app_with_db
    get_payment_store().reset()

    async def boom(*_args, **_kwargs):
        raise stripe.SignatureVerificationError("bad signature", "payload")

    monkeypatch.setattr(StripeService, "construct_webhook_event", boom)

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/payments/webhooks/stripe",
            content=b"{}",
            headers={"stripe-signature": "sig_bad"},
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_payment_status(app_with_db):
    app, session_factory = app_with_db
    get_payment_store().reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "status-key"

    async with session_factory() as session:
        order = Order(
            order_number="SM300001",
            subtotal=Decimal("42.00"),
            tax=Decimal("0"),
            total=Decimal("42.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_status",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("42.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()
        await session.refresh(payment)

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(
            f"/api/v1/payments/status/{payment.id}",
            headers={"X-API-Key": "status-key"},
        )

    try:
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == PaymentStatusEnum.PENDING.value
        assert body["provider_reference"] == "pi_status"
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_get_payment_status_requires_api_key(app_with_db):
    app, session_factory = app_with_db
    get_payment_store().reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "status-key"

    async with session_factory() as session:
        order = Order(
            order_number="SM300002",
            subtotal=Decimal("50.00"),
            tax=Decimal("0"),
            total=Decimal("50.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_status_guard",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("50.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()
        await session.refresh(payment)

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(f"/api/v1/payments/status/{payment.id}")
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_payments_observability_endpoint_requires_key(app_with_db):
    app, _session_factory = app_with_db
    get_payment_store().reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "observability-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/v1/payments/observability")
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_payments_observability_endpoint_returns_snapshot(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    store = get_payment_store()
    store.reset()

    order = await _persist_order(session_factory)

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "observability-key"

    try:
        fake_response = {
            "checkout_session_id": "cs_obs_123",
            "checkout_url": "https://stripe.test/session/cs_obs_123",
            "payment_id": "pi_obs_123",
            "amount": 299.0,
            "currency": "eur",
        }
        monkeypatch.setattr(
            PaymentService,
            "initiate_stripe_checkout",
            AsyncMock(return_value=fake_response),
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/checkout",
                headers={"X-API-Key": "observability-key"},
                json={
                    "order_id": str(order.id),
                    "success_url": "https://example.com/success",
                    "cancel_url": "https://example.com/cancel",
                },
            )
            observability = await client.get(
                "/api/v1/payments/observability",
                headers={"X-API-Key": "observability-key"},
            )

        assert observability.status_code == 200
        body = observability.json()
        assert body["checkout"]["totals"]["succeeded"] >= 1
        assert "processed" in body["webhooks"]["totals"]
    finally:
        settings.checkout_api_key = previous_key

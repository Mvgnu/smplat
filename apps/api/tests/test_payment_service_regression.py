from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.payment import Payment, PaymentProviderEnum, PaymentStatusEnum
from smplat_api.models.webhook_event import WebhookEvent, WebhookProviderEnum
from smplat_api.services.payments.payment_service import PaymentService

FIXTURE_DIR = Path(__file__).parent / "fixtures"


def load_event(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text())


@pytest.mark.asyncio
async def test_process_stripe_webhook_succeeds_and_records_event(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM800001",
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
            provider_reference="pi_retry",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("50.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()

        service = PaymentService(session)
        event = load_event("payment_intent_succeeded.json")
        result = await service.process_stripe_webhook_event(event)

        assert result is True
        refreshed = await session.get(Payment, payment.id)
        assert refreshed.status == PaymentStatusEnum.SUCCEEDED

        events = (
            await session.execute(select(WebhookEvent).where(WebhookEvent.external_id == "evt_retry"))
        ).scalars().all()
        assert len(events) == 1


@pytest.mark.asyncio
async def test_process_stripe_webhook_duplicate(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM800002",
            subtotal=Decimal("20.00"),
            tax=Decimal("0"),
            total=Decimal("20.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_dup",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("20.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()

        # Record initial webhook event
        session.add(
            WebhookEvent(
                provider=WebhookProviderEnum.STRIPE,
                external_id="evt_duplicate",
                event_type="payment_intent.succeeded",
            )
        )
        await session.commit()

        service = PaymentService(session)
        event = load_event("payment_intent_duplicate.json")
        result = await service.process_stripe_webhook_event(event)

        assert result is True  # duplicate is ignored gracefully
        refreshed = await session.get(Payment, payment.id)
        assert refreshed.status == PaymentStatusEnum.PENDING
        events = (
            await session.execute(select(WebhookEvent).where(WebhookEvent.external_id == "evt_duplicate"))
        ).scalars().all()
        assert len(events) == 1


@pytest.mark.asyncio
async def test_process_stripe_webhook_failure_marks_order(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM800003",
            subtotal=Decimal("60.00"),
            tax=Decimal("0"),
            total=Decimal("60.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_failed",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("60.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()

        service = PaymentService(session)
        event = load_event("payment_intent_failed.json")
        result = await service.process_stripe_webhook_event(event)

        assert result is True
        refreshed_order = await session.get(Order, order.id)
        assert refreshed_order.status == OrderStatusEnum.ON_HOLD
        assert "card_declined" in (refreshed_order.notes or "")
        failure_events = (
            await session.execute(select(WebhookEvent).where(WebhookEvent.external_id == "evt_failed"))
        ).scalars().all()
        assert len(failure_events) == 1

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.payment import Payment, PaymentProviderEnum, PaymentStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.notifications import NotificationService
from smplat_api.services.orders.receipt_artifacts import ReceiptAttachmentResult
from smplat_api.services.delivery_proof import (
    DeliveryProofAggregatesEnvelope,
    DeliveryProofMetricAggregateResponse,
    DeliveryProofProductAggregateResponse,
)


def _build_pricing_experiment_attributes() -> dict[str, object]:
    return {
        "pricingExperiment": {
            "slug": "spring-offer",
            "name": "Spring Offer",
            "variantKey": "variant-a",
            "variantName": "Variant A",
            "isControl": False,
            "assignmentStrategy": "sequential",
            "status": "running",
            "featureFlagKey": "experiments.spring_offer",
        }
    }


async def _create_user_with_preferences(session):
    user = User(
        email="client@example.com",
        display_name="Client Ops",
        role=UserRoleEnum.CLIENT,
        status=UserStatusEnum.ACTIVE,
    )
    session.add(user)
    await session.flush()
    preferences = NotificationPreference(
        user_id=user.id,
        order_updates=True,
        payment_updates=True,
        fulfillment_alerts=True,
        marketing_messages=False,
        billing_alerts=True,
    )
    session.add(preferences)
    await session.flush()
    return user


def _build_order(user_id) -> Order:
    order = Order(
        order_number="SM-9001",
        subtotal=Decimal("100.00"),
        tax=Decimal("0"),
        total=Decimal("100.00"),
        currency=CurrencyEnum.USD,
        status=OrderStatusEnum.PROCESSING,
        source=OrderSourceEnum.CHECKOUT,
        user_id=user_id,
        loyalty_projection_points=2400,
    )
    OrderItem(
        order=order,
        product_title="Growth Booster",
        quantity=1,
        unit_price=Decimal("100.00"),
        total_price=Decimal("100.00"),
        selected_options={
            "options": [
                {
                    "groupId": "bundle",
                    "groupName": "Bundle",
                    "optionId": "growth",
                    "label": "Growth Booster",
                }
            ]
        },
        attributes=_build_pricing_experiment_attributes(),
    )
    return order


class _StubReceiptService:
    def __init__(self, attachment: ReceiptAttachmentResult | None = None) -> None:
        self.attachment = attachment
        self.calls: list[str] = []

    async def build_attachment(self, order: Order) -> ReceiptAttachmentResult | None:
        self.calls.append(str(order.id))
        return self.attachment


@pytest.mark.asyncio
async def test_order_status_email_includes_experiment_banner(session_factory):
    async with session_factory() as session:
        user = await _create_user_with_preferences(session)
        order = _build_order(user.id)
        session.add(order)
        await session.commit()

        notifications = NotificationService(session, receipt_service=_StubReceiptService())
        backend = notifications.use_in_memory_backend()

        await notifications.send_order_status_update(order, previous_status=OrderStatusEnum.PENDING)

        assert backend.sent_messages, "Expected order status email"
        message = backend.sent_messages[-1]
        text_content = message.get_body(preferencelist=("plain",)).get_content()
        assert "Pricing experiments" in text_content
        assert "Spring Offer" in text_content
        html_content = message.get_body(preferencelist=("html",)).get_content()
        assert "Variant A" in html_content


@pytest.mark.asyncio
async def test_payment_success_email_mentions_experiment(session_factory):
    async with session_factory() as session:
        user = await _create_user_with_preferences(session)
        order = _build_order(user.id)
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_123",
            status=PaymentStatusEnum.SUCCEEDED,
            amount=Decimal("100.00"),
            currency=CurrencyEnum.USD,
        )
        session.add_all([order, payment])
        await session.commit()

        notifications = NotificationService(session, receipt_service=_StubReceiptService())
        backend = notifications.use_in_memory_backend()

        await notifications.send_payment_success(payment)

        assert backend.sent_messages, "Expected payment success email"
    message = backend.sent_messages[-1]
    body = message.get_body(preferencelist=("plain",)).get_content()
    assert "Pricing experiments" in body
    assert "Spring Offer" in body
    assert "Variant A" in body


@pytest.mark.asyncio
async def test_payment_success_email_includes_delivery_proof(session_factory):
    async with session_factory() as session:
        user = await _create_user_with_preferences(session)
        order = _build_order(user.id)
        order.items[0].product_id = UUID("4d9a9b2e-7ad9-4a2a-a59d-2a6c1482fb65")
        order.items[0].baseline_metrics = {"followerCount": 1200}
        order.items[0].delivery_snapshots = {
            "latest": {
                "metrics": {"followerCount": 1500},
                "recordedAt": "2024-05-02T12:00:00Z",
                "warnings": [],
            },
            "history": [
                {"metrics": {"followerCount": 1200}, "recordedAt": "2024-04-20T12:00:00Z", "warnings": []},
            ],
        }
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_124",
            status=PaymentStatusEnum.SUCCEEDED,
            amount=Decimal("100.00"),
            currency=CurrencyEnum.USD,
        )
        session.add_all([order, payment])
        await session.commit()

        notifications = NotificationService(session, receipt_service=_StubReceiptService())
        backend = notifications.use_in_memory_backend()

        await notifications.send_payment_success(payment)

        message = backend.sent_messages[-1]
        body = message.get_body(preferencelist=("plain",)).get_content()
        assert "Delivery proof" in body
        assert "Latest 1,500 followers" in body


@pytest.mark.asyncio
async def test_payment_success_includes_receipt_attachment(session_factory):
    async with session_factory() as session:
        user = await _create_user_with_preferences(session)
        order = _build_order(user.id)
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_attachments",
            status=PaymentStatusEnum.SUCCEEDED,
            amount=Decimal("100.00"),
            currency=CurrencyEnum.USD,
        )
        session.add_all([order, payment])
        await session.commit()

        attachment = ReceiptAttachmentResult(
            filename="smplat-order-SM-9001.pdf",
            content_type="application/pdf",
            payload=b"%PDF-1.4",
            storage_key="receipts/order.pdf",
            public_url="https://cdn.test/receipts/order.pdf",
            uploaded_at=datetime(2024, 5, 1, 12, 0, 0, tzinfo=timezone.utc),
        )
        receipt_service = _StubReceiptService(attachment)
        notifications = NotificationService(session, receipt_service=receipt_service)
        backend = notifications.use_in_memory_backend()

        await notifications.send_payment_success(payment)

        message = backend.sent_messages[-1]
        attachments = list(message.iter_attachments())
        assert attachments, "Expected PDF attachment"
        assert attachments[0].get_filename() == attachment.filename
        event = notifications.sent_events[-1]
        assert event.metadata.get("receipt_storage_url") == attachment.public_url


@pytest.mark.asyncio
@patch("smplat_api.services.notifications.service.fetch_delivery_proof_aggregates", new_callable=AsyncMock)
@patch("smplat_api.services.notifications.service.fetch_order_delivery_proof", new_callable=AsyncMock)
async def test_payment_success_uses_aggregate_fallback(
    mock_fetch_order_delivery_proof,
    mock_fetch_delivery_proof_aggregates,
    session_factory,
):
    async with session_factory() as session:
        user = await _create_user_with_preferences(session)
        order = _build_order(user.id)
        product_uuid = UUID("9c349a52-38df-4bb6-b73c-1c88b6de5b4c")
        order.items[0].product_id = product_uuid
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_fallback",
            status=PaymentStatusEnum.SUCCEEDED,
            amount=Decimal("100.00"),
            currency=CurrencyEnum.USD,
        )
        session.add_all([order, payment])
        await session.commit()

        mock_fetch_order_delivery_proof.return_value = None
        mock_fetch_delivery_proof_aggregates.return_value = DeliveryProofAggregatesEnvelope(
            generatedAt="2024-05-01T00:00:00Z",
            windowDays=30,
            products=[
                DeliveryProofProductAggregateResponse(
                    productId=str(product_uuid),
                    productSlug="growth",
                    productTitle="Growth Booster",
                    sampleSize=7,
                    platforms=[],
                    lastSnapshotAt=None,
                    metrics=[
                        DeliveryProofMetricAggregateResponse(
                            metricId="followers",
                            metricKey="followerCount",
                            metricLabel="Followers",
                            unit=None,
                            sampleSize=7,
                            baselineAverage=None,
                            latestAverage=None,
                            deltaAverage=500,
                            deltaPercent=0.5,
                            formattedDelta="+500",
                            formattedLatest="1,500",
                            formattedPercent="+50%",
                        )
                    ],
                )
            ],
        )

        notifications = NotificationService(session)
        backend = notifications.use_in_memory_backend()

        await notifications.send_payment_success(payment)

        message = backend.sent_messages[-1]
        body = message.get_body(preferencelist=("plain",)).get_content()
        assert "Automation is capturing the first live snapshot" in body
        assert "+50%" in body

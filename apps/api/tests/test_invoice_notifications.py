from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.invoice import Invoice, InvoiceLineItem, InvoiceStatusEnum
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.notifications import NotificationService


@pytest.mark.asyncio
async def test_invoice_overdue_includes_blueprint_snapshot(session_factory):
    async with session_factory() as session:
        workspace = User(
            email="ops@example.com",
            display_name="Ops Team",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(workspace)
        await session.flush()

        preferences = NotificationPreference(
            user_id=workspace.id,
            order_updates=True,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=False,
            billing_alerts=True,
        )
        session.add(preferences)

        order = Order(
            order_number="SM2001",
            subtotal=Decimal("500.00"),
            tax=Decimal("0"),
            total=Decimal("500.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
            user_id=workspace.id,
        )
        order_item = OrderItem(
            order=order,
            product_title="Hero coverage ++",
            quantity=1,
            unit_price=Decimal("500.00"),
            total_price=Decimal("500.00"),
            selected_options={
                "options": [
                    {
                        "groupId": "hero",
                        "groupName": "Hero",
                        "optionId": "hero-pro",
                        "label": "Hero coverage ++",
                        "marketingTagline": "24/7 hero ops",
                        "fulfillmentSla": "48h",
                    }
                ],
                "addOns": [
                    {
                        "id": "qa-escort",
                        "label": "Concierge QA",
                        "priceDelta": 150,
                        "pricingMode": "flat",
                        "serviceProviderName": "Ops Pod Zeta",
                    }
                ],
            },
        )

        invoice = Invoice(
            workspace_id=workspace.id,
            invoice_number="INV-100",
            status=InvoiceStatusEnum.OVERDUE,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("500.00"),
            tax=Decimal("0"),
            total=Decimal("500.00"),
            balance_due=Decimal("500.00"),
            due_at=datetime.utcnow() - timedelta(days=7),
        )
        line_item = InvoiceLineItem(
            invoice=invoice,
            order=order,
            order_id=order.id,
            description="Blueprint retainer",
            quantity=Decimal("1"),
            unit_amount=Decimal("500.00"),
            total_amount=Decimal("500.00"),
        )

        session.add_all([order, order_item, invoice, line_item])
        await session.commit()

        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()

        await notification_service.send_invoice_overdue(invoice)

        assert backend.sent_messages, "Expected invoice overdue email to send"
        message = backend.sent_messages[-1]
        html_part = message.get_body(preferencelist=("html",))
        assert html_part is not None
        html_content = html_part.get_content()
        assert "Order SM2001 blueprint" in html_content
        assert "Hero coverage ++" in html_content
        text_part = message.get_body(preferencelist=("plain",))
        assert text_part is not None
        text_content = text_part.get_content()
        assert "Blueprint snapshots" in text_content
        assert "Concierge QA" in text_content

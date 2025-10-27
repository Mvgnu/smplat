from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.invoice import Invoice, InvoiceLineItem, InvoiceStatusEnum
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.user import User, UserRoleEnum


@pytest.mark.asyncio
async def test_list_invoices_scoped_to_workspace(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "test-key"
    settings.billing_rollout_stage = "pilot"

    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    try:
        async with session_factory() as session:
            user = User(
                id=workspace_id,
                email="billing@example.com",
                role=UserRoleEnum.CLIENT,
            )
            session.add(user)

            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-1001",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("400.00"),
                tax=Decimal("80.00"),
                total=Decimal("480.00"),
                balance_due=Decimal("480.00"),
                issued_at=datetime.now(timezone.utc) - timedelta(days=10),
                due_at=datetime.now(timezone.utc) - timedelta(days=2),
            )
            invoice.line_items = [
                InvoiceLineItem(
                    description="Campaign activation",
                    quantity=Decimal("1"),
                    unit_amount=Decimal("480.00"),
                    total_amount=Decimal("480.00"),
                    campaign_reference="Launch A",
                )
            ]
            session.add(invoice)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/billing/invoices?workspace_id={workspace_id}",
                headers={"X-API-Key": "test-key"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["summary"]["outstanding_total"] == 480.0
        assert body["aging"]["ninetyPlus"] == 0.0
        assert len(body["invoices"]) == 1
        assert body["invoices"][0]["status"] == "overdue"
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces


@pytest.mark.asyncio
async def test_invoice_export_streams_csv(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "export-key"
    settings.billing_rollout_stage = "ga"

    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    try:
        async with session_factory() as session:
            user = User(id=workspace_id, email="finance@example.com", role=UserRoleEnum.CLIENT)
            session.add(user)

            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-2002",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("250.00"),
                tax=Decimal("50.00"),
                total=Decimal("300.00"),
                balance_due=Decimal("300.00"),
                issued_at=datetime.now(timezone.utc),
                due_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
            session.add(invoice)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/billing/invoices/{invoice.id}/export?workspace_id={workspace_id}",
                headers={"X-API-Key": "export-key"},
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "Invoice" in response.text
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces


@pytest.mark.asyncio
async def test_invoice_notify_honors_preferences(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "notify-key"
    settings.billing_rollout_stage = "pilot"

    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    try:
        async with session_factory() as session:
            user = User(id=workspace_id, email="owner@example.com", role=UserRoleEnum.CLIENT)
            preference = NotificationPreference(
                user_id=workspace_id,
                order_updates=True,
                payment_updates=True,
                fulfillment_alerts=True,
                marketing_messages=False,
                billing_alerts=True,
            )
            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-3003",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("150.00"),
                tax=Decimal("30.00"),
                total=Decimal("180.00"),
                balance_due=Decimal("120.00"),
                issued_at=datetime.now(timezone.utc) - timedelta(days=14),
                due_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
            session.add_all([user, preference, invoice])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/billing/invoices/{invoice.id}/notify?workspace_id={workspace_id}",
                headers={"X-API-Key": "notify-key"},
            )

        assert response.status_code == 202
        assert response.json()["status"] == "queued"
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces

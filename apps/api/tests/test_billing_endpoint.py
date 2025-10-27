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


@pytest.mark.asyncio
async def test_capture_invoice_partial_updates_balance_and_timeline(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "capture-key"
    settings.billing_rollout_stage = "ga"

    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    try:
        async with session_factory() as session:
            user = User(id=workspace_id, email="capture@example.com", role=UserRoleEnum.CLIENT)
            now = datetime.now(timezone.utc)
            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-4004",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("100.00"),
                tax=Decimal("20.00"),
                total=Decimal("120.00"),
                balance_due=Decimal("120.00"),
                issued_at=now,
                due_at=now + timedelta(days=14),
            )
            session.add_all([user, invoice])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/billing/invoices/{invoice.id}/capture?workspace_id={workspace_id}",
                headers={"X-API-Key": "capture-key"},
                json={"amount": 60.0},
            )

        assert response.status_code == 202
        body = response.json()
        assert pytest.approx(body["balance_due"], rel=1e-5) == 60.0
        assert body["paymentTimeline"]
        assert body["status"] == "issued"

        async with session_factory() as session:
            refreshed = await session.get(Invoice, invoice.id)
            assert refreshed is not None
            assert refreshed.balance_due == Decimal("60.00")
            assert refreshed.payment_timeline_json[-1]["event"] == "captured"
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces


@pytest.mark.asyncio
async def test_refund_invoice_records_adjustment(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_stage = settings.billing_rollout_stage
    previous_workspaces = list(settings.billing_rollout_workspaces)
    settings.checkout_api_key = "refund-key"
    settings.billing_rollout_stage = "ga"

    workspace_id = uuid4()
    settings.billing_rollout_workspaces = [str(workspace_id)]

    try:
        async with session_factory() as session:
            user = User(id=workspace_id, email="refund@example.com", role=UserRoleEnum.CLIENT)
            now = datetime.now(timezone.utc)
            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-5005",
                status=InvoiceStatusEnum.PAID,
                currency=CurrencyEnum.EUR,
                subtotal=Decimal("80.00"),
                tax=Decimal("16.00"),
                total=Decimal("96.00"),
                balance_due=Decimal("0"),
                payment_intent_id="pi_test",
                external_processor_id="txn_test",
                payment_timeline_json=[{"event": "captured", "at": now.isoformat(), "amount": 96.0}],
                issued_at=now - timedelta(days=3),
                due_at=now,
            )
            session.add_all([user, invoice])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/billing/invoices/{invoice.id}/refund?workspace_id={workspace_id}",
                headers={"X-API-Key": "refund-key"},
                json={"amount": 25.0},
            )

        assert response.status_code == 202
        body = response.json()
        assert body["adjustmentsTotal"] == pytest.approx(-25.0)
        assert any(entry["event"] == "refunded" for entry in body["paymentTimeline"])

        async with session_factory() as session:
            refreshed = await session.get(Invoice, invoice.id)
            assert refreshed is not None
            assert refreshed.adjustments_total == Decimal("-25.00")
            assert refreshed.adjustments_json[-1]["type"] == "refund"
    finally:
        settings.checkout_api_key = previous_key
        settings.billing_rollout_stage = previous_stage
        settings.billing_rollout_workspaces = previous_workspaces

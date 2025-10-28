from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


@pytest.mark.asyncio
async def test_hosted_session_report_returns_funnel_metrics(app_with_db):
    app, session_factory = app_with_db
    workspace_id = uuid4()
    previous_stage = settings.billing_rollout_stage
    previous_key = settings.checkout_api_key
    previous_secret = settings.stripe_secret_key
    previous_webhook = settings.stripe_webhook_secret
    settings.billing_rollout_stage = "ga"
    settings.checkout_api_key = "ops-key"
    settings.stripe_secret_key = "sk_test"
    settings.stripe_webhook_secret = "whsec_test"

    created_at = datetime.now(timezone.utc) - timedelta(hours=3)

    try:
        async with session_factory() as session:
            invoice_open = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-7001",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=120,
                tax=0,
                total=120,
                balance_due=120,
                due_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
            invoice_paid = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-7002",
                status=InvoiceStatusEnum.PAID,
                currency=CurrencyEnum.EUR,
                subtotal=90,
                tax=0,
                total=90,
                balance_due=0,
                paid_at=datetime.now(timezone.utc) - timedelta(hours=1),
                due_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
            session.add_all([invoice_open, invoice_paid])
            await session.flush()

            completed_session = HostedCheckoutSession(
                session_id="cs_completed",
                workspace_id=workspace_id,
                invoice_id=invoice_open.id,
                status=HostedCheckoutSessionStatusEnum.COMPLETED,
                created_at=created_at,
                completed_at=created_at + timedelta(minutes=15),
                retry_count=1,
                last_retry_at=created_at + timedelta(minutes=5),
            )
            failed_session = HostedCheckoutSession(
                session_id="cs_failed",
                workspace_id=workspace_id,
                invoice_id=invoice_open.id,
                status=HostedCheckoutSessionStatusEnum.FAILED,
                created_at=created_at + timedelta(minutes=10),
                last_error="processor_card_declined",
                retry_count=2,
                last_retry_at=created_at + timedelta(minutes=40),
                next_retry_at=datetime.now(timezone.utc) + timedelta(hours=2),
            )
            pending_session = HostedCheckoutSession(
                session_id="cs_pending",
                workspace_id=workspace_id,
                invoice_id=invoice_paid.id,
                status=HostedCheckoutSessionStatusEnum.INITIATED,
                created_at=created_at + timedelta(minutes=20),
                retry_count=0,
                next_retry_at=datetime.now(timezone.utc) + timedelta(hours=4),
            )
            abandoned_session = HostedCheckoutSession(
                session_id="cs_abandoned",
                workspace_id=workspace_id,
                invoice_id=invoice_paid.id,
                status=HostedCheckoutSessionStatusEnum.ABANDONED,
                created_at=created_at + timedelta(minutes=30),
                last_error="invoice_settled_externally",
            )

            session.add_all(
                [completed_session, failed_session, pending_session, abandoned_session]
            )
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/billing/reports",
                params={"workspaceId": str(workspace_id)},
                headers={"X-API-Key": settings.checkout_api_key},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["workspaceId"] == str(workspace_id)
        assert payload["metrics"]["total"] == 4
        assert payload["metrics"]["statusCounts"][HostedCheckoutSessionStatusEnum.COMPLETED.value] == 1
        assert payload["metrics"]["statusCounts"][HostedCheckoutSessionStatusEnum.FAILED.value] == 1
        assert payload["metrics"]["sessionsWithRetries"] == 2
        assert payload["metrics"]["pendingRegeneration"] >= 1
        assert any(
            reason["reason"] == "processor_card_declined" for reason in payload["abandonmentReasons"]
        )
        assert any(status["status"] == InvoiceStatusEnum.ISSUED.value for status in payload["invoiceStatuses"])
    finally:
        settings.billing_rollout_stage = previous_stage
        settings.checkout_api_key = previous_key
        settings.stripe_secret_key = previous_secret
        settings.stripe_webhook_secret = previous_webhook

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.event_handlers import handle_stripe_event
from smplat_api.services.billing.sessions import sweep_hosted_sessions
from smplat_api.services.billing.providers import StripeHostedSession


@pytest.mark.asyncio
async def test_checkout_webhook_transitions_update_hosted_session(session_factory):
    workspace_id = uuid4()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-9001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=100,
            tax=0,
            total=100,
            balance_due=100,
            due_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        await session.flush()

        hosted = HostedCheckoutSession(
            session_id="cs_test",
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.INITIATED,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            metadata_json={
                "success_url": "https://success",
                "cancel_url": "https://cancel",
                "hosted_session_id": None,
            },
        )
        session.add(hosted)
        await session.flush()
        invoice.hosted_session_id = hosted.id
        hosted.metadata_json["hosted_session_id"] = str(hosted.id)
        await session.commit()

        await session.refresh(invoice, attribute_names=["hosted_sessions"])
        completed_payload = {
            "id": "cs_test",
            "payment_intent": "pi_123",
            "completed_at": int(datetime.now(timezone.utc).timestamp()),
        }
        await handle_stripe_event(session, invoice, "checkout.session.completed", completed_payload)
        assert hosted.status == HostedCheckoutSessionStatusEnum.COMPLETED
        assert hosted.completed_at is not None
        assert hosted.metadata_json["last_webhook_event"] == "checkout.session.completed"
        assert hosted.metadata_json.get("payment_intent_id") == "pi_123"

        expired_payload = {
            "id": "cs_test",
            "status": "expired",
            "expires_at": int(datetime.now(timezone.utc).timestamp()),
        }
        await handle_stripe_event(session, invoice, "checkout.session.expired", expired_payload)
        assert hosted.status == HostedCheckoutSessionStatusEnum.COMPLETED


@pytest.mark.asyncio
async def test_sweep_hosted_sessions_marks_expired_and_abandoned(session_factory):
    workspace_id = uuid4()
    async with session_factory() as session:
        invoice_paid = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-9002",
            status=InvoiceStatusEnum.PAID,
            currency=CurrencyEnum.EUR,
            subtotal=100,
            tax=0,
            total=100,
            balance_due=0,
            paid_at=datetime.now(timezone.utc) - timedelta(days=1),
            due_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        invoice_open = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-9003",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=120,
            tax=0,
            total=120,
            balance_due=120,
            due_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        session.add_all([invoice_paid, invoice_open])
        await session.flush()

        abandoned_candidate = HostedCheckoutSession(
            session_id="cs_paid",
            workspace_id=workspace_id,
            invoice_id=invoice_paid.id,
            status=HostedCheckoutSessionStatusEnum.INITIATED,
            metadata_json={"success_url": "https://success", "cancel_url": "https://cancel"},
        )
        expired_candidate = HostedCheckoutSession(
            session_id="cs_expired",
            workspace_id=workspace_id,
            invoice_id=invoice_open.id,
            status=HostedCheckoutSessionStatusEnum.INITIATED,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
            metadata_json={"success_url": "https://success", "cancel_url": "https://cancel"},
        )
        session.add_all([abandoned_candidate, expired_candidate])
        await session.commit()

        result = await sweep_hosted_sessions(
            session,
            now=datetime.now(timezone.utc),
            limit=10,
        )
        await session.commit()

        assert result == {"expired": 1, "abandoned": 1}
        await session.refresh(abandoned_candidate)
        await session.refresh(expired_candidate)
        assert abandoned_candidate.status == HostedCheckoutSessionStatusEnum.ABANDONED
        assert expired_candidate.status == HostedCheckoutSessionStatusEnum.EXPIRED


@pytest.mark.asyncio
async def test_billing_sessions_regeneration_flow(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    workspace_id = uuid4()

    class StubStripeProvider:
        def __init__(self) -> None:
            self.created: list[str] = []

        async def create_checkout_session(self, **_: object) -> StripeHostedSession:  # type: ignore[override]
            self.created.append("session")
            return StripeHostedSession(
                session_id="cs_regenerated",
                url="https://checkout.example/regenerated",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
            )

    stub_provider = StubStripeProvider()
    monkeypatch.setattr(
        "smplat_api.services.billing.providers.StripeBillingProvider.from_credentials",
        staticmethod(lambda *args, **kwargs: stub_provider),
    )

    previous_stage = settings.billing_rollout_stage
    previous_key = settings.checkout_api_key
    previous_secret = settings.stripe_secret_key
    previous_webhook = settings.stripe_webhook_secret
    settings.billing_rollout_stage = "ga"
    settings.checkout_api_key = "ops-key"
    settings.stripe_secret_key = "sk_test"
    settings.stripe_webhook_secret = "whsec_test"

    try:
        async with session_factory() as session:
            invoice = Invoice(
                workspace_id=workspace_id,
                invoice_number="INV-9004",
                status=InvoiceStatusEnum.ISSUED,
                currency=CurrencyEnum.EUR,
                subtotal=150,
                tax=0,
                total=150,
                balance_due=150,
                due_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
            session.add(invoice)
            await session.flush()

            hosted = HostedCheckoutSession(
                session_id="cs_initial",
                workspace_id=workspace_id,
                invoice_id=invoice.id,
                status=HostedCheckoutSessionStatusEnum.INITIATED,
                metadata_json={
                    "success_url": "https://success",
                    "cancel_url": "https://cancel",
                    "hosted_session_id": None,
                },
            )
            session.add(hosted)
            await session.flush()
            invoice.hosted_session_id = hosted.id
            hosted.metadata_json["hosted_session_id"] = str(hosted.id)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            list_response = await client.get(
                "/api/v1/billing/sessions",
                params={"workspaceId": str(workspace_id)},
                headers={"X-API-Key": "ops-key"},
            )
            assert list_response.status_code == 200
            sessions = list_response.json()["sessions"]
            assert len(sessions) == 1
            session_payload = sessions[0]

            regenerate_response = await client.post(
                f"/api/v1/billing/sessions/{session_payload['id']}/regenerate",
                params={"workspaceId": str(workspace_id)},
                headers={"X-API-Key": "ops-key"},
                json={
                    "expectedUpdatedAt": session_payload["updatedAt"],
                    "notes": "operator retry",
                },
            )
            assert regenerate_response.status_code == 200
            regenerated = regenerate_response.json()
            assert regenerated["sessionId"] == "cs_regenerated"
            assert regenerated["retryCount"] == 1
            assert regenerated["recoveryNotes"].startswith("operator retry")

        async with session_factory() as session:
            invoice_stmt = select(Invoice).where(Invoice.workspace_id == workspace_id)
            invoice_result = await session.execute(invoice_stmt)
            stored_invoice = invoice_result.scalar_one()
            hosted_stmt = select(HostedCheckoutSession).where(
                HostedCheckoutSession.invoice_id == stored_invoice.id
            )
            hosted_result = await session.execute(hosted_stmt)
            all_sessions = hosted_result.scalars().all()
            assert len(all_sessions) == 2
            active = next(s for s in all_sessions if s.session_id == "cs_regenerated")
            previous = next(s for s in all_sessions if s.session_id == "cs_initial")
            assert stored_invoice.hosted_session_id == active.id
            assert active.retry_count == 1
            assert previous.status == HostedCheckoutSessionStatusEnum.ABANDONED
            assert stub_provider.created
    finally:
        settings.billing_rollout_stage = previous_stage
        settings.checkout_api_key = previous_key
        settings.stripe_secret_key = previous_secret
        settings.stripe_webhook_secret = previous_webhook

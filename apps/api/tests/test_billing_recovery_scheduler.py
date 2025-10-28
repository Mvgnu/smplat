import pytest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.recovery import HostedSessionRecoveryCommunicator
from smplat_api.services.billing.sessions import schedule_hosted_session_recovery


class StubCommunicator(HostedSessionRecoveryCommunicator):
    def __init__(self) -> None:
        super().__init__()
        self.notifications = 0

    async def dispatch_notification(self, session, attempt):  # type: ignore[override]
        self.notifications += 1
        return await super().dispatch_notification(session, attempt)


@pytest.mark.asyncio
async def test_schedule_hosted_session_recovery_updates_state(session_factory):
    workspace_id = uuid4()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-1000",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=200,
            tax=0,
            total=200,
            balance_due=200,
            due_at=datetime.now(timezone.utc) + timedelta(days=2),
        )
        session.add(invoice)
        await session.flush()

        hosted = HostedCheckoutSession(
            session_id="cs_sched",
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.FAILED,
            retry_count=1,
            next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=10),
            metadata_json={
                "recovery_attempts": [
                    {
                        "attempt": 1,
                        "status": HostedCheckoutSessionStatusEnum.FAILED.value,
                        "scheduled_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
                        "next_retry_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
                    }
                ]
            },
        )
        session.add(hosted)

        skipped = HostedCheckoutSession(
            session_id="cs_skip",
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.FAILED,
            retry_count=5,
            next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        session.add(skipped)
        await session.commit()

        communicator = StubCommunicator()
        summary = await schedule_hosted_session_recovery(
            session,
            communicator,
            now=datetime.now(timezone.utc),
            max_attempts=4,
        )
        await session.commit()
        await session.refresh(hosted)

        assert summary == {"scheduled": 1, "notified": 1}
        assert communicator.notifications == 1
        assert hosted.retry_count == 2
        assert hosted.last_retry_at is not None
        assert hosted.next_retry_at is not None
        upcoming_retry = hosted.next_retry_at
        assert upcoming_retry is not None
        comparable_retry = upcoming_retry if upcoming_retry.tzinfo else upcoming_retry.replace(tzinfo=timezone.utc)
        assert comparable_retry > datetime.now(timezone.utc)
        assert hosted.metadata_json is not None
        attempts = hosted.metadata_json.get("recovery_attempts", [])
        assert len(attempts) == 2
        latest_attempt = attempts[-1]
        assert latest_attempt["attempt"] == 2
        assert "scheduled_at" in latest_attempt
        assert hosted.metadata_json.get("last_notified_at") is not None
        automation_meta = hosted.metadata_json.get("automation", {})
        assert automation_meta.get("last_attempt", {}).get("attempt") == 2

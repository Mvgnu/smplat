import pytest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
    HostedSessionRecoveryRun,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.recovery import HostedSessionRecoveryCommunicator
from smplat_api.workers.hosted_session_recovery import HostedSessionRecoveryWorker


@pytest.mark.asyncio
async def test_recovery_worker_records_run_metadata(session_factory):
    workspace_id = uuid4()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-2000",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=500,
            tax=0,
            total=500,
            balance_due=500,
            due_at=datetime.now(timezone.utc) + timedelta(days=3),
        )
        session.add(invoice)
        await session.flush()

        hosted = HostedCheckoutSession(
            session_id="cs_worker",
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.FAILED,
            retry_count=1,
            next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=15),
        )
        session.add(hosted)
        await session.commit()

    worker = HostedSessionRecoveryWorker(
        session_factory,
        communicator_factory=lambda: HostedSessionRecoveryCommunicator(),
        interval_seconds=1,
        limit=5,
        max_attempts=3,
        trigger_label="unit-default",
    )

    summary = await worker.run_once(triggered_by="unit-test")
    assert summary["scheduled"] == 1
    assert summary["notified"] == 1

    async with session_factory() as session:
        runs = (await session.execute(
            HostedSessionRecoveryRun.__table__.select()
        )).fetchall()
        assert len(runs) == 1
        row = runs[0]
        assert row.status == "completed"
        assert row.triggered_by == "unit-test"
        assert row.scheduled_count == 1
        assert row.notified_count == 1
        metadata = row.metadata
        assert metadata["triggered_by"] == "unit-test"
        assert metadata["email_provider"] == "stub-email"
        assert metadata["chat_provider"] == "stub-sms"

        hosted_row = (await session.execute(
            HostedCheckoutSession.__table__.select().where(
                HostedCheckoutSession.session_id == "cs_worker"
            )
        )).fetchone()
        assert hosted_row.retry_count == 2


@pytest.mark.asyncio
async def test_recovery_worker_records_failure(session_factory):
    workspace_id = uuid4()
    async with session_factory() as session:
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-4000",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=200,
            tax=0,
            total=200,
            balance_due=200,
            due_at=datetime.now(timezone.utc) + timedelta(days=2),
        )
        session.add(invoice)
        await session.flush()

        hosted = HostedCheckoutSession(
            session_id="cs_fail",
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.FAILED,
            retry_count=0,
            next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        session.add(hosted)
        await session.commit()

    class ExplodingCommunicator(HostedSessionRecoveryCommunicator):
        async def dispatch_notification(self, session, attempt):  # type: ignore[override]
            raise RuntimeError("dispatch boom")

    worker = HostedSessionRecoveryWorker(
        session_factory,
        communicator_factory=lambda: ExplodingCommunicator(),
        interval_seconds=1,
        limit=5,
        max_attempts=2,
        trigger_label="unit-default",
    )

    with pytest.raises(RuntimeError):
        await worker.run_once(triggered_by="error-test")

    async with session_factory() as session:
        runs = (await session.execute(
            HostedSessionRecoveryRun.__table__.select()
        )).fetchall()
        assert len(runs) == 1
        row = runs[0]
        assert row.status == "failed"
        assert row.triggered_by == "error-test"
        assert row.error_message == "dispatch boom"
        metadata = row.metadata
        assert metadata["triggered_by"] == "error-test"
        assert metadata["error"] == "dispatch boom"

"""Tests for Stripe statement ingestion and reconciliation logic."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.core.settings import settings
from smplat_api.models.billing_reconciliation import (
    BillingDiscrepancy,
    BillingDiscrepancyStatus,
    BillingDiscrepancyType,
    BillingReconciliationRun,
    BillingSyncCursor,
    ProcessorStatement,
    ProcessorStatementStaging,
    ProcessorStatementStagingStatus,
    ProcessorStatementTransactionType,
)
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.models.user import User, UserRoleEnum
from smplat_api.services.billing.providers import (
    StripeBalanceTransaction,
    StripeDisputeRecord,
    StripeListPage,
)
from smplat_api.services.billing.statements import (
    StripeStatementIngestionService,
    StatementSyncResult,
    reconcile_statements,
)
from smplat_api.workers.billing_reconciliation import BillingLedgerReconciliationWorker


class StubStatementProvider:
    """Stubbed Stripe provider returning pre-configured data."""

    def __init__(self, transactions: list[StripeBalanceTransaction], disputes: list[StripeDisputeRecord], charge_metadata: dict[str, dict[str, str]]):
        self._transactions = transactions
        self._disputes = disputes
        self._charge_metadata = charge_metadata

    async def list_balance_transactions(  # type: ignore[override]
        self,
        *,
        limit: int = 100,
        starting_after: str | None = None,
        **_: object,
    ) -> StripeListPage[StripeBalanceTransaction]:
        start_index = 0
        if starting_after:
            for idx, tx in enumerate(self._transactions):
                if tx.transaction_id == starting_after:
                    start_index = idx + 1
                    break
        selected = self._transactions[start_index : start_index + limit]
        has_more = start_index + limit < len(self._transactions)
        next_cursor = selected[-1].transaction_id if has_more and selected else None
        return StripeListPage(items=list(selected), has_more=has_more, next_cursor=next_cursor)

    async def list_disputes(self, **_: object) -> list[StripeDisputeRecord]:  # type: ignore[override]
        return list(self._disputes)

    async def retrieve_charge(self, charge_id: str) -> dict[str, dict[str, str]]:  # type: ignore[override]
        return {"metadata": self._charge_metadata.get(charge_id, {})}


@pytest.mark.asyncio
async def test_sync_balance_transactions_links_invoice(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="finance@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-9001",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("100.00"),
            tax=Decimal("0"),
            total=Decimal("100.00"),
            balance_due=Decimal("100.00"),
            processor_charge_id="ch_txn_1",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.flush()

        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_1",
                type="charge",
                amount=Decimal("100.00"),
                currency="EUR",
                fee=Decimal("3.20"),
                net=Decimal("96.80"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id="ch_txn_1",
                raw={"id": "txn_1"},
            )
        ]
        disputes: list[StripeDisputeRecord] = []
        provider = StubStatementProvider(
            transactions,
            disputes,
            {"ch_txn_1": {"invoice_id": str(invoice.id), "workspace_id": str(workspace_id)}},
        )

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=workspace_id)
        assert isinstance(result, StatementSyncResult)
        assert len(result.persisted) == 1
        statement = result.persisted[0]
        assert statement.invoice_id == invoice.id
        assert statement.workspace_id == workspace_id
        assert statement.transaction_id == "txn_1"

        run = await service.ensure_run()
        await reconcile_statements(session, statements=result.statements_for_reconciliation, run=run)
        assert run.total_transactions == len(result.statements_for_reconciliation)
        assert run.matched_transactions == len(result.statements_for_reconciliation)
        assert run.discrepancy_count == 0


@pytest.mark.asyncio
async def test_sync_balance_transactions_stages_orphans(session_factory):
    async with session_factory() as session:
        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_orphan",
                type="payout",
                amount=Decimal("25.00"),
                currency="USD",
                fee=Decimal("0"),
                net=Decimal("25.00"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id=None,
                raw={"id": "txn_orphan"},
            )
        ]
        provider = StubStatementProvider(transactions, [], {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=uuid4())
        assert isinstance(result, StatementSyncResult)
        assert not result.persisted
        assert not result.updated
        assert len(result.staged) == 1
        staging = result.staged[0]
        assert staging.reason.startswith("unresolved_workspace")
        assert staging.status == ProcessorStatementStagingStatus.PENDING

        staged_rows = await session.execute(select(ProcessorStatementStaging))
        staged_row = staged_rows.scalar_one()
        assert staged_row.transaction_id == "txn_orphan"
        assert staged_row.status == ProcessorStatementStagingStatus.PENDING


@pytest.mark.asyncio
async def test_sync_balance_transactions_marks_removed_transactions(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="ops+removed@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-REMOVED",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("10.00"),
            tax=Decimal("0"),
            total=Decimal("10.00"),
            balance_due=Decimal("10.00"),
            processor_charge_id="ch_removed",
            due_at=datetime.now(timezone.utc),
        )
        statement = ProcessorStatement(
            workspace_id=workspace_id,
            invoice_id=invoice.id,
            processor="stripe",
            transaction_id="txn_removed",
            charge_id="ch_removed",
            transaction_type=ProcessorStatementTransactionType.CHARGE,
            currency="USD",
            gross_amount=Decimal("10.00"),
            fee_amount=Decimal("0.30"),
            net_amount=Decimal("9.70"),
            occurred_at=datetime.now(timezone.utc),
            data={"id": "txn_removed"},
        )
        session.add_all([user, invoice, statement])
        await session.commit()

        provider = StubStatementProvider([], [], {})
        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=workspace_id)

        assert statement in result.removed
        assert any(staging.reason == "processor_missing" for staging in result.staged)

        staged_lookup = await session.execute(select(ProcessorStatementStaging))
        staged_row = staged_lookup.scalar_one()
        assert staged_row.reason == "processor_missing"
        assert staged_row.transaction_id == "txn_removed"
        assert staged_row.status == ProcessorStatementStagingStatus.PENDING


@pytest.mark.asyncio
async def test_reconcile_payout_delay_creates_discrepancy(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="payouts@example.com", role=UserRoleEnum.FINANCE)
        session.add(user)
        await session.flush()

        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_payout_delay",
                type="payout",
                amount=Decimal("125.00"),
                currency="USD",
                fee=Decimal("0"),
                net=Decimal("125.00"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id=None,
                raw={
                    "id": "txn_payout_delay",
                    "status": "pending",
                    "metadata": {"workspace_id": str(workspace_id)},
                },
            )
        ]
        provider = StubStatementProvider(transactions, [], {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=workspace_id)

        assert result.persisted
        statement = result.persisted[0]
        assert statement.transaction_type == ProcessorStatementTransactionType.PAYOUT_DELAY
        assert statement.workspace_id == workspace_id

        run = await service.ensure_run()
        await reconcile_statements(session, statements=result.statements_for_reconciliation, run=run)

        discrepancies = await session.execute(select(BillingDiscrepancy))
        discrepancy = discrepancies.scalars().one()
        assert discrepancy.discrepancy_type == BillingDiscrepancyType.PAYOUT_DELAY
        assert "Payout" in (discrepancy.summary or "")


@pytest.mark.asyncio
async def test_reconcile_fee_adjustment_flags_discrepancy(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="fees@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-FEE-1",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("200.00"),
            tax=Decimal("0"),
            total=Decimal("200.00"),
            balance_due=Decimal("200.00"),
            processor_charge_id="ch_fee_1",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.flush()

        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_fee_adjustment",
                type="application_fee",
                amount=Decimal("-10.00"),
                currency="USD",
                fee=Decimal("0"),
                net=Decimal("-10.00"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id="ch_fee_1",
                raw={
                    "id": "txn_fee_adjustment",
                    "type": "fee_adjustment",
                    "metadata": {
                        "workspace_id": str(workspace_id),
                        "invoice_id": str(invoice.id),
                    },
                },
            )
        ]
        provider = StubStatementProvider(transactions, [], {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=workspace_id)

        assert result.persisted
        statement = result.persisted[0]
        assert statement.transaction_type == ProcessorStatementTransactionType.FEE_ADJUSTMENT
        assert statement.invoice_id == invoice.id

        run = await service.ensure_run()
        await reconcile_statements(session, statements=result.statements_for_reconciliation, run=run)

        discrepancies = await session.execute(select(BillingDiscrepancy))
        discrepancy = discrepancies.scalars().one()
        assert discrepancy.discrepancy_type == BillingDiscrepancyType.FEE_ADJUSTMENT
        assert discrepancy.invoice_id == invoice.id


@pytest.mark.asyncio
async def test_reconcile_refund_reversal_tracks_discrepancy(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="refunds@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-REF-1",
            status=InvoiceStatusEnum.PAID,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("300.00"),
            tax=Decimal("0"),
            total=Decimal("300.00"),
            balance_due=Decimal("0"),
            processor_charge_id="ch_ref_1",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.flush()

        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_refund_reversal",
                type="refund",
                amount=Decimal("-300.00"),
                currency="USD",
                fee=Decimal("0"),
                net=Decimal("-300.00"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id="ch_ref_1",
                raw={
                    "id": "txn_refund_reversal",
                    "type": "refund_reversal",
                    "metadata": {
                        "workspace_id": str(workspace_id),
                        "invoice_id": str(invoice.id),
                    },
                },
            )
        ]
        provider = StubStatementProvider(transactions, [], {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions(workspace_id=workspace_id)

        assert result.persisted
        statement = result.persisted[0]
        assert statement.transaction_type == ProcessorStatementTransactionType.REFUND_REVERSAL

        run = await service.ensure_run()
        await reconcile_statements(session, statements=result.statements_for_reconciliation, run=run)

        discrepancies = await session.execute(select(BillingDiscrepancy))
        discrepancy = discrepancies.scalars().one()
        assert discrepancy.discrepancy_type == BillingDiscrepancyType.REFUND_REVERSAL
        assert discrepancy.invoice_id == invoice.id

@pytest.mark.asyncio
async def test_sync_disputes_creates_discrepancy(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="ops@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-9002",
            status=InvoiceStatusEnum.PAID,
            currency=CurrencyEnum.EUR,
            subtotal=Decimal("50.00"),
            tax=Decimal("0"),
            total=Decimal("50.00"),
            balance_due=Decimal("0"),
            processor_charge_id="ch_txn_2",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.flush()

        transactions: list[StripeBalanceTransaction] = []
        disputes = [
            StripeDisputeRecord(
                dispute_id="dp_1",
                charge_id="ch_txn_2",
                status="needs_response",
                amount=Decimal("50.00"),
                currency="EUR",
                reason="fraudulent",
                created_at=datetime.now(timezone.utc),
                raw={"id": "dp_1"},
            )
        ]
        provider = StubStatementProvider(transactions, disputes, {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        created = await service.sync_disputes()
        assert len(created) == 1
        discrepancy = created[0]
        assert discrepancy.discrepancy_type == BillingDiscrepancyType.UNAPPLIED_REFUND
        assert discrepancy.status == BillingDiscrepancyStatus.OPEN
        assert discrepancy.invoice_id == invoice.id

        run_result = await session.execute(select(BillingReconciliationRun))
        run = run_result.scalar_one()
        assert run.discrepancy_count == 1

        discrepancy_result = await session.execute(select(ProcessorStatement))
        assert discrepancy_result.scalars().first() is None


@pytest.mark.asyncio
async def test_worker_run_once_marks_run_completed(session_factory, monkeypatch: pytest.MonkeyPatch):
    workspace_id = uuid4()
    async with session_factory() as session:
        user = User(id=workspace_id, email="worker@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-WORKER",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("40.00"),
            tax=Decimal("0"),
            total=Decimal("40.00"),
            balance_due=Decimal("40.00"),
            processor_charge_id="ch_worker",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.commit()

        observed_at = datetime.now(timezone.utc)
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_worker",
                type="charge",
                amount=Decimal("40.00"),
                currency="USD",
                fee=Decimal("1.20"),
                net=Decimal("38.80"),
                created_at=observed_at,
                updated_at=observed_at,
                source_id="ch_worker",
                raw={"id": "txn_worker"},
            )
        ]
    stub_provider = StubStatementProvider(
        transactions,
        [],
        {"ch_worker": {"invoice_id": str(invoice.id), "workspace_id": str(workspace_id)}},
    )

    original_init = StripeStatementIngestionService.__init__

    def patched_init(self, session, provider=None):
        original_init(self, session, provider=provider or stub_provider)

    monkeypatch.setattr(StripeStatementIngestionService, "__init__", patched_init)

    worker = BillingLedgerReconciliationWorker(session_factory)
    stats = await worker.run_once()

    async with session_factory() as session:
        run_result = await session.execute(
            select(BillingReconciliationRun).order_by(BillingReconciliationRun.started_at.desc())
        )
        run = run_result.scalar_one()
        assert run.status == "completed"
        assert run.completed_at is not None
        notes = json.loads(run.notes or "{}")
        assert notes.get("status") == "completed"
        assert notes.get("persisted") == 1
        assert stats["statements_ingested"] == 1
        assert "statements_updated" in stats


@pytest.mark.asyncio
async def test_worker_run_once_marks_failure(session_factory, monkeypatch: pytest.MonkeyPatch):
    class FailingProvider(StubStatementProvider):
        async def list_balance_transactions(  # type: ignore[override]
            self,
            *,
            limit: int = 100,
            starting_after: str | None = None,
            **_: object,
        ) -> StripeListPage[StripeBalanceTransaction]:
            raise RuntimeError("stripe unavailable")

    failing_provider = FailingProvider([], [], {})
    original_init = StripeStatementIngestionService.__init__

    def patched_init(self, session, provider=None):
        original_init(self, session, provider=provider or failing_provider)

    monkeypatch.setattr(StripeStatementIngestionService, "__init__", patched_init)

    workspace_id = uuid4()
    async with session_factory() as session:
        user = User(id=workspace_id, email="worker-failure@example.com", role=UserRoleEnum.FINANCE)
        invoice = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-WORKER-FAIL",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("10.00"),
            tax=Decimal("0"),
            total=Decimal("10.00"),
            balance_due=Decimal("10.00"),
            processor_charge_id="ch_worker_fail",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice])
        await session.commit()

    worker = BillingLedgerReconciliationWorker(session_factory)

    with pytest.raises(RuntimeError):
        await worker.run_once()

    async with session_factory() as session:
        run_result = await session.execute(
            select(BillingReconciliationRun).order_by(BillingReconciliationRun.started_at.desc())
        )
        run = run_result.scalar_one()
        assert run.status == "failed"
        assert run.completed_at is not None
        notes = json.loads(run.notes or "{}")
        assert notes.get("status") == "failed"
        assert "error" in notes
        assert "staged" in notes


@pytest.mark.asyncio
async def test_list_runs_includes_metrics_and_staging_backlog(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "ops-key"

    try:
        async with session_factory() as session:
            run = BillingReconciliationRun(
                status="completed",
                total_transactions=5,
                matched_transactions=4,
                discrepancy_count=1,
                notes=json.dumps(
                    {
                        "status": "completed",
                        "persisted": 3,
                        "updated": 1,
                        "staged": 1,
                        "removed": 0,
                        "disputes": 0,
                        "cursor": "txn_cursor",
                    }
                ),
            )
            staging = ProcessorStatementStaging(
                transaction_id="txn_api",
                processor="stripe",
                reason="unresolved_workspace:charge",
                payload={"id": "txn_api"},
                status=ProcessorStatementStagingStatus.PENDING,
                requeue_count=0,
            )
            session.add_all([run, staging])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/billing/reconciliation/runs",
                headers={"X-API-Key": "ops-key"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["stagingBacklog"] == 1
        assert body["runs"][0]["metrics"]["staged"] == 1
        assert body["runs"][0]["metrics"]["status"] == "completed"
        assert body["runs"][0]["metrics"]["cursor"] == "txn_cursor"
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_list_discrepancies_supports_type_filter(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "ops-key"

    try:
        async with session_factory() as session:
            run = BillingReconciliationRun(status="completed")
            session.add(run)
            await session.flush()

            base_discrepancy = BillingDiscrepancy(
                run_id=run.id,
                discrepancy_type=BillingDiscrepancyType.MISSING_INVOICE,
                status=BillingDiscrepancyStatus.OPEN,
            )
            fee_discrepancy = BillingDiscrepancy(
                run_id=run.id,
                discrepancy_type=BillingDiscrepancyType.FEE_ADJUSTMENT,
                status=BillingDiscrepancyStatus.OPEN,
            )
            session.add_all([base_discrepancy, fee_discrepancy])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/billing/reconciliation/discrepancies",
                params={"type": BillingDiscrepancyType.FEE_ADJUSTMENT.value},
                headers={"X-API-Key": "ops-key"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert len(payload) == 1
        assert payload[0]["discrepancyType"] == BillingDiscrepancyType.FEE_ADJUSTMENT.value
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_list_runs_surfaces_failure_metadata(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "ops-key"

    try:
        async with session_factory() as session:
            run = BillingReconciliationRun(
                status="failed",
                total_transactions=3,
                matched_transactions=1,
                discrepancy_count=2,
                notes=json.dumps(
                    {
                        "status": "failed",
                        "persisted": 1,
                        "updated": 0,
                        "staged": 2,
                        "removed": 0,
                        "disputes": 1,
                        "cursor": None,
                        "error": "stripe timeout",
                    }
                ),
            )
            session.add(run)
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/billing/reconciliation/runs",
                headers={"X-API-Key": "ops-key"},
            )

        assert response.status_code == 200
        payload = response.json()
        run_payload = payload["runs"][0]
        assert run_payload["metrics"]["status"] == "failed"
        assert run_payload["metrics"]["error"] == "stripe timeout"
        failure = run_payload.get("failure")
        assert failure is not None
        assert failure["status"] == "failed"
        assert failure["error"] == "stripe timeout"
        assert failure["staged"] == 2
        assert failure["persisted"] == 1
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_staging_triage_and_requeue_flow(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "triage-key"

    try:
        async with session_factory() as session:
            staging = ProcessorStatementStaging(
                transaction_id="txn_triage",
                processor="stripe",
                reason="unresolved_workspace:payout",
                payload={"id": "txn_triage"},
                status=ProcessorStatementStagingStatus.PENDING,
                requeue_count=0,
            )
            session.add(staging)
            await session.commit()
            staging_id = staging.id

        async with AsyncClient(app=app, base_url="http://test") as client:
            triage_response = await client.post(
                f"/api/v1/billing/reconciliation/staging/{staging_id}/triage",
                headers={"X-API-Key": "triage-key"},
                json={"status": "triaged", "triageNote": "Investigating workspace metadata"},
            )
            assert triage_response.status_code == 200
            triage_body = triage_response.json()
            assert triage_body["status"] == "triaged"
            assert triage_body["triageNote"] == "Investigating workspace metadata"
            assert triage_body["resolvedAt"] is None

            requeue_response = await client.post(
                f"/api/v1/billing/reconciliation/staging/{staging_id}/requeue",
                headers={"X-API-Key": "triage-key"},
                json={"triageNote": "Retry sync"},
            )
            assert requeue_response.status_code == 200
            requeue_body = requeue_response.json()
            assert requeue_body["status"] == "requeued"
            assert requeue_body["triageNote"] == "Retry sync"
            assert requeue_body["requeueCount"] == 1

        async with session_factory() as session:
            refreshed_result = await session.execute(select(ProcessorStatementStaging))
            refreshed = refreshed_result.scalar_one()
            assert refreshed.status == ProcessorStatementStagingStatus.REQUEUED
            assert refreshed.requeue_count == 1
            assert refreshed.triage_note == "Retry sync"
            assert refreshed.last_triaged_at is not None
            assert refreshed.resolved_at is None
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_sync_balance_transactions_persists_cursors(session_factory):
    async with session_factory() as session:
        workspace_id = uuid4()
        user = User(id=workspace_id, email="finance+cursor@example.com", role=UserRoleEnum.FINANCE)
        invoice_one = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-CURSOR-1",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("50.00"),
            tax=Decimal("0"),
            total=Decimal("50.00"),
            balance_due=Decimal("0"),
            processor_charge_id="ch_cursor_1",
            due_at=datetime.now(timezone.utc),
        )
        invoice_two = Invoice(
            workspace_id=workspace_id,
            invoice_number="INV-CURSOR-2",
            status=InvoiceStatusEnum.ISSUED,
            currency=CurrencyEnum.USD,
            subtotal=Decimal("75.00"),
            tax=Decimal("0"),
            total=Decimal("75.00"),
            balance_due=Decimal("0"),
            processor_charge_id="ch_cursor_2",
            due_at=datetime.now(timezone.utc),
        )
        session.add_all([user, invoice_one, invoice_two])
        await session.flush()

        base_time = datetime.now(timezone.utc)
        tx_one = StripeBalanceTransaction(
            transaction_id="txn_cursor_1",
            type="charge",
            amount=Decimal("50.00"),
            currency="USD",
            fee=Decimal("1.50"),
            net=Decimal("48.50"),
            created_at=base_time,
            updated_at=base_time,
            source_id="ch_cursor_1",
            raw={"id": "txn_cursor_1"},
        )
        tx_two_time = base_time + timedelta(minutes=5)
        tx_two = StripeBalanceTransaction(
            transaction_id="txn_cursor_2",
            type="charge",
            amount=Decimal("75.00"),
            currency="USD",
            fee=Decimal("2.25"),
            net=Decimal("72.75"),
            created_at=tx_two_time,
            updated_at=tx_two_time,
            source_id="ch_cursor_2",
            raw={"id": "txn_cursor_2"},
        )

        provider = StubStatementProvider(
            [tx_one, tx_two],
            [],
            {
                "ch_cursor_1": {"invoice_id": str(invoice_one.id), "workspace_id": str(workspace_id)},
                "ch_cursor_2": {"invoice_id": str(invoice_two.id), "workspace_id": str(workspace_id)},
            },
        )
        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        first_result = await service.sync_balance_transactions(workspace_id=workspace_id)
        assert len(first_result.persisted) == 2

        cursor_result = await session.execute(
            select(BillingSyncCursor).where(
                BillingSyncCursor.workspace_id == workspace_id,
                BillingSyncCursor.processor == "stripe",
                BillingSyncCursor.object_type == "balance_transaction",
            )
        )
        cursor_row = cursor_result.scalar_one()
        assert cursor_row.last_transaction_id == "txn_cursor_2"
        assert cursor_row.cursor_token == "txn_cursor_2"

        provider_second = StubStatementProvider(
            [tx_one, tx_two],
            [],
            {
                "ch_cursor_1": {"invoice_id": str(invoice_one.id), "workspace_id": str(workspace_id)},
                "ch_cursor_2": {"invoice_id": str(invoice_two.id), "workspace_id": str(workspace_id)},
            },
        )
        service_second = StripeStatementIngestionService(session, provider=provider_second)  # type: ignore[arg-type]
        second_result = await service_second.sync_balance_transactions(workspace_id=workspace_id)
        assert not second_result.persisted
        assert not second_result.updated

        updated_time = tx_two_time + timedelta(minutes=10)
        tx_two_updated = StripeBalanceTransaction(
            transaction_id="txn_cursor_2",
            type="charge",
            amount=Decimal("80.00"),
            currency="USD",
            fee=Decimal("2.40"),
            net=Decimal("77.60"),
            created_at=tx_two_time,
            updated_at=updated_time,
            source_id="ch_cursor_2",
            raw={"id": "txn_cursor_2"},
        )
        provider_third = StubStatementProvider(
            [tx_one, tx_two_updated],
            [],
            {
                "ch_cursor_1": {"invoice_id": str(invoice_one.id), "workspace_id": str(workspace_id)},
                "ch_cursor_2": {"invoice_id": str(invoice_two.id), "workspace_id": str(workspace_id)},
            },
        )
        service_third = StripeStatementIngestionService(session, provider=provider_third)  # type: ignore[arg-type]
        third_result = await service_third.sync_balance_transactions(
            workspace_id=workspace_id,
            starting_after="txn_cursor_1",
        )
        assert not third_result.persisted
        assert len(third_result.updated) == 1

        cursor_result = await session.execute(
            select(BillingSyncCursor).where(
                BillingSyncCursor.workspace_id == workspace_id,
                BillingSyncCursor.processor == "stripe",
                BillingSyncCursor.object_type == "balance_transaction",
            )
        )
        refreshed_cursor = cursor_result.scalar_one()
        assert refreshed_cursor.last_transaction_updated_at == updated_time
        assert refreshed_cursor.cursor_token == "txn_cursor_2"

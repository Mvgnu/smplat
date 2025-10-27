"""Tests for Stripe statement ingestion and reconciliation logic."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from smplat_api.models.billing_reconciliation import (
    BillingDiscrepancyStatus,
    BillingDiscrepancyType,
    BillingReconciliationRun,
    ProcessorStatement,
    ProcessorStatementStaging,
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

        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_1",
                type="charge",
                amount=Decimal("100.00"),
                currency="EUR",
                fee=Decimal("3.20"),
                net=Decimal("96.80"),
                created_at=datetime.now(timezone.utc),
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
        result = await service.sync_balance_transactions()
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
        transactions = [
            StripeBalanceTransaction(
                transaction_id="txn_orphan",
                type="payout",
                amount=Decimal("25.00"),
                currency="USD",
                fee=Decimal("0"),
                net=Decimal("25.00"),
                created_at=datetime.now(timezone.utc),
                source_id=None,
                raw={"id": "txn_orphan"},
            )
        ]
        provider = StubStatementProvider(transactions, [], {})

        service = StripeStatementIngestionService(session, provider=provider)  # type: ignore[arg-type]
        result = await service.sync_balance_transactions()
        assert isinstance(result, StatementSyncResult)
        assert not result.persisted
        assert not result.updated
        assert len(result.staged) == 1
        staging = result.staged[0]
        assert staging.reason.startswith("unresolved_workspace")

        staged_rows = await session.execute(select(ProcessorStatementStaging))
        assert staged_rows.scalar_one().transaction_id == "txn_orphan"


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
        result = await service.sync_balance_transactions()

        assert statement in result.removed
        assert any(staging.reason == "processor_missing" for staging in result.staged)

        staged_lookup = await session.execute(select(ProcessorStatementStaging))
        staged_row = staged_lookup.scalar_one()
        assert staged_row.reason == "processor_missing"
        assert staged_row.transaction_id == "txn_removed"


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

    transactions = [
        StripeBalanceTransaction(
            transaction_id="txn_worker",
            type="charge",
            amount=Decimal("40.00"),
            currency="USD",
            fee=Decimal("1.20"),
            net=Decimal("38.80"),
            created_at=datetime.now(timezone.utc),
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

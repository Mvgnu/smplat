"""Tests for Stripe statement ingestion and reconciliation logic."""

from __future__ import annotations

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
)
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.models.user import User, UserRoleEnum
from smplat_api.services.billing.providers import (
    StripeBalanceTransaction,
    StripeDisputeRecord,
)
from smplat_api.services.billing.statements import (
    StripeStatementIngestionService,
    reconcile_statements,
)


class StubStatementProvider:
    """Stubbed Stripe provider returning pre-configured data."""

    def __init__(self, transactions: list[StripeBalanceTransaction], disputes: list[StripeDisputeRecord], charge_metadata: dict[str, dict[str, str]]):
        self._transactions = transactions
        self._disputes = disputes
        self._charge_metadata = charge_metadata

    async def list_balance_transactions(self, **_: object) -> list[StripeBalanceTransaction]:  # type: ignore[override]
        return list(self._transactions)

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
        statements = await service.sync_balance_transactions()
        assert len(statements) == 1
        statement = statements[0]
        assert statement.invoice_id == invoice.id
        assert statement.workspace_id == workspace_id
        assert statement.transaction_id == "txn_1"

        run = await service.ensure_run()
        await reconcile_statements(session, statements=statements, run=run)
        assert run.total_transactions == 1
        assert run.matched_transactions == 1
        assert run.discrepancy_count == 0


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

"""Processor statement ingestion and reconciliation helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.billing_reconciliation import (
    BillingDiscrepancy,
    BillingDiscrepancyStatus,
    BillingDiscrepancyType,
    BillingReconciliationRun,
    ProcessorStatement,
    ProcessorStatementTransactionType,
)
from smplat_api.models.invoice import Invoice
from smplat_api.services.billing.providers import (
    StripeBalanceTransaction,
    StripeBillingProvider,
    StripeDisputeRecord,
)


class StripeStatementIngestionService:
    """Synchronize Stripe balance transactions and disputes."""

    def __init__(self, session: AsyncSession, provider: StripeBillingProvider | None = None) -> None:
        self._session = session
        self._provider = provider or StripeBillingProvider.from_settings()

    async def sync_balance_transactions(
        self,
        *,
        created_gte: datetime | None = None,
        created_lte: datetime | None = None,
        limit: int = 100,
    ) -> list[ProcessorStatement]:
        """Fetch balance transactions and persist normalized statements."""

        transactions: list[StripeBalanceTransaction] = await self._provider.list_balance_transactions(
            created_gte=created_gte,
            created_lte=created_lte,
            limit=limit,
        )
        persisted: list[ProcessorStatement] = []
        for tx in transactions:
            existing = await self._session.execute(
                select(ProcessorStatement).where(ProcessorStatement.transaction_id == tx.transaction_id)
            )
            if existing.scalar_one_or_none():
                continue

            invoice, workspace_id = await self._resolve_invoice_and_workspace(tx)
            if workspace_id is None:
                # Unable to determine workspace; skip ingestion to avoid orphan rows.
                continue

            statement = ProcessorStatement(
                workspace_id=workspace_id,
                invoice_id=invoice.id if invoice else None,
                processor="stripe",
                transaction_id=tx.transaction_id,
                charge_id=tx.source_id,
                transaction_type=self._map_transaction_type(tx.type),
                currency=tx.currency,
                gross_amount=tx.amount,
                fee_amount=tx.fee,
                net_amount=tx.net,
                occurred_at=tx.created_at,
                data=dict(tx.raw),
            )
            self._session.add(statement)
            persisted.append(statement)

        if persisted:
            await self._session.flush()
        return persisted

    async def sync_disputes(
        self,
        *,
        created_gte: datetime | None = None,
        created_lte: datetime | None = None,
        limit: int = 100,
    ) -> list[BillingDiscrepancy]:
        """Capture dispute information and create discrepancy placeholders."""

        disputes: list[StripeDisputeRecord] = await self._provider.list_disputes(
            created_gte=created_gte,
            created_lte=created_lte,
            limit=limit,
        )
        created: list[BillingDiscrepancy] = []
        run = await self._ensure_open_run()
        for dispute in disputes:
            existing = await self._session.execute(
                select(BillingDiscrepancy).where(
                    BillingDiscrepancy.transaction_id == dispute.dispute_id,
                    BillingDiscrepancy.discrepancy_type == BillingDiscrepancyType.UNAPPLIED_REFUND,
                )
            )
            if existing.scalar_one_or_none():
                continue

            invoice = None
            if dispute.charge_id:
                invoice = await self._session.execute(
                    select(Invoice).where(Invoice.processor_charge_id == dispute.charge_id)
                )
                invoice = invoice.scalar_one_or_none()

            discrepancy = BillingDiscrepancy(
                run_id=run.id,
                invoice_id=invoice.id if invoice else None,
                processor_statement_id=None,
                transaction_id=dispute.dispute_id,
                discrepancy_type=BillingDiscrepancyType.UNAPPLIED_REFUND,
                status=BillingDiscrepancyStatus.OPEN,
                amount_delta=dispute.amount,
                summary=f"Dispute {dispute.dispute_id} opened ({dispute.status})",
                resolution_note=None,
            )
            self._session.add(discrepancy)
            created.append(discrepancy)

        if created:
            run.discrepancy_count += len(created)
            await self._session.flush()
        return created

    async def ensure_run(self) -> BillingReconciliationRun:
        """Ensure a reconciliation run exists for statement processing."""

        return await self._ensure_open_run()

    async def _ensure_open_run(self) -> BillingReconciliationRun:
        run_result = await self._session.execute(
            select(BillingReconciliationRun).order_by(BillingReconciliationRun.started_at.desc())
        )
        run = run_result.scalars().first()
        if run and run.status == "running":
            return run

        run = BillingReconciliationRun(status="running")
        self._session.add(run)
        await self._session.flush()
        return run

    async def _resolve_invoice_and_workspace(
        self, transaction: StripeBalanceTransaction
    ) -> tuple[Invoice | None, UUID | None]:
        invoice = None
        workspace_id: UUID | None = None

        if transaction.source_id:
            invoice_result = await self._session.execute(
                select(Invoice).where(Invoice.processor_charge_id == transaction.source_id)
            )
            invoice = invoice_result.scalar_one_or_none()

            if invoice:
                workspace_id = invoice.workspace_id
            else:
                charge = await self._provider.retrieve_charge(transaction.source_id)
                metadata = charge.get("metadata") or {}
                workspace_value = metadata.get("workspace_id")
                if workspace_value:
                    try:
                        workspace_id = UUID(str(workspace_value))
                    except ValueError:
                        workspace_id = None
                invoice_id_value = metadata.get("invoice_id")
                if invoice_id_value and not invoice:
                    try:
                        invoice_uuid = UUID(str(invoice_id_value))
                    except ValueError:
                        invoice_uuid = None
                    if invoice_uuid:
                        invoice_lookup = await self._session.execute(
                            select(Invoice).where(Invoice.id == invoice_uuid)
                        )
                        invoice = invoice_lookup.scalar_one_or_none()
                        if invoice and not workspace_id:
                            workspace_id = invoice.workspace_id

        return invoice, workspace_id

    @staticmethod
    def _map_transaction_type(transaction_type: str) -> ProcessorStatementTransactionType:
        normalized = transaction_type.lower()
        mapping: dict[str, ProcessorStatementTransactionType] = {
            "charge": ProcessorStatementTransactionType.CHARGE,
            "payment": ProcessorStatementTransactionType.CHARGE,
            "payment_intent": ProcessorStatementTransactionType.CHARGE,
            "refund": ProcessorStatementTransactionType.REFUND,
            "application_fee": ProcessorStatementTransactionType.FEE,
            "fee": ProcessorStatementTransactionType.FEE,
            "payout": ProcessorStatementTransactionType.PAYOUT,
            "adjustment": ProcessorStatementTransactionType.ADJUSTMENT,
        }
        return mapping.get(normalized, ProcessorStatementTransactionType.ADJUSTMENT)


async def reconcile_statements(
    session: AsyncSession,
    *,
    statements: Iterable[ProcessorStatement],
    run: BillingReconciliationRun,
) -> BillingReconciliationRun:
    """Compute reconciliation metrics for the provided statements."""

    statement_list = list(statements)
    matched = 0
    discrepancies: list[BillingDiscrepancy] = []
    for statement in statement_list:
        if statement.invoice_id:
            matched += 1
        else:
            discrepancies.append(
                BillingDiscrepancy(
                    run_id=run.id,
                    invoice_id=None,
                    processor_statement_id=statement.id,
                    transaction_id=statement.transaction_id,
                    discrepancy_type=BillingDiscrepancyType.MISSING_INVOICE,
                    status=BillingDiscrepancyStatus.OPEN,
                    amount_delta=statement.gross_amount,
                    summary=f"Statement {statement.transaction_id} missing invoice linkage",
                    resolution_note=None,
                )
            )

    run.total_transactions += len(statement_list)
    run.matched_transactions += matched
    if discrepancies:
        run.discrepancy_count += len(discrepancies)
        for discrepancy in discrepancies:
            session.add(discrepancy)

    await session.flush()
    return run

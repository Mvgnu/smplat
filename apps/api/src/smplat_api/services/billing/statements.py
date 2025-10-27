"""Processor statement ingestion and reconciliation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
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
    ProcessorStatementStaging,
    ProcessorStatementTransactionType,
)
from smplat_api.models.invoice import Invoice
from smplat_api.services.billing.providers import (
    StripeBalanceTransaction,
    StripeBillingProvider,
    StripeDisputeRecord,
)


@dataclass(slots=True)
class StatementSyncResult:
    """Result container describing persistence outcomes for a sync window."""

    persisted: list[ProcessorStatement]
    updated: list[ProcessorStatement]
    staged: list[ProcessorStatementStaging]
    removed: list[ProcessorStatement]
    next_cursor: str | None = None

    # meta: statement-sync: result-dto

    @property
    def total(self) -> int:
        """Return the count of statements persisted or updated during the sync."""

        return len(self.persisted) + len(self.updated)

    @property
    def statements_for_reconciliation(self) -> list[ProcessorStatement]:
        """Expose statements that should be reconciled after persistence."""

        return [*self.persisted, *self.updated]


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
        starting_after: str | None = None,
    ) -> StatementSyncResult:
        """Fetch balance transactions, capturing differential changes and staging orphans."""

        persisted: list[ProcessorStatement] = []
        updated: list[ProcessorStatement] = []
        staged: list[ProcessorStatementStaging] = []
        removed: list[ProcessorStatement] = []
        next_cursor: str | None = None

        existing_stmt_query = select(ProcessorStatement)
        if created_gte is not None:
            existing_stmt_query = existing_stmt_query.where(ProcessorStatement.occurred_at >= created_gte)
        if created_lte is not None:
            existing_stmt_query = existing_stmt_query.where(ProcessorStatement.occurred_at <= created_lte)

        existing_stmt_result = await self._session.execute(existing_stmt_query)
        existing_map = {stmt.transaction_id: stmt for stmt in existing_stmt_result.scalars().all()}

        cursor = starting_after
        while True:
            page = await self._provider.list_balance_transactions(
                created_gte=created_gte,
                created_lte=created_lte,
                limit=limit,
                starting_after=cursor,
            )
            transactions = page.items
            if not transactions:
                next_cursor = page.next_cursor
                break

            next_cursor = page.next_cursor
            for tx in transactions:
                existing = existing_map.pop(tx.transaction_id, None)
                invoice, workspace_id, workspace_hint = await self._resolve_invoice_and_workspace(tx)
                if workspace_id is None:
                    staged.append(
                        await self._stage_orphaned_transaction(
                            tx,
                            reason=f"unresolved_workspace:{tx.type}",
                            workspace_hint=workspace_hint,
                        )
                    )
                    continue

                if existing:
                    if self._apply_transaction_updates(existing, tx, invoice):
                        updated.append(existing)
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

            if not page.has_more or not page.next_cursor:
                break
            cursor = page.next_cursor

        if existing_map:
            for missing_statement in existing_map.values():
                removed.append(missing_statement)
                staged.append(await self._stage_removed_statement(missing_statement))

        if any([persisted, updated, staged]):
            await self._session.flush()

        return StatementSyncResult(
            persisted=persisted,
            updated=updated,
            staged=staged,
            removed=removed,
            next_cursor=next_cursor,
        )

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
    ) -> tuple[Invoice | None, UUID | None, UUID | None]:
        invoice = None
        workspace_id: UUID | None = None
        workspace_hint: UUID | None = None

        metadata_sources: list[dict[str, str]] = []
        raw_metadata = self._extract_metadata(transaction.raw)
        if raw_metadata:
            metadata_sources.append(raw_metadata)

        if transaction.source_id:
            invoice_result = await self._session.execute(
                select(Invoice).where(Invoice.processor_charge_id == transaction.source_id)
            )
            invoice = invoice_result.scalar_one_or_none()
            if invoice:
                workspace_id = invoice.workspace_id
            else:
                charge_metadata = await self._fetch_charge_metadata(transaction.source_id)
                if charge_metadata:
                    metadata_sources.append(charge_metadata)

        for metadata in metadata_sources:
            workspace_candidate = metadata.get("workspace_id") or metadata.get("workspace")
            if workspace_candidate and workspace_hint is None:
                try:
                    workspace_hint = UUID(str(workspace_candidate))
                except ValueError:
                    workspace_hint = None
            invoice_candidate = metadata.get("invoice_id")
            if invoice_candidate and invoice is None:
                try:
                    invoice_uuid = UUID(str(invoice_candidate))
                except ValueError:
                    invoice_uuid = None
                if invoice_uuid:
                    invoice_lookup = await self._session.execute(
                        select(Invoice).where(Invoice.id == invoice_uuid)
                    )
                    invoice = invoice_lookup.scalar_one_or_none()
                    if invoice:
                        workspace_id = invoice.workspace_id

        if workspace_id is None and workspace_hint is not None:
            workspace_id = workspace_hint

        return invoice, workspace_id, workspace_hint

    def _apply_transaction_updates(
        self,
        statement: ProcessorStatement,
        transaction: StripeBalanceTransaction,
        invoice: Invoice | None,
        workspace_id: UUID,
    ) -> bool:
        """Update an existing statement with differential changes."""

        changed = False
        new_invoice_id = invoice.id if invoice else None
        if statement.invoice_id != new_invoice_id:
            statement.invoice_id = new_invoice_id
            changed = True
        if statement.workspace_id != workspace_id:
            statement.workspace_id = workspace_id
            changed = True

        mapped_type = self._map_transaction_type(transaction.type)
        if statement.transaction_type != mapped_type:
            statement.transaction_type = mapped_type
            changed = True
        if statement.currency != transaction.currency:
            statement.currency = transaction.currency
            changed = True
        if statement.gross_amount != transaction.amount:
            statement.gross_amount = transaction.amount
            changed = True
        if statement.fee_amount != transaction.fee:
            statement.fee_amount = transaction.fee
            changed = True
        if statement.net_amount != transaction.net:
            statement.net_amount = transaction.net
            changed = True
        if statement.charge_id != transaction.source_id:
            statement.charge_id = transaction.source_id
            changed = True
        if statement.occurred_at != transaction.created_at:
            statement.occurred_at = transaction.created_at
            changed = True

        incoming_payload = dict(transaction.raw)
        if statement.data != incoming_payload:
            statement.data = incoming_payload
            changed = True
        return changed

    async def _stage_orphaned_transaction(
        self,
        transaction: StripeBalanceTransaction,
        *,
        reason: str,
        workspace_hint: UUID | None,
    ) -> ProcessorStatementStaging:
        """Persist or update a staging row for unresolved processor data."""

        staging_result = await self._session.execute(
            select(ProcessorStatementStaging).where(
                ProcessorStatementStaging.transaction_id == transaction.transaction_id
            )
        )
        staging = staging_result.scalar_one_or_none()
        now = datetime.now(timezone.utc)
        payload = dict(transaction.raw)
        if staging:
            staging.reason = reason
            staging.payload = payload
            staging.workspace_hint = workspace_hint
            staging.last_observed_at = now
            return staging

        staging = ProcessorStatementStaging(
            transaction_id=transaction.transaction_id,
            processor="stripe",
            reason=reason,
            payload=payload,
            workspace_hint=workspace_hint,
            first_observed_at=now,
            last_observed_at=now,
        )
        self._session.add(staging)
        return staging

    async def _stage_removed_statement(
        self, statement: ProcessorStatement
    ) -> ProcessorStatementStaging:
        """Record a previously ingested statement that no longer appears in sync windows."""

        staging_result = await self._session.execute(
            select(ProcessorStatementStaging).where(
                ProcessorStatementStaging.transaction_id == statement.transaction_id
            )
        )
        staging = staging_result.scalar_one_or_none()
        now = datetime.now(timezone.utc)
        payload = {
            "statement_id": str(statement.id),
            "transaction_id": statement.transaction_id,
            "workspace_id": str(statement.workspace_id) if statement.workspace_id else None,
            "invoice_id": str(statement.invoice_id) if statement.invoice_id else None,
            "occurred_at": statement.occurred_at.isoformat() if statement.occurred_at else None,
        }
        if staging:
            staging.reason = "processor_missing"
            staging.payload = payload
            staging.workspace_hint = statement.workspace_id
            staging.last_observed_at = now
            return staging

        staging = ProcessorStatementStaging(
            transaction_id=statement.transaction_id,
            processor="stripe",
            reason="processor_missing",
            payload=payload,
            workspace_hint=statement.workspace_id,
            first_observed_at=now,
            last_observed_at=now,
        )
        self._session.add(staging)
        return staging

    @staticmethod
    def _extract_metadata(raw: object) -> dict[str, str]:
        if isinstance(raw, dict):
            metadata = raw.get("metadata")
            if isinstance(metadata, dict) and metadata:
                return {str(key): str(value) for key, value in metadata.items() if value is not None}
            source = raw.get("source")
            if isinstance(source, dict):
                nested_metadata = source.get("metadata")
                if isinstance(nested_metadata, dict) and nested_metadata:
                    return {
                        str(key): str(value)
                        for key, value in nested_metadata.items()
                        if value is not None
                    }
        return {}

    async def _fetch_charge_metadata(self, charge_id: str) -> dict[str, str]:
        try:
            charge = await self._provider.retrieve_charge(charge_id)
        except Exception:
            return {}
        metadata = charge.get("metadata") if isinstance(charge, dict) else None
        if isinstance(metadata, dict):
            return {str(key): str(value) for key, value in metadata.items() if value is not None}
        return {}

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

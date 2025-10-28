"""Processor statement ingestion and reconciliation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from smplat_api.models.invoice import Invoice
from smplat_api.services.billing.providers import (
    StripeBalanceTransaction,
    StripeBillingProvider,
    StripeDisputeRecord,
)
from smplat_api.services.secrets.stripe import (
    StripeWorkspaceSecretsResolver,
    build_default_stripe_secrets_resolver,
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

    def __init__(
        self,
        session: AsyncSession,
        provider: StripeBillingProvider | None = None,
        *,
        secrets_resolver: StripeWorkspaceSecretsResolver | None = None,
    ) -> None:
        self._session = session
        self._default_provider = provider
        self._workspace_providers: dict[UUID, StripeBillingProvider] = {}
        self._secrets_resolver = secrets_resolver or build_default_stripe_secrets_resolver()

    async def _resolve_provider(self, workspace_id: UUID) -> StripeBillingProvider:
        if self._default_provider is not None:
            return self._default_provider

        if workspace_id in self._workspace_providers:
            return self._workspace_providers[workspace_id]

        secrets = await self._secrets_resolver.get(workspace_id)
        if secrets is None:
            raise RuntimeError(f"Stripe credentials are not configured for workspace {workspace_id}")

        provider = StripeBillingProvider.from_credentials(secrets.api_key, secrets.webhook_secret)
        self._workspace_providers[workspace_id] = provider
        return provider

    async def sync_balance_transactions(
        self,
        *,
        workspace_id: UUID,
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
        latest_processed: StripeBalanceTransaction | None = None
        cursor_dirty = False

        workspace_cursor = await self._get_or_create_cursor(
            workspace_id=workspace_id,
            object_type="balance_transaction",
        )
        cursor_token = starting_after or workspace_cursor.cursor_token

        existing_stmt_query = select(ProcessorStatement).where(
            ProcessorStatement.workspace_id == workspace_id
        )
        if created_gte is not None:
            existing_stmt_query = existing_stmt_query.where(ProcessorStatement.occurred_at >= created_gte)
        if created_lte is not None:
            existing_stmt_query = existing_stmt_query.where(ProcessorStatement.occurred_at <= created_lte)

        existing_stmt_result = await self._session.execute(existing_stmt_query)
        existing_map = {stmt.transaction_id: stmt for stmt in existing_stmt_result.scalars().all()}

        provider = await self._resolve_provider(workspace_id)
        cursor = cursor_token
        while True:
            page = await provider.list_balance_transactions(
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
                resolved_invoice, resolved_workspace_id, workspace_hint = await self._resolve_invoice_and_workspace(tx)
                if resolved_workspace_id is None:
                    staged.append(
                        await self._stage_orphaned_transaction(
                            tx,
                            reason=f"unresolved_workspace:{tx.type}",
                            workspace_hint=workspace_hint,
                        )
                    )
                    continue

                if resolved_workspace_id != workspace_cursor.workspace_id:
                    staged.append(
                        await self._stage_orphaned_transaction(
                            tx,
                            reason=f"workspace_mismatch:{tx.type}",
                            workspace_hint=workspace_hint or resolved_workspace_id,
                        )
                    )
                    continue

                tx_updated_at = self._normalize_timestamp(tx.updated_at)
                cursor_updated_at = self._normalize_timestamp(
                    workspace_cursor.last_transaction_updated_at
                )
                if cursor_updated_at and tx_updated_at and tx_updated_at <= cursor_updated_at:
                    if tx.transaction_id == workspace_cursor.last_transaction_id:
                        continue
                    if tx_updated_at < cursor_updated_at:
                        continue

                if existing:
                    if self._apply_transaction_updates(existing, tx, resolved_invoice, resolved_workspace_id):
                        updated.append(existing)
                    if (
                        latest_processed is None
                        or tx_updated_at >= self._normalize_timestamp(latest_processed.updated_at)
                    ):
                        latest_processed = tx
                    continue

                statement = ProcessorStatement(
                    workspace_id=resolved_workspace_id,
                    invoice_id=resolved_invoice.id if resolved_invoice else None,
                    processor="stripe",
                    transaction_id=tx.transaction_id,
                    charge_id=tx.source_id,
                    transaction_type=self._map_transaction_type(tx),
                    currency=tx.currency,
                    gross_amount=tx.amount,
                    fee_amount=tx.fee,
                    net_amount=tx.net,
                    occurred_at=tx.created_at,
                    data=dict(tx.raw),
                )
                self._session.add(statement)
                persisted.append(statement)
                if (
                    latest_processed is None
                    or tx_updated_at >= self._normalize_timestamp(latest_processed.updated_at)
                ):
                    latest_processed = tx

            if not page.has_more or not page.next_cursor:
                break
            cursor = page.next_cursor

        if existing_map:
            for missing_statement in existing_map.values():
                removed.append(missing_statement)
                staged.append(await self._stage_removed_statement(missing_statement))

        if latest_processed:
            workspace_cursor.last_transaction_id = latest_processed.transaction_id
            workspace_cursor.last_transaction_occurred_at = latest_processed.created_at
            workspace_cursor.last_transaction_updated_at = self._normalize_timestamp(
                latest_processed.updated_at
            )
            workspace_cursor.cursor_token = next_cursor or latest_processed.transaction_id
            cursor_dirty = True
        elif next_cursor and next_cursor != workspace_cursor.cursor_token:
            workspace_cursor.cursor_token = next_cursor
            cursor_dirty = True

        if any([persisted, updated, staged, cursor_dirty]):
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
        workspace_id: UUID,
        created_gte: datetime | None = None,
        created_lte: datetime | None = None,
        limit: int = 100,
    ) -> list[BillingDiscrepancy]:
        """Capture dispute information and create discrepancy placeholders."""

        provider = await self._resolve_provider(workspace_id)
        disputes: list[StripeDisputeRecord] = await provider.list_disputes(
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

        normalized_type = transaction.type.lower()

        charge_lookup_id = transaction.source_id
        if charge_lookup_id is None and normalized_type in {"refund", "application_fee", "application_fee_refund"}:
            charge_lookup_id = self._extract_charge_reference(transaction.raw)

        if charge_lookup_id:
            invoice_result = await self._session.execute(
                select(Invoice).where(Invoice.processor_charge_id == charge_lookup_id)
            )
            invoice = invoice_result.scalar_one_or_none()
            if invoice:
                workspace_id = invoice.workspace_id
            else:
                charge_metadata = await self._fetch_charge_metadata(charge_lookup_id)
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

    @staticmethod
    def _extract_charge_reference(raw: object) -> str | None:
        if not isinstance(raw, Mapping):
            return None

        candidate_keys = [
            "charge",
            "source_transaction",
            "source",
            "payment_intent",
            "balance_transaction",
        ]
        for key in candidate_keys:
            value = raw.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, Mapping):
                nested_id = value.get("id")
                if isinstance(nested_id, str) and nested_id:
                    return nested_id
        return None

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

        mapped_type = self._map_transaction_type(transaction)
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

    async def _get_or_create_cursor(
        self, *, workspace_id: UUID, object_type: str
    ) -> BillingSyncCursor:
        """Fetch or initialize the durable sync cursor for a workspace scope."""

        result = await self._session.execute(
            select(BillingSyncCursor).where(
                BillingSyncCursor.workspace_id == workspace_id,
                BillingSyncCursor.processor == "stripe",
                BillingSyncCursor.object_type == object_type,
            )
        )
        cursor = result.scalar_one_or_none()
        if cursor:
            return cursor

        cursor = BillingSyncCursor(
            workspace_id=workspace_id,
            processor="stripe",
            object_type=object_type,
            cursor_token=None,
            last_transaction_id=None,
            last_transaction_occurred_at=None,
            last_transaction_updated_at=None,
        )
        self._session.add(cursor)
        await self._session.flush()
        return cursor

    @staticmethod
    def _normalize_timestamp(value: datetime | None) -> datetime | None:
        """Normalize timestamps to UTC-aware datetimes for safe comparisons."""

        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

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
            if staging.status in (
                ProcessorStatementStagingStatus.RESOLVED,
                ProcessorStatementStagingStatus.TRIAGED,
            ):
                staging.status = ProcessorStatementStagingStatus.PENDING
                staging.triage_note = None
                staging.last_triaged_at = None
                staging.resolved_at = None
            return staging

        staging = ProcessorStatementStaging(
            transaction_id=transaction.transaction_id,
            processor="stripe",
            reason=reason,
            payload=payload,
            workspace_hint=workspace_hint,
            status=ProcessorStatementStagingStatus.PENDING,
            triage_note=None,
            last_triaged_at=None,
            resolved_at=None,
            requeue_count=0,
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
            if staging.status in (
                ProcessorStatementStagingStatus.RESOLVED,
                ProcessorStatementStagingStatus.TRIAGED,
            ):
                staging.status = ProcessorStatementStagingStatus.PENDING
                staging.triage_note = None
                staging.last_triaged_at = None
                staging.resolved_at = None
            return staging

        staging = ProcessorStatementStaging(
            transaction_id=statement.transaction_id,
            processor="stripe",
            reason="processor_missing",
            payload=payload,
            workspace_hint=statement.workspace_id,
            status=ProcessorStatementStagingStatus.PENDING,
            triage_note=None,
            last_triaged_at=None,
            resolved_at=None,
            requeue_count=0,
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
            provider = await self._resolve_provider(workspace_id)
            charge = await provider.retrieve_charge(charge_id)
        except Exception:
            return {}
        metadata = charge.get("metadata") if isinstance(charge, dict) else None
        if isinstance(metadata, dict):
            return {str(key): str(value) for key, value in metadata.items() if value is not None}
        return {}

    @staticmethod
    def _map_transaction_type(
        transaction: StripeBalanceTransaction,
    ) -> ProcessorStatementTransactionType:
        normalized = transaction.type.lower()
        raw = dict(transaction.raw) if isinstance(transaction.raw, Mapping) else {}
        metadata = raw.get("metadata") if isinstance(raw.get("metadata"), Mapping) else {}
        reporting_category = str(raw.get("reporting_category", "")).lower()
        description = str(raw.get("description", "")).lower()

        if normalized in {"charge", "payment", "payment_intent"}:
            return ProcessorStatementTransactionType.CHARGE

        if normalized in {"refund", "application_fee_refund"}:
            raw_type = str(raw.get("type", "")).lower() if isinstance(raw, dict) else ""
            if raw.get("reversed") is True or raw_type in {"refund_reversal", "reversal"} or "reversal" in description:
                return ProcessorStatementTransactionType.REFUND_REVERSAL
            return ProcessorStatementTransactionType.REFUND

        if normalized in {"application_fee", "fee"}:
            raw_type = str(raw.get("type", "")).lower() if isinstance(raw, dict) else ""
            if raw_type in {"adjustment", "fee_adjustment"}:
                return ProcessorStatementTransactionType.FEE_ADJUSTMENT
            if isinstance(metadata, Mapping) and metadata.get("dynamic_fee") == "true":
                return ProcessorStatementTransactionType.DYNAMIC_FEE
            if "dynamic" in description or "tier" in description:
                return ProcessorStatementTransactionType.DYNAMIC_FEE
            return ProcessorStatementTransactionType.FEE

        if normalized == "payout":
            status = str(raw.get("status", "")).lower() if isinstance(raw, dict) else ""
            if status in {"pending", "in_transit"}:
                return ProcessorStatementTransactionType.PAYOUT_DELAY
            invoice_ids = None
            if isinstance(metadata, Mapping):
                candidate = metadata.get("invoice_ids") or metadata.get("invoices")
                if isinstance(candidate, str):
                    invoice_ids = [part.strip() for part in candidate.split(",") if part.strip()]
                elif isinstance(candidate, (list, tuple, set)):
                    invoice_ids = [str(item).strip() for item in candidate if str(item).strip()]
            if invoice_ids and len(invoice_ids) > 1:
                return ProcessorStatementTransactionType.MULTI_INVOICE_PAYOUT
            if transaction.net < 0:
                return ProcessorStatementTransactionType.PAYOUT_REVERSAL
            return ProcessorStatementTransactionType.PAYOUT

        if normalized in {"payout_reversal", "negative_payout"} or "payout_reversal" in reporting_category:
            return ProcessorStatementTransactionType.PAYOUT_REVERSAL

        if normalized in {"adjustment", "balance_adjustment"}:
            if "connect" in reporting_category or "transfer" in reporting_category or "transfer" in description:
                return ProcessorStatementTransactionType.CROSS_LEDGER_TRANSFER
            return ProcessorStatementTransactionType.BALANCE_ADJUSTMENT

        if normalized in {"transfer", "transfer_reversal"}:
            return ProcessorStatementTransactionType.CROSS_LEDGER_TRANSFER

        if normalized in {"currency_conversion", "fx", "foreign_exchange"} or "currency" in reporting_category:
            return (
                ProcessorStatementTransactionType.FX_LOSS
                if transaction.net < 0
                else ProcessorStatementTransactionType.FX_GAIN
            )

        if "dispute" in normalized or "dispute" in reporting_category:
            return ProcessorStatementTransactionType.DISPUTE_WITHHOLD

        if normalized in {"clawback", "charge_clawback"} or "clawback" in description:
            return ProcessorStatementTransactionType.PAYOUT_REVERSAL

        return ProcessorStatementTransactionType.ADJUSTMENT


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
            if statement.transaction_type in {
                ProcessorStatementTransactionType.FEE_ADJUSTMENT,
                ProcessorStatementTransactionType.PAYOUT_DELAY,
                ProcessorStatementTransactionType.REFUND_REVERSAL,
            }:
                discrepancies.append(
                    BillingDiscrepancy(
                        run_id=run.id,
                        invoice_id=statement.invoice_id,
                        processor_statement_id=statement.id,
                        transaction_id=statement.transaction_id,
                        discrepancy_type=_map_discrepancy_type(statement.transaction_type),
                        status=BillingDiscrepancyStatus.OPEN,
                        amount_delta=statement.net_amount,
                        summary=_summarize_discrepancy(statement),
                        resolution_note=None,
                    )
                )
            continue

        discrepancy_type = _map_discrepancy_type(statement.transaction_type)
        if discrepancy_type is None:
            discrepancy_type = BillingDiscrepancyType.MISSING_INVOICE
            summary = f"Statement {statement.transaction_id} missing invoice linkage"
        else:
            summary = _summarize_discrepancy(statement)

        discrepancies.append(
            BillingDiscrepancy(
                run_id=run.id,
                invoice_id=None,
                processor_statement_id=statement.id,
                transaction_id=statement.transaction_id,
                discrepancy_type=discrepancy_type,
                status=BillingDiscrepancyStatus.OPEN,
                amount_delta=statement.net_amount or statement.gross_amount,
                summary=summary,
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


def _map_discrepancy_type(
    transaction_type: ProcessorStatementTransactionType,
) -> BillingDiscrepancyType | None:
    mapping: dict[ProcessorStatementTransactionType, BillingDiscrepancyType] = {
        ProcessorStatementTransactionType.REFUND: BillingDiscrepancyType.UNAPPLIED_REFUND,
        ProcessorStatementTransactionType.FEE: BillingDiscrepancyType.UNTRACKED_FEE,
        ProcessorStatementTransactionType.FEE_ADJUSTMENT: BillingDiscrepancyType.FEE_ADJUSTMENT,
        ProcessorStatementTransactionType.PAYOUT_DELAY: BillingDiscrepancyType.PAYOUT_DELAY,
        ProcessorStatementTransactionType.REFUND_REVERSAL: BillingDiscrepancyType.REFUND_REVERSAL,
        ProcessorStatementTransactionType.PAYOUT_REVERSAL: BillingDiscrepancyType.PAYOUT_CLAWBACK,
        ProcessorStatementTransactionType.MULTI_INVOICE_PAYOUT: BillingDiscrepancyType.MULTI_INVOICE_SETTLEMENT,
        ProcessorStatementTransactionType.DYNAMIC_FEE: BillingDiscrepancyType.DYNAMIC_FEE_VARIANCE,
        ProcessorStatementTransactionType.BALANCE_ADJUSTMENT: BillingDiscrepancyType.BALANCE_ADJUSTMENT,
        ProcessorStatementTransactionType.CROSS_LEDGER_TRANSFER: BillingDiscrepancyType.CROSS_LEDGER_ADJUSTMENT,
        ProcessorStatementTransactionType.FX_GAIN: BillingDiscrepancyType.FX_IMPACT,
        ProcessorStatementTransactionType.FX_LOSS: BillingDiscrepancyType.FX_IMPACT,
        ProcessorStatementTransactionType.DISPUTE_WITHHOLD: BillingDiscrepancyType.DISPUTE_HOLD,
    }
    return mapping.get(transaction_type)


def _summarize_discrepancy(statement: ProcessorStatement) -> str:
    amount = statement.net_amount or statement.gross_amount
    formatted_amount = f"{amount}" if amount is not None else "unknown amount"
    data = statement.data if isinstance(statement.data, Mapping) else {}
    if statement.transaction_type == ProcessorStatementTransactionType.PAYOUT_DELAY:
        return f"Payout {statement.transaction_id} delayed for {formatted_amount}"
    if statement.transaction_type == ProcessorStatementTransactionType.FEE_ADJUSTMENT:
        return f"Fee adjustment {statement.transaction_id} requires review"
    if statement.transaction_type == ProcessorStatementTransactionType.REFUND_REVERSAL:
        return f"Refund reversal {statement.transaction_id} requires operator confirmation"
    if statement.transaction_type == ProcessorStatementTransactionType.REFUND:
        return f"Refund {statement.transaction_id} not linked to invoice"
    if statement.transaction_type == ProcessorStatementTransactionType.FEE:
        return f"Fee {statement.transaction_id} not tracked against an invoice"
    if statement.transaction_type == ProcessorStatementTransactionType.PAYOUT_REVERSAL:
        return f"Payout clawback {statement.transaction_id} reduced balances by {formatted_amount}"
    if statement.transaction_type == ProcessorStatementTransactionType.MULTI_INVOICE_PAYOUT:
        invoice_count = None
        if isinstance(data, Mapping):
            metadata = data.get("metadata") if isinstance(data.get("metadata"), Mapping) else {}
            if isinstance(metadata, Mapping):
                invoice_ids = metadata.get("invoice_ids") or metadata.get("invoices")
                if isinstance(invoice_ids, str):
                    invoice_count = len([part for part in invoice_ids.split(",") if part.strip()])
                elif isinstance(invoice_ids, (list, tuple, set)):
                    invoice_count = len(invoice_ids)
        invoice_fragment = f"across {invoice_count} invoices" if invoice_count else "across multiple invoices"
        return f"Settlement {statement.transaction_id} {invoice_fragment} requires allocation review"
    if statement.transaction_type == ProcessorStatementTransactionType.DYNAMIC_FEE:
        return f"Dynamic fee {statement.transaction_id} deviates by {formatted_amount}"
    if statement.transaction_type == ProcessorStatementTransactionType.BALANCE_ADJUSTMENT:
        return f"Balance adjustment {statement.transaction_id} posted for {formatted_amount}"
    if statement.transaction_type == ProcessorStatementTransactionType.CROSS_LEDGER_TRANSFER:
        target_workspace = None
        if isinstance(data, Mapping):
            target_workspace = data.get("destination") or data.get("connected_account")
        target_fragment = f" to {target_workspace}" if target_workspace else ""
        return f"Cross-ledger transfer{target_fragment} {statement.transaction_id} needs confirmation"
    if statement.transaction_type in {
        ProcessorStatementTransactionType.FX_GAIN,
        ProcessorStatementTransactionType.FX_LOSS,
    }:
        direction = "gain" if statement.transaction_type == ProcessorStatementTransactionType.FX_GAIN else "loss"
        return f"FX {direction} {statement.transaction_id} recorded for {formatted_amount}"
    if statement.transaction_type == ProcessorStatementTransactionType.DISPUTE_WITHHOLD:
        return f"Dispute hold {statement.transaction_id} locks {formatted_amount}"
    return f"Statement {statement.transaction_id} missing invoice linkage"

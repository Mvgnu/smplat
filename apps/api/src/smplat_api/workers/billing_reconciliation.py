"""Async worker to reconcile invoice ledger state with payment gateway events."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Dict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.billing_reconciliation import (
    BillingSyncCursor,
    ProcessorStatement,
    ProcessorStatementStaging,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.statements import (
    StripeStatementIngestionService,
    reconcile_statements,
)


class BillingLedgerReconciliationWorker:
    """Polls gateway data and harmonizes invoice settlement metadata."""

    # meta: worker: billing-ledger
    def __init__(
        self,
        session_factory: Callable[[], Awaitable[AsyncSession]] | Callable[[], AsyncSession],
    ) -> None:
        self._session_factory = session_factory

    async def run_once(self) -> Dict[str, int]:
        """Execute a single reconciliation sweep."""

        processed = 0
        settled = 0
        statements_ingested = 0
        statements_updated = 0
        disputes_logged = 0
        session = await self._ensure_session()
        async with session as managed_session:
            ingestion = StripeStatementIngestionService(managed_session)
            run = await ingestion.ensure_run()
            window_start = datetime.now(timezone.utc) - timedelta(days=7)
            should_commit = False
            aggregated_statements: list[ProcessorStatement] = []
            aggregated_staged: list[ProcessorStatementStaging] = []
            aggregated_removed: list[ProcessorStatement] = []
            cursor_summaries: list[dict[str, object | None]] = []

            workspace_rows = await managed_session.execute(
                select(Invoice.workspace_id).where(Invoice.workspace_id.isnot(None)).distinct()
            )
            cursor_workspace_rows = await managed_session.execute(
                select(BillingSyncCursor.workspace_id).distinct()
            )
            workspace_ids = set(workspace_rows.scalars().all())
            workspace_ids.update(cursor_workspace_rows.scalars().all())
            workspace_ids.discard(None)

            try:
                for workspace_scope in sorted(workspace_ids):
                    workspace_result = await ingestion.sync_balance_transactions(
                        workspace_id=workspace_scope,
                        created_gte=window_start,
                    )
                    statements_ingested += len(workspace_result.persisted)
                    statements_updated += len(workspace_result.updated)
                    if workspace_result.statements_for_reconciliation:
                        aggregated_statements.extend(workspace_result.statements_for_reconciliation)
                    if workspace_result.staged:
                        aggregated_staged.extend(workspace_result.staged)
                    if workspace_result.removed:
                        aggregated_removed.extend(workspace_result.removed)
                    cursor_summaries.append(
                        {
                            "workspace_id": str(workspace_scope),
                            "next_cursor": workspace_result.next_cursor,
                        }
                    )

                    workspace_disputes = await ingestion.sync_disputes(
                        workspace_id=workspace_scope,
                        created_gte=window_start,
                    )
                    if workspace_disputes:
                        disputes_logged += len(workspace_disputes)
                        should_commit = True

                if aggregated_statements:
                    await reconcile_statements(
                        managed_session,
                        statements=aggregated_statements,
                        run=run,
                    )
                    should_commit = True

                if aggregated_staged or aggregated_removed:
                    should_commit = True

                stmt = (
                    select(Invoice)
                    .where(
                        or_(
                            Invoice.settlement_at.is_(None),
                            Invoice.payment_timeline_json.is_(None),
                        )
                    )
                )
                result = await managed_session.execute(stmt)
                invoices = result.scalars().all()

                now = datetime.now(timezone.utc)
                for invoice in invoices:
                    timeline = list(invoice.payment_timeline_json or [])
                    timeline_modified = False
                    if not timeline:
                        timeline.append(
                            {
                                "event": "issued",
                                "at": (invoice.issued_at or now).isoformat(),
                                "amount": float(invoice.total or 0),
                            }
                        )
                        processed += 1
                        timeline_modified = True

                    if invoice.status == InvoiceStatusEnum.PAID and invoice.settlement_at is None:
                        invoice.settlement_at = now
                        settled += 1
                        timeline_modified = True

                    if timeline_modified:
                        invoice.payment_timeline_json = timeline
                        should_commit = True

                run.status = "completed"
                run.completed_at = now
                run.notes = self._build_run_note(
                    status="completed",
                    persisted=statements_ingested,
                    updated=statements_updated,
                    staged=len(aggregated_staged),
                    removed=len(aggregated_removed),
                    cursor=cursor_summaries,
                    disputes=disputes_logged,
                )
                should_commit = True

                if should_commit:
                    await managed_session.commit()
                else:
                    await managed_session.rollback()
            except Exception as exc:
                now = datetime.now(timezone.utc)
                run.status = "failed"
                run.completed_at = now
                run.notes = self._build_run_note(
                    status="failed",
                    persisted=statements_ingested,
                    updated=statements_updated,
                    staged=len(aggregated_staged),
                    removed=len(aggregated_removed),
                    cursor=cursor_summaries,
                    disputes=disputes_logged,
                    error=str(exc),
                )
                await managed_session.commit()
                raise

        return {
            "processed": processed,
            "settled": settled,
            "statements_ingested": statements_ingested,
            "statements_updated": statements_updated,
            "disputes_logged": disputes_logged,
        }

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        # meta: session-factory: awaitable
        return await maybe_session

    @staticmethod
    def _build_run_note(
        *,
        status: str,
        persisted: int,
        updated: int,
        staged: int,
        removed: int,
        cursor: object | None,
        disputes: int,
        error: str | None = None,
    ) -> str:
        payload: Dict[str, object] = {
            "status": status,
            "persisted": persisted,
            "updated": updated,
            "staged": staged,
            "removed": removed,
            "disputes": disputes,
            "cursor": cursor,
        }
        if error:
            payload["error"] = error
        return json.dumps(payload)

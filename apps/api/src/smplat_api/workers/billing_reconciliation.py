"""Async worker to reconcile invoice ledger state with payment gateway events."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


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
        session = await self._ensure_session()
        async with session as managed_session:
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
                if not timeline:
                    timeline.append(
                        {
                            "event": "issued",
                            "at": (invoice.issued_at or now).isoformat(),
                            "amount": float(invoice.total or 0),
                        }
                    )
                    processed += 1

                if invoice.status == InvoiceStatusEnum.PAID and invoice.settlement_at is None:
                    invoice.settlement_at = now
                    settled += 1

                if processed or settled:
                    invoice.payment_timeline_json = timeline

            if processed or settled:
                await managed_session.commit()
            else:
                await managed_session.rollback()

        return {"processed": processed, "settled": settled}

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        # meta: session-factory: awaitable
        return await maybe_session

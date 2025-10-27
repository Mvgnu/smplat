"""Gateway adapter orchestrating invoice payment captures and refunds."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, MutableSequence
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


@dataclass(slots=True)
class GatewayCaptureResult:
    """Outcome returned after a capture attempt."""

    intent_id: str
    processor_id: str
    captured_amount: Decimal
    captured_at: datetime
    was_new_intent: bool


@dataclass(slots=True)
class GatewayRefundResult:
    """Outcome returned after a refund attempt."""

    processor_id: str
    refund_id: str
    amount: Decimal
    refunded_at: datetime


class BillingGatewayClient:
    """High-level gateway facade for billing ledger operations."""

    # meta: billing-gateway: staged-rollout
    def __init__(self, db: AsyncSession):
        self._db = db

    def _ensure_rollout(self) -> None:
        if settings.billing_rollout_stage == "disabled":
            raise RuntimeError("Billing gateway is disabled in current rollout stage")

    async def capture_payment(self, invoice: Invoice, amount: Decimal | None = None) -> GatewayCaptureResult:
        """Capture a payment for the given invoice and update ledger metadata."""

        self._ensure_rollout()
        now = datetime.now(timezone.utc)
        requested_amount = amount if amount is not None else invoice.balance_due or invoice.total or Decimal("0")
        capture_amount = Decimal(requested_amount)

        if capture_amount <= 0:
            raise ValueError("Capture amount must be positive")

        intent_id = invoice.payment_intent_id or f"pi_{uuid4().hex[:14]}"
        processor_id = f"txn_{uuid4().hex[:12]}"
        was_new_intent = invoice.payment_intent_id is None

        timeline: MutableSequence[dict[str, Any]] = list(invoice.payment_timeline_json or [])
        timeline.append(
            {
                "event": "captured",
                "at": now.isoformat(),
                "amount": float(capture_amount),
                "processor_id": processor_id,
            }
        )

        new_balance = Decimal(invoice.balance_due or Decimal("0")) - capture_amount
        if new_balance <= 0:
            invoice.status = InvoiceStatusEnum.PAID
            invoice.balance_due = Decimal("0")
            invoice.paid_at = now
        else:
            invoice.balance_due = new_balance

        invoice.payment_intent_id = intent_id
        invoice.external_processor_id = processor_id
        invoice.settlement_at = now
        invoice.payment_timeline_json = timeline

        await self._db.flush()

        return GatewayCaptureResult(
            intent_id=intent_id,
            processor_id=processor_id,
            captured_amount=capture_amount,
            captured_at=now,
            was_new_intent=was_new_intent,
        )

    async def refund_payment(self, invoice: Invoice, amount: Decimal | None = None) -> GatewayRefundResult:
        """Refund a processed payment and record ledger adjustments."""

        self._ensure_rollout()
        now = datetime.now(timezone.utc)
        requested_amount = amount if amount is not None else invoice.total or Decimal("0")
        refund_amount = Decimal(requested_amount)

        if refund_amount <= 0:
            raise ValueError("Refund amount must be positive")

        processor_id = invoice.external_processor_id or f"txn_{uuid4().hex[:12]}"
        refund_id = f"rf_{uuid4().hex[:10]}"

        timeline: MutableSequence[dict[str, Any]] = list(invoice.payment_timeline_json or [])
        timeline.append(
            {
                "event": "refunded",
                "at": now.isoformat(),
                "amount": float(refund_amount * -1),
                "processor_id": processor_id,
                "reference": refund_id,
            }
        )

        adjustments: MutableSequence[dict[str, Any]] = list(invoice.adjustments_json or [])
        adjustments.append(
            {
                "type": "refund",
                "amount": float(refund_amount),
                "memo": "Gateway refund",  # meta: adjustment-memo: gateway
                "applied_at": now.isoformat(),
                "reference": refund_id,
            }
        )

        invoice.payment_timeline_json = timeline
        invoice.adjustments_json = adjustments
        invoice.adjustments_total = (Decimal(invoice.adjustments_total or Decimal("0")) - refund_amount)
        invoice.external_processor_id = processor_id
        if invoice.status == InvoiceStatusEnum.PAID:
            invoice.status = InvoiceStatusEnum.ISSUED
        invoice.balance_due = Decimal(invoice.balance_due or Decimal("0"))

        await self._db.flush()

        return GatewayRefundResult(
            processor_id=processor_id,
            refund_id=refund_id,
            amount=refund_amount,
            refunded_at=now,
        )

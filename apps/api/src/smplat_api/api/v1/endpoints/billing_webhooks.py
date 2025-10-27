"""Webhook endpoints for billing processors."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import stripe
from fastapi import APIRouter, HTTPException, Request, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import get_session
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.providers import StripeBillingProvider

router = APIRouter(prefix="/billing/webhooks", tags=["billing-webhooks"])


async def _resolve_invoice(db: AsyncSession, invoice_id: UUID) -> Invoice | None:
    return await db.get(Invoice, invoice_id)


@router.post("/stripe", status_code=status.HTTP_202_ACCEPTED)
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Handle Stripe webhook callbacks and update invoice ledger."""

    provider = StripeBillingProvider.from_settings()
    secret = provider.webhook_secret
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe webhook secret not configured")

    payload = await request.body()
    signature = request.headers.get("Stripe-Signature")
    if not signature:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Stripe signature header")

    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=signature, secret=secret)
    except stripe.error.SignatureVerificationError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe signature") from exc

    event_id = str(event["id"])
    event_type = event["type"]
    data_object: dict[str, Any] = event["data"]["object"]
    metadata: dict[str, Any] = data_object.get("metadata", {})
    raw_invoice_id = metadata.get("invoice_id") or data_object.get("invoice")
    if not raw_invoice_id:
        return {"status": "ignored"}

    try:
        invoice_id = UUID(str(raw_invoice_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invoice identifier")

    invoice = await _resolve_invoice(db, invoice_id)
    if invoice is None:
        return {"status": "ignored"}

    if invoice.webhook_replay_token == event_id:
        return {"status": "duplicate"}

    await _apply_event(invoice, event_type, data_object)
    invoice.webhook_replay_token = event_id
    await db.flush()
    await db.commit()
    return {"status": "processed"}


async def _apply_event(invoice: Invoice, event_type: str, data_object: dict[str, Any]) -> None:
    """Map Stripe event types to invoice mutations."""

    if event_type == "payment_intent.succeeded":
        await _handle_payment_succeeded(invoice, data_object)
    elif event_type == "payment_intent.payment_failed":
        await _handle_payment_failed(invoice, data_object)
    elif event_type == "charge.refunded":
        await _handle_charge_refunded(invoice, data_object)


async def _handle_payment_succeeded(invoice: Invoice, data_object: dict[str, Any]) -> None:
    charges = data_object.get("charges", {}).get("data", [])
    if not charges:
        return
    charge = charges[0]
    captured_at = datetime.fromtimestamp(charge.get("created", 0), tz=timezone.utc)
    amount_received = Decimal(charge.get("amount_captured") or charge.get("amount", 0)) / Decimal(100)
    timeline = list(invoice.payment_timeline_json or [])
    timeline.append(
        {
            "event": "captured",
            "at": captured_at.isoformat(),
            "amount": float(amount_received),
            "processor_id": charge.get("id"),
        }
    )
    invoice.payment_timeline_json = timeline
    invoice.balance_due = Decimal("0")
    invoice.status = InvoiceStatusEnum.PAID
    invoice.paid_at = captured_at
    invoice.settlement_at = captured_at
    invoice.payment_intent_id = data_object.get("id", invoice.payment_intent_id)
    invoice.external_processor_id = charge.get("id")
    invoice.processor_charge_id = charge.get("id")
    invoice.processor_customer_id = data_object.get("customer")
    invoice.last_payment_error = None


async def _handle_payment_failed(invoice: Invoice, data_object: dict[str, Any]) -> None:
    failure_message = data_object.get("last_payment_error", {}).get("message")
    invoice.last_payment_error = failure_message
    timeline = list(invoice.payment_timeline_json or [])
    timeline.append(
        {
            "event": "failed",
            "at": datetime.now(timezone.utc).isoformat(),
            "processor_id": data_object.get("id"),
            "reason": failure_message,
        }
    )
    invoice.payment_timeline_json = timeline


async def _handle_charge_refunded(invoice: Invoice, data_object: dict[str, Any]) -> None:
    refunds = data_object.get("refunds", {}).get("data", [])
    if not refunds:
        return
    refund = refunds[0]
    refunded_at = datetime.fromtimestamp(refund.get("created", 0), tz=timezone.utc)
    amount = Decimal(refund.get("amount", 0)) / Decimal(100)
    timeline = list(invoice.payment_timeline_json or [])
    timeline.append(
        {
            "event": "refunded",
            "at": refunded_at.isoformat(),
            "amount": float(amount * -1),
            "processor_id": data_object.get("id"),
            "reference": refund.get("id"),
        }
    )
    adjustments = list(invoice.adjustments_json or [])
    adjustments.append(
        {
            "type": "refund",
            "amount": float(amount),
            "memo": "Processor refund webhook",
            "applied_at": refunded_at.isoformat(),
            "reference": refund.get("id"),
        }
    )
    invoice.payment_timeline_json = timeline
    invoice.adjustments_json = adjustments
    invoice.adjustments_total = (Decimal(invoice.adjustments_total or Decimal("0")) - amount)
    invoice.status = InvoiceStatusEnum.ISSUED
    invoice.balance_due = Decimal(invoice.balance_due or Decimal("0")) + amount
    invoice.last_payment_error = refund.get("failure_reason")

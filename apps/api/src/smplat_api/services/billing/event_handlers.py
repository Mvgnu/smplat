"""Utilities for handling processor webhook payloads."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


async def handle_stripe_event(invoice: Invoice, event_type: str, data_object: dict[str, Any]) -> None:
    """Dispatch Stripe webhook event processing for invoices."""

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
    created_ts = charge.get("created", 0)
    captured_at = datetime.fromtimestamp(created_ts, tz=timezone.utc)
    amount_captured = Decimal(charge.get("amount_captured") or charge.get("amount", 0))
    amount_received = amount_captured / Decimal(100)
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
    created_ts = refund.get("created", 0)
    refunded_at = datetime.fromtimestamp(created_ts, tz=timezone.utc)
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

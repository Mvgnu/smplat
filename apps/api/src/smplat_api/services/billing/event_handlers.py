"""Utilities for handling processor webhook payloads."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


async def handle_stripe_event(
    db: AsyncSession,
    invoice: Invoice,
    event_type: str,
    data_object: dict[str, Any],
) -> None:
    """Dispatch Stripe webhook event processing for invoices."""

    if event_type == "payment_intent.succeeded":
        await _handle_payment_succeeded(db, invoice, data_object)
    elif event_type == "payment_intent.payment_failed":
        await _handle_payment_failed(db, invoice, data_object)
    elif event_type == "charge.refunded":
        await _handle_charge_refunded(invoice, data_object)
    elif event_type in {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    }:
        await _handle_checkout_session_completed(db, invoice, data_object)
    elif event_type in {
        "checkout.session.expired",
        "checkout.session.async_payment_failed",
    }:
        await _handle_checkout_session_terminated(db, invoice, data_object)


async def _handle_payment_succeeded(
    db: AsyncSession, invoice: Invoice, data_object: dict[str, Any]
) -> None:
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

    session = await _resolve_hosted_session(
        db,
        invoice,
        session_id=data_object.get("metadata", {}).get("hosted_session_id"),
        payment_intent=data_object.get("id"),
    )
    if session:
        metadata = dict(session.metadata_json or {})
        if data_object.get("id"):
            metadata["payment_intent_id"] = data_object.get("id")
        metadata["last_webhook_event"] = "payment_intent.succeeded"
        session.metadata_json = metadata
        _transition_session(
            session,
            HostedCheckoutSessionStatusEnum.COMPLETED,
            at=captured_at,
        )


async def _handle_payment_failed(
    db: AsyncSession, invoice: Invoice, data_object: dict[str, Any]
) -> None:
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

    session = await _resolve_hosted_session(
        db,
        invoice,
        session_id=data_object.get("metadata", {}).get("hosted_session_id"),
        payment_intent=data_object.get("id"),
    )
    if session:
        metadata = dict(session.metadata_json or {})
        metadata["last_webhook_event"] = "payment_intent.payment_failed"
        if data_object.get("id"):
            metadata.setdefault("payment_intent_id", data_object.get("id"))
        session.metadata_json = metadata
        _transition_session(
            session,
            HostedCheckoutSessionStatusEnum.FAILED,
            at=datetime.now(timezone.utc),
            last_error=failure_message,
        )


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


async def _handle_checkout_session_completed(
    db: AsyncSession, invoice: Invoice, data_object: dict[str, Any]
) -> None:
    session = await _resolve_hosted_session(
        db,
        invoice,
        session_id=data_object.get("id"),
        payment_intent=data_object.get("payment_intent"),
    )
    if not session:
        return

    completed_ts = data_object.get("completed_at") or data_object.get("created")
    completed_at = (
        datetime.fromtimestamp(completed_ts, tz=timezone.utc)
        if completed_ts
        else datetime.now(timezone.utc)
    )
    metadata = dict(session.metadata_json or {})
    metadata["last_webhook_event"] = "checkout.session.completed"
    if data_object.get("payment_intent"):
        metadata.setdefault("payment_intent_id", data_object.get("payment_intent"))
    session.metadata_json = metadata
    _transition_session(
        session,
        HostedCheckoutSessionStatusEnum.COMPLETED,
        at=completed_at,
    )


async def _handle_checkout_session_terminated(
    db: AsyncSession, invoice: Invoice, data_object: dict[str, Any]
) -> None:
    session = await _resolve_hosted_session(
        db,
        invoice,
        session_id=data_object.get("id"),
        payment_intent=data_object.get("payment_intent"),
    )
    if not session:
        return

    terminated_ts = data_object.get("expires_at") or data_object.get("created")
    terminated_at = (
        datetime.fromtimestamp(terminated_ts, tz=timezone.utc)
        if terminated_ts
        else datetime.now(timezone.utc)
    )
    if data_object.get("status") == "expired":
        status = HostedCheckoutSessionStatusEnum.EXPIRED
    else:
        status = HostedCheckoutSessionStatusEnum.FAILED
    last_error = None
    if status == HostedCheckoutSessionStatusEnum.FAILED:
        async_error = data_object.get("last_payment_error", {})
        last_error = async_error.get("message") or async_error.get("code")
    metadata = dict(session.metadata_json or {})
    metadata["last_webhook_event"] = data_object.get("status") or "checkout.session.terminated"
    if data_object.get("payment_intent"):
        metadata.setdefault("payment_intent_id", data_object.get("payment_intent"))
    if last_error:
        metadata["last_error"] = last_error
    session.metadata_json = metadata
    _transition_session(
        session,
        status,
        at=terminated_at,
        last_error=last_error,
    )


async def _resolve_hosted_session(
    db: AsyncSession,
    invoice: Invoice,
    *,
    session_id: str | None,
    payment_intent: str | None = None,
) -> HostedCheckoutSession | None:
    """Locate the hosted session associated with a webhook payload."""

    # meta: hosted-session: resolver

    candidates: list[HostedCheckoutSession] = []
    if "hosted_sessions" in invoice.__dict__:
        raw_sessions = invoice.__dict__.get("hosted_sessions") or []
        candidates = list(raw_sessions)
    if session_id:
        for candidate in reversed(candidates):
            if candidate.session_id == session_id:
                return candidate
        stmt = (
            select(HostedCheckoutSession)
            .where(
                HostedCheckoutSession.invoice_id == invoice.id,
                HostedCheckoutSession.session_id == session_id,
            )
            .order_by(HostedCheckoutSession.created_at.desc())
            .limit(1)
        )
        with db.no_autoflush:
            result = await db.execute(stmt)
        found = result.scalars().first()
        if found:
            return found
    if payment_intent:
        for candidate in reversed(candidates):
            metadata = candidate.metadata_json or {}
            if metadata.get("payment_intent_id") == payment_intent:
                return candidate
    if "hosted_session" in invoice.__dict__ and invoice.hosted_session is not None:
        return invoice.hosted_session
    if candidates:
        return candidates[-1]
    stmt = (
        select(HostedCheckoutSession)
        .where(HostedCheckoutSession.invoice_id == invoice.id)
        .order_by(HostedCheckoutSession.created_at.desc())
        .limit(1)
    )
    with db.no_autoflush:
        result = await db.execute(stmt)
    return result.scalars().first()


def _transition_session(
    session: HostedCheckoutSession,
    status: HostedCheckoutSessionStatusEnum,
    *,
    at: datetime,
    last_error: str | None = None,
) -> None:
    """Apply lifecycle updates onto a hosted checkout session."""

    # meta: hosted-session: transition

    if session.status == HostedCheckoutSessionStatusEnum.COMPLETED and status != HostedCheckoutSessionStatusEnum.COMPLETED:
        return
    if session.status == HostedCheckoutSessionStatusEnum.ABANDONED and status != HostedCheckoutSessionStatusEnum.COMPLETED:
        return

    session.last_error = last_error
    if status == HostedCheckoutSessionStatusEnum.COMPLETED:
        session.status = status
        session.completed_at = at
        session.cancelled_at = None
    elif status in {
        HostedCheckoutSessionStatusEnum.EXPIRED,
        HostedCheckoutSessionStatusEnum.ABANDONED,
        HostedCheckoutSessionStatusEnum.FAILED,
    }:
        session.status = status
        session.cancelled_at = at
        if status == HostedCheckoutSessionStatusEnum.EXPIRED:
            session.last_error = last_error

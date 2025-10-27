"""Webhook endpoints for billing processors."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import async_session, get_session
from smplat_api.models.invoice import Invoice
from smplat_api.models.processor_event import (
    mark_replay_requested,
    record_processor_event,
    register_replay_attempt,
)
from smplat_api.models.webhook_event import WebhookProviderEnum
from smplat_api.services.billing.event_handlers import handle_stripe_event
from smplat_api.workers.processor_events import ProcessorEventReplayWorker
from smplat_api.services.billing.providers import StripeBillingProvider

router = APIRouter(prefix="/billing/webhooks", tags=["billing-webhooks"])


async def _resolve_invoice(db: AsyncSession, invoice_id: UUID) -> Invoice | None:
    return await db.get(Invoice, invoice_id)


def _enqueue_replay_processing() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        worker = ProcessorEventReplayWorker(async_session)
        await worker.process_pending(limit=20)

    loop.create_task(_run())


@router.post("/stripe", status_code=status.HTTP_202_ACCEPTED)
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Handle Stripe webhook callbacks, persisting the ledger and triggering reconciliation."""

    provider = StripeBillingProvider.from_settings()
    secret = provider.webhook_secret
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stripe webhook secret not configured")

    payload_bytes = await request.body()
    payload_text = payload_bytes.decode("utf-8")
    payload_hash = hashlib.sha256(payload_bytes).hexdigest()
    signature = request.headers.get("Stripe-Signature")
    if not signature:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Stripe signature header")

    try:
        event = stripe.Webhook.construct_event(payload=payload_text, sig_header=signature, secret=secret)
    except stripe.error.SignatureVerificationError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe signature") from exc

    try:
        payload_dict = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload body") from exc

    event_id = str(event["id"])
    event_type = event["type"]
    data_object: dict[str, Any] = event["data"]["object"]
    metadata: dict[str, Any] = data_object.get("metadata", {})
    raw_invoice_id = metadata.get("invoice_id") or data_object.get("invoice")

    record = await record_processor_event(
        db,
        provider=WebhookProviderEnum.STRIPE,
        external_id=event_id,
        payload_hash=payload_hash,
        payload=payload_dict,
        correlation_id=str(raw_invoice_id) if raw_invoice_id else None,
    )

    if not record.created:
        await db.rollback()
        return {"status": "duplicate"}

    now = datetime.now(timezone.utc)
    await mark_replay_requested(db, event=record.event, requested_at=now)

    if not raw_invoice_id:
        await db.commit()
        _enqueue_replay_processing()
        return {"status": "ignored"}

    try:
        invoice_id = UUID(str(raw_invoice_id))
    except ValueError:
        await register_replay_attempt(db, event=record.event, attempted_at=now, error="invalid_invoice_id")
        await db.commit()
        _enqueue_replay_processing()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invoice identifier")

    invoice = await _resolve_invoice(db, invoice_id)
    if invoice is None:
        record.event.invoice_id = invoice_id
        await register_replay_attempt(db, event=record.event, attempted_at=now, error="invoice_not_found")
        await db.commit()
        _enqueue_replay_processing()
        return {"status": "ignored"}

    record.event.invoice_id = invoice.id
    record.event.workspace_id = invoice.workspace_id
    record.event.correlation_id = str(invoice.id)

    if invoice.webhook_replay_token == event_id:
        await db.commit()
        _enqueue_replay_processing()
        return {"status": "duplicate"}

    await handle_stripe_event(invoice, event_type, data_object)
    invoice.webhook_replay_token = event_id
    await register_replay_attempt(db, event=record.event, attempted_at=now, error=None)
    await db.flush()
    await db.commit()

    _enqueue_replay_processing()
    return {"status": "processed"}

"""Billing center API endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from io import StringIO
from typing import Dict, List, Optional
from uuid import UUID
import csv

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.core.settings import settings
from smplat_api.db.session import get_session
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing import BillingGatewayClient

router = APIRouter(prefix="/billing", tags=["billing"])


class InvoiceLineItemResponse(BaseModel):
    """Serialized invoice line item."""

    id: str
    description: str
    quantity: float
    unit_amount: float
    total_amount: float
    order_id: Optional[str] = None
    campaign_reference: Optional[str] = Field(
        None, description="Campaign or experiment code associated with the service line."
    )
    metadata: Optional[Dict[str, object]] = None


class InvoiceResponse(BaseModel):
    """Serialized invoice."""

    id: str
    invoice_number: str
    status: str
    currency: str
    subtotal: float
    tax: float
    total: float
    balance_due: float
    payment_intent_id: Optional[str] = Field(default=None, alias="paymentIntentId")
    external_processor_id: Optional[str] = Field(default=None, alias="externalProcessorId")
    processor_customer_id: Optional[str] = Field(default=None, alias="processorCustomerId")
    processor_charge_id: Optional[str] = Field(default=None, alias="processorChargeId")
    last_payment_error: Optional[str] = Field(default=None, alias="lastPaymentError")
    settlement_at: Optional[str] = Field(default=None, alias="settlementAt")
    adjustments_total: float = Field(default=0, alias="adjustmentsTotal")
    adjustments: Optional[List[Dict[str, object]]] = None
    payment_timeline: Optional[List[Dict[str, object]]] = Field(
        default=None,
        alias="paymentTimeline",
        description="Chronological events representing the invoice payment lifecycle.",
    )
    issued_at: str
    due_at: str
    paid_at: Optional[str]
    memo: Optional[str]
    line_items: List[InvoiceLineItemResponse]

    model_config = {
        "populate_by_name": True,
    }


class InvoiceSummary(BaseModel):
    """Aggregate totals for workspace invoices."""

    currency: str
    outstanding_total: float
    overdue_total: float
    paid_total: float


class AgingBuckets(BaseModel):
    """Invoice aging rollup grouped by threshold."""

    current: float = 0
    thirty: float = 0
    sixty: float = 0
    ninety_plus: float = Field(0, alias="ninetyPlus")

    model_config = {
        "populate_by_name": True,
    }




class HostedCheckoutResponse(BaseModel):
    """Hosted checkout session payload."""

    session_id: str = Field(alias="sessionId")
    checkout_url: str = Field(alias="checkoutUrl")
    expires_at: str = Field(alias="expiresAt")

    model_config = {"populate_by_name": True}


class InvoiceListResponse(BaseModel):
    """List response for invoices including summary totals."""

    invoices: List[InvoiceResponse]
    summary: InvoiceSummary
    aging: AgingBuckets


class CaptureInvoiceRequest(BaseModel):
    """Payload to capture an outstanding invoice."""

    amount: Optional[float] = Field(
        default=None,
        ge=0,
        description="Optional amount override for partial captures.",
    )


class RefundInvoiceRequest(BaseModel):
    """Payload to refund a previously captured invoice."""

    amount: Optional[float] = Field(
        default=None,
        ge=0,
        description="Optional amount override for partial refunds.",
    )


class InvoiceExportFormat(str, Enum):
    CSV = "csv"
    PDF = "pdf"


def _ensure_rollout(workspace_id: UUID) -> None:
    stage = settings.billing_rollout_stage
    if stage == "disabled":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing center is not enabled")
    if stage == "pilot":
        allowed = {value.lower() for value in settings.billing_rollout_workspaces}
        if str(workspace_id).lower() not in allowed:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing center unavailable for workspace")


def _coerce_decimal(value: Decimal | float | int | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _ensure_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _normalize_invoice(invoice: Invoice) -> InvoiceResponse:
    line_items = [
        InvoiceLineItemResponse(
            id=str(item.id),
            description=item.description,
            quantity=float(item.quantity or 0),
            unit_amount=_coerce_decimal(item.unit_amount),
            total_amount=_coerce_decimal(item.total_amount),
            order_id=str(item.order_id) if item.order_id else None,
            campaign_reference=item.campaign_reference,
            metadata=item.metadata_json,
        )
        for item in invoice.line_items
    ]

    status_value = invoice.status.value if isinstance(invoice.status, InvoiceStatusEnum) else str(invoice.status)
    now = datetime.now(timezone.utc)
    due_at = _ensure_datetime(invoice.due_at)
    issued_at = _ensure_datetime(invoice.issued_at)
    paid_at = _ensure_datetime(invoice.paid_at)
    settlement_at = _ensure_datetime(getattr(invoice, "settlement_at", None))
    adjustments_total = _coerce_decimal(getattr(invoice, "adjustments_total", 0))
    adjustments = getattr(invoice, "adjustments_json", None)
    payment_timeline = getattr(invoice, "payment_timeline_json", None)
    if (
        status_value in {InvoiceStatusEnum.ISSUED.value, InvoiceStatusEnum.DRAFT.value}
        and due_at
        and due_at < now
        and _coerce_decimal(invoice.balance_due) > 0
    ):
        status_value = InvoiceStatusEnum.OVERDUE.value

    return InvoiceResponse(
        id=str(invoice.id),
        invoice_number=invoice.invoice_number,
        status=status_value,
        currency=invoice.currency.value if hasattr(invoice.currency, "value") else str(invoice.currency),
        subtotal=_coerce_decimal(invoice.subtotal),
        tax=_coerce_decimal(invoice.tax),
        total=_coerce_decimal(invoice.total),
        balance_due=_coerce_decimal(invoice.balance_due),
        payment_intent_id=getattr(invoice, "payment_intent_id", None),
        external_processor_id=getattr(invoice, "external_processor_id", None),
        processor_customer_id=getattr(invoice, "processor_customer_id", None),
        processor_charge_id=getattr(invoice, "processor_charge_id", None),
        last_payment_error=getattr(invoice, "last_payment_error", None),
        settlement_at=settlement_at.isoformat() if settlement_at else None,
        adjustments_total=adjustments_total,
        adjustments=adjustments,
        payment_timeline=payment_timeline,
        issued_at=issued_at.isoformat() if issued_at else "",
        due_at=due_at.isoformat() if due_at else "",
        paid_at=paid_at.isoformat() if paid_at else None,
        memo=invoice.memo,
        line_items=line_items,
    )


def _summarize_invoices(invoices: List[InvoiceResponse]) -> tuple[InvoiceSummary, AgingBuckets]:
    outstanding = 0.0
    overdue = 0.0
    paid = 0.0
    currency = invoices[0].currency if invoices else "EUR"
    buckets = AgingBuckets()
    now = datetime.now(timezone.utc)

    for invoice in invoices:
        balance = invoice.balance_due
        if invoice.status.lower() == InvoiceStatusEnum.PAID.value:
            paid += invoice.total
            continue

        outstanding += balance
        due_at = datetime.fromisoformat(invoice.due_at) if invoice.due_at else now
        delta = now - due_at
        if invoice.status.lower() == InvoiceStatusEnum.OVERDUE.value or balance > 0 and delta.days > 0:
            overdue += balance

        if delta.days <= 0:
            buckets.current += balance
        elif delta.days <= 30:
            buckets.thirty += balance
        elif delta.days <= 60:
            buckets.sixty += balance
        else:
            buckets.ninety_plus += balance

    summary = InvoiceSummary(
        currency=currency,
        outstanding_total=round(outstanding, 2),
        overdue_total=round(overdue, 2),
        paid_total=round(paid, 2),
    )
    buckets.current = round(buckets.current, 2)
    buckets.thirty = round(buckets.thirty, 2)
    buckets.sixty = round(buckets.sixty, 2)
    buckets.ninety_plus = round(buckets.ninety_plus, 2)

    return summary, buckets


@router.get(
    "/invoices",
    response_model=InvoiceListResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_invoices(
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> InvoiceListResponse:
    """List invoices for a workspace including summary metrics."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.workspace_id == workspace_id)
        .order_by(Invoice.issued_at.desc())
    )
    result = await db.execute(stmt)
    invoices = result.scalars().all()
    serialized = [_normalize_invoice(invoice) for invoice in invoices]
    summary, aging = _summarize_invoices(serialized)
    return InvoiceListResponse(invoices=serialized, summary=summary, aging=aging)


@router.get(
    "/invoices/{invoice_id}",
    response_model=InvoiceResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def get_invoice(
    invoice_id: UUID,
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> InvoiceResponse:
    """Return a single invoice scoped to the provided workspace."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    return _normalize_invoice(invoice)


@router.get(
    "/invoices/{invoice_id}/export",
    dependencies=[Depends(require_checkout_api_key)],
)
async def export_invoice(
    invoice_id: UUID,
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    format: InvoiceExportFormat = Query(InvoiceExportFormat.CSV),
    db: AsyncSession = Depends(get_session),
):
    """Export invoice data as CSV (PDF placeholder for future iterations)."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    if format == InvoiceExportFormat.PDF:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="PDF export not yet available")

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Invoice", invoice.invoice_number])
    writer.writerow(["Status", invoice.status.value if isinstance(invoice.status, InvoiceStatusEnum) else invoice.status])
    writer.writerow(["Issued", invoice.issued_at.isoformat() if invoice.issued_at else ""])
    writer.writerow(["Due", invoice.due_at.isoformat() if invoice.due_at else ""])
    writer.writerow(["Currency", invoice.currency.value if hasattr(invoice.currency, "value") else invoice.currency])
    writer.writerow([])
    writer.writerow(["Description", "Quantity", "Unit", "Total", "Order", "Campaign"])

    for item in invoice.line_items:
        writer.writerow(
            [
                item.description,
                float(item.quantity or 0),
                _coerce_decimal(item.unit_amount),
                _coerce_decimal(item.total_amount),
                str(item.order_id) if item.order_id else "",
                item.campaign_reference or "",
            ]
        )

    writer.writerow([])
    writer.writerow(["Subtotal", _coerce_decimal(invoice.subtotal)])
    writer.writerow(["Tax", _coerce_decimal(invoice.tax)])
    writer.writerow(["Total", _coerce_decimal(invoice.total)])
    writer.writerow(["Balance due", _coerce_decimal(invoice.balance_due)])

    output.seek(0)
    filename = f"invoice-{invoice.invoice_number}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)


@router.post(
    "/invoices/{invoice_id}/checkout",
    response_model=HostedCheckoutResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_invoice_checkout_session(
    invoice_id: UUID,
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> HostedCheckoutResponse:
    """Create a hosted payment session for the invoice."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    gateway = BillingGatewayClient(db)
    success_url = f"{settings.frontend_url}/billing/success?invoiceId={invoice_id}"
    cancel_url = f"{settings.frontend_url}/billing/cancel?invoiceId={invoice_id}"
    try:
        session = await gateway.create_hosted_session(
            invoice, success_url=success_url, cancel_url=cancel_url
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(invoice)
    return HostedCheckoutResponse(
        session_id=session.session_id,
        checkout_url=session.url,
        expires_at=session.expires_at.isoformat(),
    )


@router.post(
    "/invoices/{invoice_id}/capture",
    response_model=InvoiceResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def capture_invoice(
    invoice_id: UUID,
    payload: CaptureInvoiceRequest = Body(default=CaptureInvoiceRequest()),
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> InvoiceResponse:
    """Capture payment for an outstanding invoice and persist ledger data."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    gateway = BillingGatewayClient(db)
    try:
        decimal_amount = Decimal(str(payload.amount)) if payload.amount is not None else None
        await gateway.capture_payment(invoice, decimal_amount)
    except ValueError as exc:  # meta: ledger-validation: capture
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(invoice)
    await db.refresh(invoice, attribute_names=["line_items"])
    return _normalize_invoice(invoice)


@router.post(
    "/invoices/{invoice_id}/refund",
    response_model=InvoiceResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def refund_invoice(
    invoice_id: UUID,
    payload: RefundInvoiceRequest = Body(default=RefundInvoiceRequest()),
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> InvoiceResponse:
    """Refund a previously captured invoice and update ledger adjustments."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    gateway = BillingGatewayClient(db)
    try:
        decimal_amount = Decimal(str(payload.amount)) if payload.amount is not None else None
        await gateway.refund_payment(invoice, decimal_amount)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(invoice)
    await db.refresh(invoice, attribute_names=["line_items"])
    return _normalize_invoice(invoice)


@router.post(
    "/invoices/{invoice_id}/notify",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def trigger_invoice_notification(
    invoice_id: UUID,
    workspace_id: UUID = Query(..., description="Workspace identifier"),
    db: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Trigger invoice overdue notification if billing alerts are enabled."""

    _ensure_rollout(workspace_id)

    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(Invoice.id == invoice_id, Invoice.workspace_id == workspace_id)
    )
    result = await db.execute(stmt)
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    from smplat_api.services.notifications.service import NotificationService

    service = NotificationService(db)
    await service.send_invoice_overdue(invoice)

    return {"status": "queued"}

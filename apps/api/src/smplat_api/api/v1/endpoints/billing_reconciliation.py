"""Endpoints exposing billing reconciliation insights for operators."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.billing_reconciliation import (
    BillingDiscrepancy,
    BillingDiscrepancyStatus,
    BillingDiscrepancyType,
    BillingReconciliationRun,
)

router = APIRouter(
    prefix="/billing/reconciliation",
    tags=["billing-reconciliation"],
    dependencies=[Depends(require_checkout_api_key)],
)


class BillingReconciliationRunResponse(BaseModel):
    """Serialized reconciliation run summary."""

    id: UUID
    started_at: datetime = Field(alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")
    status: str
    total_transactions: int = Field(alias="totalTransactions")
    matched_transactions: int = Field(alias="matchedTransactions")
    discrepancy_count: int = Field(alias="discrepancyCount")
    notes: str | None

    model_config = {"populate_by_name": True}


class BillingDiscrepancyResponse(BaseModel):
    """Serialized discrepancy record."""

    id: UUID
    run_id: UUID = Field(alias="runId")
    invoice_id: UUID | None = Field(default=None, alias="invoiceId")
    processor_statement_id: UUID | None = Field(default=None, alias="processorStatementId")
    transaction_id: str | None = Field(default=None, alias="transactionId")
    discrepancy_type: str = Field(alias="discrepancyType")
    status: str
    amount_delta: float | None = Field(default=None, alias="amountDelta")
    summary: str | None
    resolution_note: str | None = Field(default=None, alias="resolutionNote")
    resolved_at: datetime | None = Field(default=None, alias="resolvedAt")
    created_at: datetime = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class ResolveDiscrepancyRequest(BaseModel):
    """Payload to finalize a discrepancy."""

    resolution_note: str = Field(alias="resolutionNote")


class RunListingResponse(BaseModel):
    """Response container for reconciliation runs and open discrepancies."""

    runs: list[BillingReconciliationRunResponse]
    open_discrepancies: list[BillingDiscrepancyResponse] = Field(alias="openDiscrepancies")

    model_config = {"populate_by_name": True}


@router.get("/runs", response_model=RunListingResponse)
async def list_runs(
    *,
    session: AsyncSession = Depends(get_session),
    limit: int = Query(10, ge=1, le=100),
) -> RunListingResponse:
    """Return latest reconciliation runs with outstanding discrepancies."""

    runs_result = await session.execute(
        select(BillingReconciliationRun)
        .order_by(BillingReconciliationRun.started_at.desc())
        .limit(limit)
    )
    runs = runs_result.scalars().all()

    discrepancies_result = await session.execute(
        select(BillingDiscrepancy).where(BillingDiscrepancy.status == BillingDiscrepancyStatus.OPEN)
    )
    discrepancies = discrepancies_result.scalars().all()

    return RunListingResponse(
        runs=[_serialize_run(run) for run in runs],
        openDiscrepancies=[_serialize_discrepancy(item) for item in discrepancies],
    )


@router.get("/discrepancies", response_model=list[BillingDiscrepancyResponse])
async def list_discrepancies(
    *,
    status_filter: BillingDiscrepancyStatus | None = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
) -> list[BillingDiscrepancyResponse]:
    """List discrepancies filtered by status."""

    stmt = select(BillingDiscrepancy)
    if status_filter:
        stmt = stmt.where(BillingDiscrepancy.status == status_filter)

    result = await session.execute(stmt.order_by(BillingDiscrepancy.created_at.desc()))
    items = result.scalars().all()
    return [_serialize_discrepancy(item) for item in items]


@router.post("/discrepancies/{discrepancy_id}/acknowledge", response_model=BillingDiscrepancyResponse)
async def acknowledge_discrepancy(
    *,
    discrepancy_id: UUID = Path(..., alias="discrepancyId"),
    session: AsyncSession = Depends(get_session),
) -> BillingDiscrepancyResponse:
    """Mark a discrepancy as acknowledged by finance."""

    discrepancy = await _get_discrepancy(session, discrepancy_id)
    discrepancy.status = BillingDiscrepancyStatus.ACKNOWLEDGED
    await session.flush()
    return _serialize_discrepancy(discrepancy)


@router.post("/discrepancies/{discrepancy_id}/resolve", response_model=BillingDiscrepancyResponse)
async def resolve_discrepancy(
    *,
    discrepancy_id: UUID = Path(..., alias="discrepancyId"),
    payload: ResolveDiscrepancyRequest,
    session: AsyncSession = Depends(get_session),
) -> BillingDiscrepancyResponse:
    """Resolve a discrepancy with supporting notes."""

    discrepancy = await _get_discrepancy(session, discrepancy_id)
    discrepancy.status = BillingDiscrepancyStatus.RESOLVED
    discrepancy.resolution_note = payload.resolution_note
    discrepancy.resolved_at = datetime.now(timezone.utc)
    await session.flush()
    return _serialize_discrepancy(discrepancy)


@router.post("/discrepancies/{discrepancy_id}/requeue", response_model=BillingDiscrepancyResponse)
async def requeue_discrepancy(
    *,
    discrepancy_id: UUID = Path(..., alias="discrepancyId"),
    session: AsyncSession = Depends(get_session),
) -> BillingDiscrepancyResponse:
    """Reset a discrepancy to open for further investigation."""

    discrepancy = await _get_discrepancy(session, discrepancy_id)
    discrepancy.status = BillingDiscrepancyStatus.OPEN
    discrepancy.resolution_note = None
    discrepancy.resolved_at = None
    await session.flush()
    return _serialize_discrepancy(discrepancy)


@router.get("/statements", response_model=list[BillingDiscrepancyResponse])
async def list_statement_discrepancies(
    *,
    session: AsyncSession = Depends(get_session),
) -> list[BillingDiscrepancyResponse]:
    """Return discrepancies linked to statements for review."""

    stmt = select(BillingDiscrepancy).where(BillingDiscrepancy.processor_statement_id.is_not(None))
    result = await session.execute(stmt.order_by(BillingDiscrepancy.created_at.desc()))
    return [_serialize_discrepancy(item) for item in result.scalars().all()]


async def _get_discrepancy(session: AsyncSession, discrepancy_id: UUID) -> BillingDiscrepancy:
    result = await session.execute(
        select(BillingDiscrepancy).where(BillingDiscrepancy.id == discrepancy_id)
    )
    discrepancy = result.scalar_one_or_none()
    if not discrepancy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discrepancy not found")
    return discrepancy


def _serialize_run(run: BillingReconciliationRun) -> BillingReconciliationRunResponse:
    return BillingReconciliationRunResponse(
        id=run.id,
        startedAt=_normalize_dt(run.started_at),
        completedAt=_normalize_dt(run.completed_at),
        status=run.status,
        totalTransactions=run.total_transactions,
        matchedTransactions=run.matched_transactions,
        discrepancyCount=run.discrepancy_count,
        notes=run.notes,
    )


def _serialize_discrepancy(discrepancy: BillingDiscrepancy) -> BillingDiscrepancyResponse:
    return BillingDiscrepancyResponse(
        id=discrepancy.id,
        runId=discrepancy.run_id,
        invoiceId=discrepancy.invoice_id,
        processorStatementId=discrepancy.processor_statement_id,
        transactionId=discrepancy.transaction_id,
        discrepancyType=discrepancy.discrepancy_type.value
        if isinstance(discrepancy.discrepancy_type, BillingDiscrepancyType)
        else str(discrepancy.discrepancy_type),
        status=discrepancy.status.value
        if isinstance(discrepancy.status, BillingDiscrepancyStatus)
        else str(discrepancy.status),
        amountDelta=float(discrepancy.amount_delta) if discrepancy.amount_delta is not None else None,
        summary=discrepancy.summary,
        resolutionNote=discrepancy.resolution_note,
        resolvedAt=_normalize_dt(discrepancy.resolved_at),
        createdAt=_normalize_dt(discrepancy.created_at),
    )


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value

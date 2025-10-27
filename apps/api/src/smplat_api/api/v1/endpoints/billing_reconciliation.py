"""Endpoints exposing billing reconciliation insights for operators."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.billing_reconciliation import (
    BillingDiscrepancy,
    BillingDiscrepancyStatus,
    BillingDiscrepancyType,
    BillingReconciliationRun,
    ProcessorStatementStaging,
    ProcessorStatementStagingStatus,
)

router = APIRouter(
    prefix="/billing/reconciliation",
    tags=["billing-reconciliation"],
    dependencies=[Depends(require_checkout_api_key)],
)


class BillingReconciliationRunMetrics(BaseModel):
    """Structured summary of reconciliation sweep metrics."""

    status: str
    persisted: int = 0
    updated: int = 0
    staged: int = 0
    removed: int = 0
    disputes: int = 0
    cursor: str | None = None
    error: str | None = None

    model_config = {"populate_by_name": True}


class BillingReconciliationRunFailure(BaseModel):
    """Structured metadata for failed reconciliation runs."""

    status: str
    error: str
    staged: int = 0
    persisted: int = 0
    updated: int = 0
    removed: int = 0
    disputes: int = 0
    cursor: str | None = None

    model_config = {"populate_by_name": True}


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
    metrics: BillingReconciliationRunMetrics | None = None
    failure: BillingReconciliationRunFailure | None = None

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


class ProcessorStatementStagingResponse(BaseModel):
    """Serialized view of staged processor events awaiting triage."""

    id: UUID
    transaction_id: str = Field(alias="transactionId")
    processor: str
    reason: str
    status: str
    triage_note: str | None = Field(default=None, alias="triageNote")
    requeue_count: int = Field(alias="requeueCount")
    workspace_hint: UUID | None = Field(default=None, alias="workspaceHint")
    payload: dict[str, Any] | None
    first_observed_at: datetime = Field(alias="firstObservedAt")
    last_observed_at: datetime = Field(alias="lastObservedAt")
    last_triaged_at: datetime | None = Field(default=None, alias="lastTriagedAt")
    resolved_at: datetime | None = Field(default=None, alias="resolvedAt")

    model_config = {"populate_by_name": True}


class TriageStagingEntryRequest(BaseModel):
    """Payload to capture finance triage outcomes for staged events."""

    status: ProcessorStatementStagingStatus
    triage_note: str | None = Field(default=None, alias="triageNote")

    model_config = {"populate_by_name": True}


class RequeueStagingEntryRequest(BaseModel):
    """Payload to flag a staged entry for reprocessing."""

    triage_note: str | None = Field(default=None, alias="triageNote")

    model_config = {"populate_by_name": True}


class RunListingResponse(BaseModel):
    """Response container for reconciliation runs and open discrepancies."""

    runs: list[BillingReconciliationRunResponse]
    open_discrepancies: list[BillingDiscrepancyResponse] = Field(alias="openDiscrepancies")
    staging_backlog: int = Field(alias="stagingBacklog")

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

    staging_count_stmt = (
        select(func.count())
        .select_from(ProcessorStatementStaging)
        .where(
            ProcessorStatementStaging.status.in_(
                [
                    ProcessorStatementStagingStatus.PENDING,
                    ProcessorStatementStagingStatus.REQUEUED,
                ]
            )
        )
    )
    staging_count = await session.execute(staging_count_stmt)
    staging_backlog = staging_count.scalar_one()

    return RunListingResponse(
        runs=[_serialize_run(run) for run in runs],
        openDiscrepancies=[_serialize_discrepancy(item) for item in discrepancies],
        stagingBacklog=staging_backlog,
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


@router.get("/staging", response_model=list[ProcessorStatementStagingResponse])
async def list_staged_events(
    *,
    status_filter: ProcessorStatementStagingStatus | None = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session),
) -> list[ProcessorStatementStagingResponse]:
    """Return staged processor events for manual review."""

    stmt = select(ProcessorStatementStaging)
    if status_filter:
        stmt = stmt.where(ProcessorStatementStaging.status == status_filter)

    result = await session.execute(
        stmt.order_by(ProcessorStatementStaging.last_observed_at.desc())
    )
    entries = result.scalars().all()
    return [_serialize_staging(entry) for entry in entries]


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


@router.post("/staging/{staging_id}/triage", response_model=ProcessorStatementStagingResponse)
async def triage_staged_event(
    *,
    staging_id: UUID = Path(...),
    payload: TriageStagingEntryRequest,
    session: AsyncSession = Depends(get_session),
) -> ProcessorStatementStagingResponse:
    """Capture manual triage outcomes for a staged processor transaction."""

    staging = await _get_staging_entry(session, staging_id)
    now = datetime.now(timezone.utc)
    staging.status = payload.status
    staging.triage_note = payload.triage_note
    staging.last_triaged_at = now
    staging.resolved_at = now if payload.status == ProcessorStatementStagingStatus.RESOLVED else None
    await session.flush()
    await session.commit()
    await session.refresh(staging)
    return _serialize_staging(staging)


@router.post("/staging/{staging_id}/requeue", response_model=ProcessorStatementStagingResponse)
async def requeue_staged_event(
    *,
    staging_id: UUID = Path(...),
    payload: RequeueStagingEntryRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> ProcessorStatementStagingResponse:
    """Flag a staged processor event for reprocessing."""

    staging = await _get_staging_entry(session, staging_id)
    now = datetime.now(timezone.utc)
    staging.status = ProcessorStatementStagingStatus.REQUEUED
    staging.triage_note = payload.triage_note if payload else None
    staging.last_triaged_at = now
    staging.resolved_at = None
    staging.requeue_count = (staging.requeue_count or 0) + 1
    staging.last_observed_at = now
    await session.flush()
    await session.commit()
    await session.refresh(staging)
    return _serialize_staging(staging)


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


async def _get_staging_entry(
    session: AsyncSession, staging_id: UUID
) -> ProcessorStatementStaging:
    result = await session.execute(
        select(ProcessorStatementStaging).where(ProcessorStatementStaging.id == staging_id)
    )
    staging = result.scalar_one_or_none()
    if not staging:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staged entry not found")
    return staging


def _serialize_run(run: BillingReconciliationRun) -> BillingReconciliationRunResponse:
    note_payload = _load_run_note(run.notes)
    return BillingReconciliationRunResponse(
        id=run.id,
        startedAt=_normalize_dt(run.started_at),
        completedAt=_normalize_dt(run.completed_at),
        status=run.status,
        totalTransactions=run.total_transactions,
        matchedTransactions=run.matched_transactions,
        discrepancyCount=run.discrepancy_count,
        notes=run.notes,
        metrics=_parse_run_metrics(note_payload),
        failure=_parse_run_failure(note_payload),
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


def _serialize_staging(entry: ProcessorStatementStaging) -> ProcessorStatementStagingResponse:
    return ProcessorStatementStagingResponse(
        id=entry.id,
        transactionId=entry.transaction_id,
        processor=entry.processor,
        reason=entry.reason,
        status=entry.status.value
        if isinstance(entry.status, ProcessorStatementStagingStatus)
        else str(entry.status),
        triageNote=entry.triage_note,
        requeueCount=entry.requeue_count,
        workspaceHint=entry.workspace_hint,
        payload=entry.payload,
        firstObservedAt=_normalize_dt(entry.first_observed_at),
        lastObservedAt=_normalize_dt(entry.last_observed_at),
        lastTriagedAt=_normalize_dt(entry.last_triaged_at),
        resolvedAt=_normalize_dt(entry.resolved_at),
    )


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _load_run_note(notes: str | None) -> dict[str, Any] | None:
    if not notes:
        return None
    try:
        payload = json.loads(notes)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _parse_run_metrics(payload: dict[str, Any] | None) -> BillingReconciliationRunMetrics | None:
    if payload is None:
        return None

    data: dict[str, Any] = {
        "status": str(payload.get("status", "unknown")),
        "persisted": int(payload.get("persisted", 0) or 0),
        "updated": int(payload.get("updated", 0) or 0),
        "staged": int(payload.get("staged", 0) or 0),
        "removed": int(payload.get("removed", 0) or 0),
        "disputes": int(payload.get("disputes", 0) or 0),
        "cursor": payload.get("cursor"),
        "error": payload.get("error"),
    }
    return BillingReconciliationRunMetrics(**data)


def _parse_run_failure(payload: dict[str, Any] | None) -> BillingReconciliationRunFailure | None:
    if payload is None:
        return None

    status = str(payload.get("status", "unknown"))
    error = payload.get("error")
    if status != "failed" or not error:
        return None

    data: dict[str, Any] = {
        "status": status,
        "error": str(error),
        "staged": int(payload.get("staged", 0) or 0),
        "persisted": int(payload.get("persisted", 0) or 0),
        "updated": int(payload.get("updated", 0) or 0),
        "removed": int(payload.get("removed", 0) or 0),
        "disputes": int(payload.get("disputes", 0) or 0),
        "cursor": payload.get("cursor"),
    }
    return BillingReconciliationRunFailure(**data)

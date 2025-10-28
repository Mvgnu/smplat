"""Hosted session analytics endpoints."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.api.v1.endpoints.billing import _ensure_rollout
from smplat_api.db.session import get_session
from smplat_api.services.billing import (
    AggregatedReason,
    HostedSessionMetrics,
    HostedSessionReport,
    InvoiceStatusRollup,
    compute_hosted_session_report,
)

router = APIRouter(
    prefix="/billing/reports",
    tags=["billing-reports"],
    dependencies=[Depends(require_checkout_api_key)],
)


class AggregatedReasonResponse(BaseModel):
    """Failure reason rollup payload."""

    # meta: billing-report: response-reason

    reason: str
    count: int


class InvoiceStatusResponse(BaseModel):
    """Invoice status rollup payload."""

    # meta: billing-report: response-invoice-status

    status: str
    count: int


class HostedSessionMetricsResponse(BaseModel):
    """Serialized hosted session metric payload."""

    # meta: billing-report: response-metrics

    total: int
    status_counts: dict[str, int] = Field(alias="statusCounts")
    conversion_rate: float = Field(alias="conversionRate")
    abandonment_rate: float = Field(alias="abandonmentRate")
    average_completion_seconds: float | None = Field(
        default=None, alias="averageCompletionSeconds"
    )
    average_retry_count: float = Field(alias="averageRetryCount")
    sessions_with_retries: int = Field(alias="sessionsWithRetries")
    average_retry_latency_seconds: float | None = Field(
        default=None, alias="averageRetryLatencySeconds"
    )
    pending_regeneration: int = Field(alias="pendingRegeneration")

    model_config = {"populate_by_name": True}


class HostedSessionReportResponse(BaseModel):
    """Hosted session analytics report payload."""

    # meta: billing-report: response

    workspace_id: str = Field(alias="workspaceId")
    generated_at: str = Field(alias="generatedAt")
    window_start: str = Field(alias="windowStart")
    window_end: str = Field(alias="windowEnd")
    lookback_days: int = Field(alias="lookbackDays")
    metrics: HostedSessionMetricsResponse
    abandonment_reasons: list[AggregatedReasonResponse] = Field(
        alias="abandonmentReasons"
    )
    invoice_statuses: list[InvoiceStatusResponse] = Field(alias="invoiceStatuses")

    model_config = {"populate_by_name": True}


@router.get("", response_model=HostedSessionReportResponse)
async def get_hosted_session_report(
    workspace_id: UUID = Query(..., alias="workspaceId"),
    lookback_days: int = Query(30, ge=1, le=120),
    db: AsyncSession = Depends(get_session),
) -> HostedSessionReportResponse:
    """Return hosted session funnel analytics for operator tooling."""

    _ensure_rollout(workspace_id)
    report = await compute_hosted_session_report(
        db,
        workspace_id=str(workspace_id),
        lookback_days=lookback_days,
    )
    return _serialize_report(report, lookback_days=lookback_days)


def _serialize_report(
    report: HostedSessionReport, *, lookback_days: int
) -> HostedSessionReportResponse:
    return HostedSessionReportResponse(
        workspaceId=report.workspace_id,
        generatedAt=_isoformat(report.generated_at),
        windowStart=_isoformat(report.window_start),
        windowEnd=_isoformat(report.window_end),
        lookbackDays=lookback_days,
        metrics=_serialize_metrics(report.metrics),
        abandonmentReasons=[_serialize_reason(reason) for reason in report.abandonment_reasons],
        invoiceStatuses=[_serialize_invoice(status) for status in report.invoice_statuses],
    )


def _serialize_metrics(metrics: HostedSessionMetrics) -> HostedSessionMetricsResponse:
    return HostedSessionMetricsResponse(
        total=metrics.total,
        statusCounts=metrics.status_counts,
        conversionRate=metrics.conversion_rate,
        abandonmentRate=metrics.abandonment_rate,
        averageCompletionSeconds=metrics.average_completion_seconds,
        averageRetryCount=metrics.average_retry_count,
        sessionsWithRetries=metrics.sessions_with_retries,
        averageRetryLatencySeconds=metrics.average_retry_latency_seconds,
        pendingRegeneration=metrics.pending_regeneration,
    )


def _serialize_reason(reason: AggregatedReason) -> AggregatedReasonResponse:
    return AggregatedReasonResponse(reason=reason.reason, count=reason.count)


def _serialize_invoice(status: InvoiceStatusRollup) -> InvoiceStatusResponse:
    return InvoiceStatusResponse(status=status.status, count=status.count)


def _isoformat(value: datetime) -> str:
    return value.isoformat()

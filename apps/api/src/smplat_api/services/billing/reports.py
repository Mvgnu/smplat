"""Analytics helpers for hosted checkout sessions and invoices."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum


@dataclass(slots=True)
class AggregatedReason:
    """Count of hosted session failures grouped by final error reason."""

    # meta: billing-report: reason-count

    reason: str
    count: int


@dataclass(slots=True)
class InvoiceStatusRollup:
    """Aggregate of invoices associated with hosted sessions grouped by status."""

    # meta: billing-report: invoice-rollup

    status: str
    count: int


@dataclass(slots=True)
class HostedSessionMetrics:
    """Key metrics summarizing hosted checkout session performance."""

    # meta: billing-report: metrics

    total: int
    status_counts: dict[str, int]
    conversion_rate: float
    abandonment_rate: float
    average_completion_seconds: float | None
    average_retry_count: float
    sessions_with_retries: int
    average_retry_latency_seconds: float | None
    pending_regeneration: int


@dataclass(slots=True)
class HostedSessionReport:
    """Analytics report blending hosted session funnel data with invoice state."""

    # meta: billing-report: report

    workspace_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime
    metrics: HostedSessionMetrics
    abandonment_reasons: list[AggregatedReason]
    invoice_statuses: list[InvoiceStatusRollup]


async def compute_hosted_session_report(
    db: AsyncSession,
    *,
    workspace_id: str | UUID,
    lookback_days: int = 30,
    now: datetime | None = None,
) -> HostedSessionReport:
    """Compute hosted session funnel analytics for a workspace."""

    # meta: billing-report: aggregator

    current_time = now or datetime.now(timezone.utc)
    window_start = current_time - timedelta(days=lookback_days)

    workspace_uuid = workspace_id if isinstance(workspace_id, UUID) else UUID(str(workspace_id))

    filters = [
        HostedCheckoutSession.workspace_id == workspace_uuid,
        HostedCheckoutSession.created_at >= window_start,
    ]

    status_stmt = (
        select(
            HostedCheckoutSession.status,
            func.count().label("count"),
        )
        .where(*filters)
        .group_by(HostedCheckoutSession.status)
    )
    status_result = await db.execute(status_stmt)
    status_counts = _coerce_status_counts(status_result.all())
    total_sessions = sum(status_counts.values())

    conversion_rate = _safe_ratio(
        status_counts.get(HostedCheckoutSessionStatusEnum.COMPLETED.value, 0),
        total_sessions,
    )
    abandonment_rate = _safe_ratio(
        status_counts.get(HostedCheckoutSessionStatusEnum.EXPIRED.value, 0)
        + status_counts.get(HostedCheckoutSessionStatusEnum.ABANDONED.value, 0)
        + status_counts.get(HostedCheckoutSessionStatusEnum.FAILED.value, 0),
        total_sessions,
    )

    average_completion_seconds = await _avg_interval_seconds(
        db,
        select(
            func.extract(
                "epoch",
                HostedCheckoutSession.completed_at - HostedCheckoutSession.created_at,
            )
        )
        .where(
            *filters,
            HostedCheckoutSession.completed_at.isnot(None),
        )
    )

    average_retry_count = await _avg_scalar(
        db,
        select(func.avg(func.nullif(HostedCheckoutSession.retry_count, 0))).where(*filters),
    ) or 0.0

    sessions_with_retries = await _scalar_int(
        db,
        select(func.count()).where(
            *filters,
            HostedCheckoutSession.retry_count > 0,
        ),
    )

    average_retry_latency_seconds = await _avg_interval_seconds(
        db,
        select(
            func.extract(
                "epoch",
                HostedCheckoutSession.last_retry_at - HostedCheckoutSession.created_at,
            )
        )
        .where(
            *filters,
            HostedCheckoutSession.last_retry_at.isnot(None),
        )
    )

    pending_regeneration = await _scalar_int(
        db,
        select(func.count()).where(
            *filters,
            HostedCheckoutSession.status.in_(
                [
                    HostedCheckoutSessionStatusEnum.INITIATED,
                    HostedCheckoutSessionStatusEnum.FAILED,
                ]
            ),
            HostedCheckoutSession.next_retry_at.isnot(None),
            HostedCheckoutSession.next_retry_at > current_time,
        ),
    )

    abandonment_reasons_stmt = (
        select(
            HostedCheckoutSession.last_error,
            func.count().label("count"),
        )
        .where(
            *filters,
            HostedCheckoutSession.status.in_(
                [
                    HostedCheckoutSessionStatusEnum.EXPIRED,
                    HostedCheckoutSessionStatusEnum.ABANDONED,
                    HostedCheckoutSessionStatusEnum.FAILED,
                ]
            ),
        )
        .group_by(HostedCheckoutSession.last_error)
        .order_by(func.count().desc())
    )
    abandonment_rows = (await db.execute(abandonment_reasons_stmt)).all()
    abandonment_reasons = [
        AggregatedReason(reason=row.last_error or "unknown", count=row.count)
        for row in abandonment_rows
    ]

    invoice_status_stmt = (
        select(Invoice.status, func.count().label("count"))
        .select_from(HostedCheckoutSession)
        .join(Invoice, Invoice.id == HostedCheckoutSession.invoice_id)
        .where(
            *filters,
            Invoice.workspace_id == workspace_uuid,
        )
        .group_by(Invoice.status)
    )
    invoice_status_rows = (await db.execute(invoice_status_stmt)).all()
    invoice_statuses = [
        InvoiceStatusRollup(
            status=_coerce_invoice_status(row.status),
            count=row.count,
        )
        for row in invoice_status_rows
    ]

    metrics = HostedSessionMetrics(
        total=total_sessions,
        status_counts=status_counts,
        conversion_rate=conversion_rate,
        abandonment_rate=abandonment_rate,
        average_completion_seconds=average_completion_seconds,
        average_retry_count=float(average_retry_count),
        sessions_with_retries=sessions_with_retries,
        average_retry_latency_seconds=average_retry_latency_seconds,
        pending_regeneration=pending_regeneration,
    )

    return HostedSessionReport(
        workspace_id=str(workspace_uuid),
        generated_at=current_time,
        window_start=window_start,
        window_end=current_time,
        metrics=metrics,
        abandonment_reasons=abandonment_reasons,
        invoice_statuses=invoice_statuses,
    )


async def _avg_scalar(db: AsyncSession, stmt) -> float | None:
    result = await db.execute(stmt)
    value = result.scalar()
    return float(value) if value is not None else None


async def _avg_interval_seconds(db: AsyncSession, stmt) -> float | None:
    value = await _avg_scalar(db, stmt)
    if value is None or value <= 0:
        return None
    return value


async def _scalar_int(db: AsyncSession, stmt) -> int:
    result = await db.execute(stmt)
    value = result.scalar()
    return int(value or 0)


def _coerce_status_counts(rows: Sequence[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        status = row.status.value if isinstance(row.status, HostedCheckoutSessionStatusEnum) else str(row.status)
        counts[status] = counts.get(status, 0) + int(row.count or 0)
    return counts


def _coerce_invoice_status(status: InvoiceStatusEnum | str | None) -> str:
    if isinstance(status, InvoiceStatusEnum):
        return status.value
    if status is None:
        return "unknown"
    return str(status)


def _safe_ratio(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator, 4)

"""Endpoints for trust experience intelligence."""

from __future__ import annotations

from datetime import datetime, timezone

from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.services.fulfillment import FulfillmentMetricsService
from smplat_api.services.fulfillment.metrics import MetricRequest, ResolvedMetric


router = APIRouter(prefix="/trust", tags=["Trust"])


class TrustMetricRequest(BaseModel):
    """Metric resolution request payload."""

    metric_id: str = Field(..., description="Metric identifier (e.g. fulfillment_sla_on_time_pct)")
    freshness_window_minutes: int | None = Field(
        default=None,
        ge=5,
        le=60 * 24 * 14,
        description="Optional freshness window override in minutes.",
    )


class TrustExperienceResolveRequest(BaseModel):
    """Request trust metric enrichment for a CMS experience."""

    slug: str = Field(..., description="Experience slug (e.g. checkout)")
    metrics: list[TrustMetricRequest] = Field(default_factory=list)


class TrustMetricProvenance(BaseModel):
    """Traceability context for a trust metric."""

    source: str | None = Field(default=None, description="Upstream data source for the metric")
    cache_layer: str = Field(
        ..., description="Layer that fulfilled the request (memory|persistent|computed|none|unknown)"
    )
    cache_refreshed_at: datetime | None = Field(
        default=None, description="Timestamp when the cache layer refreshed the snapshot"
    )
    cache_expires_at: datetime | None = Field(
        default=None, description="Timestamp when the cached snapshot will expire"
    )
    cache_ttl_minutes: int | None = Field(
        default=None, description="Cache TTL in minutes for the persistent layer"
    )
    notes: list[str] = Field(default_factory=list, description="Human-readable provenance notes")
    unsupported_reason: str | None = Field(
        default=None, description="Diagnostic code if the metric is unsupported"
    )


class TrustMetricResponse(BaseModel):
    """Resolved metric payload."""

    metric_id: str = Field(..., description="Metric identifier")
    value: float | None = Field(default=None, description="Raw metric value")
    formatted_value: str | None = Field(default=None, description="Human readable value")
    computed_at: datetime | None = Field(default=None, description="Computation timestamp")
    sample_size: int = Field(default=0, ge=0, description="Sample size used to compute the metric")
    freshness_window_minutes: int | None = Field(
        default=None,
        description="Freshness window applied to determine verification state.",
    )
    verification_state: str = Field(..., description="Freshness evaluation (fresh|stale|missing|unsupported)")
    metadata: dict[str, object] = Field(default_factory=dict, description="Additional provenance metadata")
    provenance: TrustMetricProvenance = Field(
        ..., description="Provenance metadata including cache layer diagnostics"
    )
    percentile_bands: dict[str, float | None] | None = Field(
        default=None,
        description="Percentile bands (e.g. p50, p90) exposed when metrics carry distribution data.",
    )
    freshness_minutes_elapsed: float | None = Field(
        default=None,
        description="Computed freshness age in minutes since the snapshot was generated.",
    )
    unsupported_guard: str | None = Field(
        default=None,
        description="Guardrail reason when the metric is partially or fully unsupported.",
    )
    forecast: TrustMetricForecast | None = Field(
        default=None,
        description="Structured forecast payload for metrics that project future outcomes.",
    )


class TrustMetricForecastWindow(BaseModel):
    """Capacity-aware forecast window for a SKU."""

    start: datetime = Field(..., description="Window start timestamp")
    end: datetime = Field(..., description="Window end timestamp")
    hourly_capacity: int = Field(..., description="Configured hourly task capacity")
    capacity_tasks: int = Field(..., description="Total tasks that can be cleared in the window")
    backlog_at_start: int = Field(..., description="Backlog depth entering the window")
    projected_tasks_completed: int = Field(..., description="Projected tasks completed within the window")
    backlog_after: int = Field(..., description="Remaining backlog after applying window capacity")


class TrustMetricSkuForecast(BaseModel):
    """Per-SKU forecast rollup."""

    sku: str = Field(..., description="Normalized SKU or slug identifier")
    backlog_tasks: int = Field(..., description="Queued fulfillment tasks awaiting completion")
    completed_sample_size: int = Field(..., description="Historical completions sampled for the forecast")
    average_minutes: float | None = Field(
        default=None, description="Average minutes per task derived from history"
    )
    percentile_bands: dict[str, float | None] = Field(
        default_factory=dict,
        description="Percentile minutes per task derived from history",
    )
    windows: list[TrustMetricForecastWindow] = Field(
        default_factory=list,
        description="Capacity windows used to project backlog clearance",
    )
    estimated_clear_minutes: float | None = Field(
        default=None, description="Minutes until backlog clears based on staffing"
    )
    unsupported_reason: str | None = Field(
        default=None,
        description="Reason why the SKU forecast is partially unsupported (if applicable)",
    )


class TrustMetricForecast(BaseModel):
    """Aggregate forecast payload for trust metrics."""

    generated_at: datetime = Field(..., description="Timestamp when forecast was generated")
    horizon_hours: int = Field(..., description="Forecast planning horizon in hours")
    skus: list[TrustMetricSkuForecast] = Field(
        default_factory=list,
        description="Per-SKU forecast breakdowns",
    )


class TrustExperienceResolveResponse(BaseModel):
    """Response envelope for experience metrics."""

    slug: str
    metrics: list[TrustMetricResponse]


def _derive_unsupported_guard(metric: ResolvedMetric) -> str | None:
    """Surface a consolidated unsupported guard for storefront consumers."""

    guard = metric.provenance.unsupported_reason
    if guard:
        return guard

    metadata = metric.metadata if isinstance(metric.metadata, dict) else None
    if not metadata:
        return None

    sku_breakdown = metadata.get("sku_breakdown")
    if isinstance(sku_breakdown, dict) and sku_breakdown:
        unsupported_codes = [
            details.get("unsupported_reason")
            for details in sku_breakdown.values()
            if isinstance(details, dict) and details.get("unsupported_reason")
        ]
        if unsupported_codes and len(unsupported_codes) == len(sku_breakdown):
            return "all_skus_unsupported"
        if unsupported_codes:
            return "partial_sku_support"

    return None


class TrustMetricPurgeRequest(BaseModel):
    """Payload to purge metric cache entries."""

    metric_id: str | None = Field(
        default=None,
        description="Optional metric identifier to purge. When omitted, clears all metrics.",
    )


class TrustMetricPurgeResponse(BaseModel):
    """Response for cache purge operations."""

    purged_metric_ids: list[str] = Field(
        default_factory=list,
        description="Identifiers of metrics that were invalidated.",
    )


@router.post(
    "/experiences",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_checkout_api_key)],
    response_model=TrustExperienceResolveResponse,
    summary="Resolve trust experience metrics",
)
async def resolve_trust_experience(
    payload: TrustExperienceResolveRequest,
    db: AsyncSession = Depends(get_session),
) -> TrustExperienceResolveResponse:
    """Resolve requested metrics so the storefront can render verified trust modules."""

    service = FulfillmentMetricsService(db)
    metric_requests = [
        MetricRequest(metric_id=item.metric_id, freshness_window_minutes=item.freshness_window_minutes)
        for item in payload.metrics
    ]
    resolved = await service.resolve_metrics(metric_requests)

    now = datetime.now(timezone.utc)

    return TrustExperienceResolveResponse(
        slug=payload.slug,
        metrics=[
            TrustMetricResponse(
                metric_id=item.metric_id,
                value=item.value,
                formatted_value=item.formatted_value,
                computed_at=item.computed_at,
                sample_size=item.sample_size,
                freshness_window_minutes=item.freshness_window_minutes,
                verification_state=item.verification_state,
                metadata=item.metadata,
                provenance=TrustMetricProvenance(**item.provenance.as_dict()),
                percentile_bands=(
                    item.metadata.get("overall_percentile_bands")
                    if isinstance(item.metadata, dict)
                    else None
                ),
                freshness_minutes_elapsed=(
                    max((now - item.computed_at).total_seconds() / 60, 0)
                    if item.computed_at
                    else None
                ),
                unsupported_guard=_derive_unsupported_guard(item),
                forecast=(TrustMetricForecast(**item.forecast) if item.forecast else None),
            )
            for item in resolved
        ],
    )


@router.post(
    "/metrics/purge",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_checkout_api_key)],
    response_model=TrustMetricPurgeResponse,
    summary="Purge fulfillment metric cache entries",
)
async def purge_metric_cache(
    payload: TrustMetricPurgeRequest,
    db: AsyncSession = Depends(get_session),
) -> TrustMetricPurgeResponse:
    """Allow operators to invalidate cached metric snapshots when backfills occur."""

    service = FulfillmentMetricsService(db)
    purged = await service.purge_cache(metric_id=payload.metric_id)

    return TrustMetricPurgeResponse(purged_metric_ids=purged)


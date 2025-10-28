"""Endpoints for trust experience intelligence."""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.services.fulfillment import FulfillmentMetricsService
from smplat_api.services.fulfillment.metrics import MetricRequest


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


class TrustExperienceResolveResponse(BaseModel):
    """Response envelope for experience metrics."""

    slug: str
    metrics: list[TrustMetricResponse]


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
            )
            for item in resolved
        ],
    )


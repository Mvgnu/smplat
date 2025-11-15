"""Pricing experiment management endpoints."""

from __future__ import annotations

from datetime import date
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.pricing_experiments import PricingExperimentStatus
from smplat_api.services.catalog.pricing import (
    PricingExperimentService,
    PricingExperimentSnapshot,
    PricingVariantSnapshot,
    PricingMetricSnapshot,
    PricingAdjustmentKind,
)


router = APIRouter(prefix="/catalog/pricing-experiments", tags=["Catalog"])


class PricingVariantPayload(BaseModel):
    """Input payload describing a pricing variant."""

    key: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    weight: int = Field(default=0, ge=0, le=10_000)
    is_control: bool = Field(default=False)
    adjustment_kind: PricingAdjustmentKind = PricingAdjustmentKind.DELTA
    price_delta_cents: int = Field(default=0, ge=-10_000_000, le=10_000_000)
    price_multiplier: float | None = Field(default=None, ge=0.0)


class PricingExperimentCreateRequest(BaseModel):
    slug: str = Field(..., min_length=1, max_length=150)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1_000)
    target_product_slug: str = Field(..., min_length=1, max_length=150)
    target_segment: str | None = Field(default=None, max_length=120)
    feature_flag_key: str | None = Field(default=None, max_length=150)
    assignment_strategy: str = Field(..., min_length=1, max_length=120)
    variants: List[PricingVariantPayload] = Field(default_factory=list)


class PricingExperimentUpdateRequest(BaseModel):
    status: PricingExperimentStatus | None = None
    target_segment: str | None = Field(default=None, max_length=120)
    feature_flag_key: str | None = Field(default=None, max_length=150)
    assignment_strategy: str | None = Field(default=None, max_length=120)


class PricingMetricResponse(BaseModel):
    window_start: date
    exposures: int
    conversions: int
    revenue_cents: int


class PricingVariantResponse(BaseModel):
    key: str
    name: str
    description: str | None
    weight: int
    is_control: bool
    adjustment_kind: PricingAdjustmentKind
    price_delta_cents: int
    price_multiplier: float | None
    metrics: list[PricingMetricResponse] = Field(default_factory=list)


class PricingExperimentResponse(BaseModel):
    slug: str
    name: str
    description: str | None
    status: PricingExperimentStatus
    target_product_slug: str
    target_segment: str | None
    feature_flag_key: str | None
    assignment_strategy: str
    variants: list[PricingVariantResponse]
    provenance: dict[str, Any]


class PricingExperimentEventRequest(BaseModel):
    variant_key: str = Field(..., min_length=1, max_length=100)
    exposures: int = Field(default=0, ge=0)
    conversions: int = Field(default=0, ge=0)
    revenue_cents: int = Field(default=0, ge=0)
    window_start: date | None = None


def _serialize_metrics(metrics: list[PricingMetricSnapshot]) -> list[PricingMetricResponse]:
    return [
        PricingMetricResponse(
            window_start=metric.window_start,
            exposures=metric.exposures,
            conversions=metric.conversions,
            revenue_cents=metric.revenue_cents,
        )
        for metric in metrics
    ]


def _serialize_variant(variant: PricingVariantSnapshot) -> PricingVariantResponse:
    return PricingVariantResponse(
        key=variant.key,
        name=variant.name,
        description=variant.description,
        weight=variant.weight,
        is_control=variant.is_control,
        adjustment_kind=variant.adjustment_kind,
        price_delta_cents=variant.price_delta_cents,
        price_multiplier=variant.price_multiplier,
        metrics=_serialize_metrics(variant.metrics),
    )


def _serialize_experiment(snapshot: PricingExperimentSnapshot) -> PricingExperimentResponse:
    return PricingExperimentResponse(
        slug=snapshot.slug,
        name=snapshot.name,
        description=snapshot.description,
        status=snapshot.status,
        target_product_slug=snapshot.target_product_slug,
        target_segment=snapshot.target_segment,
        feature_flag_key=snapshot.feature_flag_key,
        assignment_strategy=snapshot.assignment_strategy,
        variants=[_serialize_variant(variant) for variant in snapshot.variants],
        provenance=snapshot.provenance,
    )


async def get_pricing_service(session: AsyncSession = Depends(get_session)) -> PricingExperimentService:
    return PricingExperimentService(session)


@router.get(
    "",
    response_model=list[PricingExperimentResponse],
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_pricing_experiments(
    service: PricingExperimentService = Depends(get_pricing_service),
) -> list[PricingExperimentResponse]:
    snapshots = await service.list_experiments()
    return [_serialize_experiment(snapshot) for snapshot in snapshots]


@router.post(
    "",
    response_model=PricingExperimentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_pricing_experiment(
    payload: PricingExperimentCreateRequest,
    service: PricingExperimentService = Depends(get_pricing_service),
) -> PricingExperimentResponse:
    try:
        snapshot = await service.create_experiment(
            slug=payload.slug,
            name=payload.name,
            description=payload.description,
            target_product_slug=payload.target_product_slug,
            target_segment=payload.target_segment,
            feature_flag_key=payload.feature_flag_key,
            assignment_strategy=payload.assignment_strategy,
            variants=[variant.model_dump() for variant in payload.variants],
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)


@router.put(
    "/{slug}",
    response_model=PricingExperimentResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def update_pricing_experiment(
    slug: str,
    payload: PricingExperimentUpdateRequest,
    service: PricingExperimentService = Depends(get_pricing_service),
) -> PricingExperimentResponse:
    try:
        snapshot = await service.update_experiment(
            slug,
            status=payload.status,
            target_segment=payload.target_segment,
            feature_flag_key=payload.feature_flag_key,
            assignment_strategy=payload.assignment_strategy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)


@router.post(
    "/{slug}/events",
    response_model=PricingExperimentResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def record_pricing_event(
    slug: str,
    payload: PricingExperimentEventRequest,
    service: PricingExperimentService = Depends(get_pricing_service),
) -> PricingExperimentResponse:
    try:
        snapshot = await service.record_event(
            slug,
            payload.variant_key,
            exposures=payload.exposures,
            conversions=payload.conversions,
            revenue_cents=payload.revenue_cents,
            window_start=payload.window_start,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)

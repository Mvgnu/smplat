"""Catalog bundle recommendation endpoints."""

# meta: rate-limit: slug-window

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.services.catalog.recommendations import CatalogRecommendationService


router = APIRouter(prefix="/catalog/recommendations", tags=["Catalog"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CatalogRecommendationRequest(BaseModel):
    """Request payload for catalog bundle recommendations."""

    product_slug: str = Field(..., min_length=1, max_length=150)
    freshness_minutes: int | None = Field(
        default=None,
        ge=5,
        le=60 * 24,
        description="Optional cache freshness override in minutes.",
    )


class BundleRecommendationMetrics(BaseModel):
    """Recommendation scoring metadata."""

    score: float
    acceptance_rate: float | None
    acceptance_count: int
    queue_depth: int
    lookback_days: int | None
    cms_priority: int
    notes: list[str] = Field(default_factory=list)


class BundleRecommendationProvenance(BaseModel):
    """Provenance metadata for storefront consumers."""

    source: str | None = None
    cache_layer: str
    cache_refreshed_at: datetime
    cache_expires_at: datetime
    cache_ttl_minutes: int
    notes: list[str] = Field(default_factory=list)


class BundleRecommendationResponse(BaseModel):
    """Single bundle recommendation payload."""

    slug: str
    title: str
    description: str | None = None
    savings_copy: str | None = None
    components: list[str] = Field(default_factory=list)
    metrics: BundleRecommendationMetrics
    provenance: BundleRecommendationProvenance


class CatalogRecommendationResponse(BaseModel):
    """Envelope for recommendation responses."""

    product_slug: str
    resolved_at: datetime
    freshness_minutes: int | None
    cache_layer: str
    fallback_copy: str | None = None
    recommendations: list[BundleRecommendationResponse]


_RATE_LIMIT_WINDOW = timedelta(seconds=5)
_RATE_LIMIT_MAX_CALLS = 8
_RATE_LIMIT_STATE: dict[str, list[datetime]] = {}
_RATE_LIMIT_LOCK = asyncio.Lock()


async def _enforce_rate_limit(key: str) -> None:
    now = _utcnow()
    async with _RATE_LIMIT_LOCK:
        entries = _RATE_LIMIT_STATE.setdefault(key, [])
        entries = [timestamp for timestamp in entries if now - timestamp < _RATE_LIMIT_WINDOW]
        if len(entries) >= _RATE_LIMIT_MAX_CALLS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many recommendation requests",
            )
        entries.append(now)
        _RATE_LIMIT_STATE[key] = entries


async def get_recommendation_service(
    session: AsyncSession = Depends(get_session),
) -> CatalogRecommendationService:
    return CatalogRecommendationService(session)


@router.post(
    "",
    status_code=status.HTTP_200_OK,
    response_model=CatalogRecommendationResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def resolve_catalog_recommendations(
    payload: CatalogRecommendationRequest,
    service: CatalogRecommendationService = Depends(get_recommendation_service),
) -> CatalogRecommendationResponse:
    """Resolve catalog bundle recommendations."""

    await _enforce_rate_limit(payload.product_slug)
    snapshot = await service.resolve(payload.product_slug, payload.freshness_minutes)

    metadata = snapshot.metadata or {}
    ttl_minutes = metadata.get("ttl_minutes")
    if isinstance(ttl_minutes, str) and ttl_minutes.isdigit():
        ttl_minutes = int(ttl_minutes)
    if not isinstance(ttl_minutes, int):
        ttl_minutes = payload.freshness_minutes

    notes: list[str] = []
    if isinstance(metadata.get("notes"), list):
        notes = [str(note) for note in metadata["notes"]]

    recommendations: list[BundleRecommendationResponse] = []
    for bundle in snapshot.recommendations:
        heuristics = bundle.heuristics
        recommendations.append(
            BundleRecommendationResponse(
                slug=bundle.slug,
                title=bundle.title,
                description=bundle.description,
                savings_copy=bundle.savings_copy,
                components=bundle.components,
                metrics=BundleRecommendationMetrics(
                    score=bundle.score,
                    acceptance_rate=heuristics.acceptance_rate,
                    acceptance_count=heuristics.acceptance_count,
                    queue_depth=heuristics.queue_depth,
                    lookback_days=heuristics.lookback_days,
                    cms_priority=heuristics.cms_priority,
                    notes=heuristics.notes,
                ),
                provenance=BundleRecommendationProvenance(
                    source=metadata.get("source"),
                    cache_layer=snapshot.cache_layer,
                    cache_refreshed_at=snapshot.computed_at,
                    cache_expires_at=snapshot.expires_at,
                    cache_ttl_minutes=ttl_minutes or payload.freshness_minutes or 10,
                    notes=notes,
                ),
            )
        )

    fallback_copy = None
    if not recommendations:
        fallback_copy = "Dynamic merchandising signals are calibrating – showing fallback bundles."

    return CatalogRecommendationResponse(
        product_slug=payload.product_slug,
        resolved_at=snapshot.computed_at,
        freshness_minutes=payload.freshness_minutes,
        cache_layer=snapshot.cache_layer,
        fallback_copy=fallback_copy,
        recommendations=recommendations,
    )

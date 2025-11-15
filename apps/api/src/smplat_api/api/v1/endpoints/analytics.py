"""Analytics endpoints for storefront offer tracking."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.analytics import CheckoutOfferEvent
from smplat_api.services.analytics.preset_events import (
    PRESET_EVENT_TYPES,
    PresetEventAnalyticsService,
)

router = APIRouter(
    prefix="/analytics",
    tags=["Analytics"],
    dependencies=[Depends(require_checkout_api_key)],
)


class CheckoutOfferEventPayload(BaseModel):
    """Incoming analytics payload for checkout offer interactions."""

    offer_slug: str = Field(..., min_length=1, max_length=255)
    event_type: str = Field(..., min_length=1, max_length=64)
    target_slug: str | None = Field(default=None, min_length=1, max_length=255)
    action: str | None = Field(default=None, min_length=1, max_length=64)
    cart_total: Decimal | None = Field(default=None, ge=Decimal("0"))
    currency: str | None = Field(default=None, min_length=3, max_length=16)
    order_reference: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] | None = Field(default=None)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized.upper() if normalized else None

    @field_validator("cart_total")
    @classmethod
    def quantize_cart_total(cls, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None

        normalized = value.quantize(Decimal("0.01"))
        if normalized < Decimal("0.00"):
            raise ValueError("cart_total must be non-negative")
        return normalized


class CheckoutOfferEventResponse(BaseModel):
    """Response envelope for recorded offer events."""

    id: UUID
    status: str = Field(default="accepted")
    created_at: str

    model_config = ConfigDict(from_attributes=True)


@router.post(
    "/offer-events",
    response_model=CheckoutOfferEventResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Record a checkout offer analytics event",
)
async def record_checkout_offer_event(
    payload: CheckoutOfferEventPayload,
    session: AsyncSession = Depends(get_session),
) -> CheckoutOfferEventResponse:
    """Persist checkout offer analytics to the primary data store."""

    event = CheckoutOfferEvent(
        offer_slug=payload.offer_slug,
        target_slug=payload.target_slug,
        event_type=payload.event_type,
        action=payload.action,
        cart_total=payload.cart_total,
        currency=payload.currency,
        order_reference=payload.order_reference,
        metadata_json=payload.metadata,
    )

    session.add(event)
    await session.commit()
    await session.refresh(event)

    return CheckoutOfferEventResponse(
        id=event.id,
        status="accepted",
        created_at=event.created_at.isoformat(),
    )


class PresetEventTotals(BaseModel):
    preset_cta_apply: int = 0
    preset_configurator_apply: int = 0
    preset_configurator_clear: int = 0


class PresetEventSourceSnapshot(BaseModel):
    eventType: str
    source: str
    count: int


class PresetEventTimelineCounts(BaseModel):
    presetCtaApply: int
    presetConfiguratorApply: int
    presetConfiguratorClear: int


class PresetEventTimelineTotals(BaseModel):
    applies: int
    clears: int
    total: int
    net: int
    clearRate: float


class PresetEventTrendStats(BaseModel):
    applyAvg7: float | None = None
    applyAvg30: float | None = None
    netAvg7: float | None = None
    clearRate7: float | None = None
    totalAvg30: float | None = None
    totalMin30: int | None = None
    totalMax30: int | None = None


class PresetEventTimelineEntry(BaseModel):
    date: str
    counts: PresetEventTimelineCounts
    totals: PresetEventTimelineTotals
    trend: PresetEventTrendStats | None = None


class PresetEventAnalyticsResponse(BaseModel):
    window: Dict[str, Any]
    totals: PresetEventTotals
    sources: List[PresetEventSourceSnapshot]
    timeline: List[PresetEventTimelineEntry]
    breakdowns: PresetAnalyticsBreakdowns | None = None
    alerts: List[Dict[str, Any]] = Field(default_factory=list)


@router.get(
    "/preset-events",
    response_model=PresetEventAnalyticsResponse,
    summary="Summarize preset interaction analytics",
)
async def get_preset_event_analytics(
    window_days: int = Query(30, ge=1, le=90, description="Lookback window in days"),
    session: AsyncSession = Depends(get_session),
):
    service = PresetEventAnalyticsService(session)
    data = await service.fetch_summary(window_days=window_days)
    # Ensure totals include every expected event key for response validation
    totals: Dict[str, int] = data.get("totals", {})
    normalized_totals = {event: totals.get(event, 0) for event in PRESET_EVENT_TYPES}
    data["totals"] = normalized_totals
    return data
class PresetBreakdownWindowStats(BaseModel):
    applies: int
    clears: int
    net: int
    clearRate: float


class PresetBreakdownEntry(BaseModel):
    presetId: str
    presetLabel: str | None = None
    cta: int
    configurator: int
    clears: int
    applies: int
    net: int
    clearRate: float
    isRisky: bool | None = None
    riskReason: str | None = None
    windows: Dict[str, PresetBreakdownWindowStats] | None = None


class PresetSourceBreakdownEntry(BaseModel):
    source: str
    cta: int
    configurator: int
    clears: int
    applies: int
    net: int
    clearRate: float
    windows: Dict[str, PresetBreakdownWindowStats] | None = None


class PresetAnalyticsBreakdowns(BaseModel):
    presets: List[PresetBreakdownEntry] = Field(default_factory=list)
    sources: List[PresetSourceBreakdownEntry] = Field(default_factory=list)
    riskyPresets: List[PresetBreakdownEntry] = Field(default_factory=list)

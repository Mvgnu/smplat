from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.provider_guardrail_followup import ProviderGuardrailFollowUp
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.schemas.fulfillment_provider import ProviderAutomationTelemetry as ProviderAutomationTelemetryPayload
from smplat_api.services.analytics.experiment_analytics import (
    ExperimentAnalyticsService,
    ExperimentConversionDigest,
)
from smplat_api.services.orders.onboarding import OnboardingService
from smplat_api.services.reporting import BlueprintMetricsService
from smplat_api.services.reporting.guardrail_followups import GuardrailFollowUpService
from smplat_api.services.reporting.guardrail_followup_notifier import GuardrailFollowUpNotifier
from smplat_api.services.provider_telemetry import (
    load_provider_telemetry_summary,
    serialize_provider_automation_telemetry,
)

router = APIRouter(
    prefix="/reporting",
    tags=["Reporting"],
    dependencies=[Depends(require_checkout_api_key)],
)


class PricingExperimentEventPayload(BaseModel):
    """Serialized pricing experiment event suitable for exports."""

    event_id: UUID = Field(..., alias="eventId")
    journey_id: UUID = Field(..., alias="journeyId")
    order_id: UUID = Field(..., alias="orderId")
    order_number: str | None = Field(None, alias="orderNumber")
    slug: str
    variant_key: str = Field(..., alias="variantKey")
    variant_name: str | None = Field(None, alias="variantName")
    is_control: bool | None = Field(None, alias="isControl")
    assignment_strategy: str | None = Field(None, alias="assignmentStrategy")
    status: str | None = None
    feature_flag_key: str | None = Field(None, alias="featureFlagKey")
    recorded_at: datetime = Field(..., alias="recordedAt")
    order_total: float | None = Field(default=None, alias="orderTotal")
    order_currency: str | None = Field(default=None, alias="orderCurrency")
    loyalty_projection_points: int | None = Field(
        default=None,
        alias="loyaltyProjectionPoints",
    )


class PricingExperimentEventResponse(BaseModel):
    """Envelope returned by the onboarding experiment export endpoint."""

    events: list[PricingExperimentEventPayload]
    next_cursor: datetime | None = Field(None, alias="nextCursor")


class ExperimentConversionMetricPayload(BaseModel):
    slug: str
    order_count: int = Field(..., alias="orderCount")
    journey_count: int = Field(..., alias="journeyCount")
    order_total: float = Field(..., alias="orderTotal")
    order_currency: str | None = Field(default=None, alias="orderCurrency")
    loyalty_points: int = Field(..., alias="loyaltyPoints")
    last_activity: datetime | None = Field(default=None, alias="lastActivity")


class ExperimentConversionSnapshotResponse(BaseModel):
    metrics: list[ExperimentConversionMetricPayload]
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    cursor: str | None = None


class GuardrailPlatformContextPayload(BaseModel):
    id: str
    label: str
    handle: str | None = None
    platform_type: str | None = Field(default=None, alias="platformType")


class GuardrailAttachmentPayload(BaseModel):
    id: str
    file_name: str = Field(..., alias="fileName")
    asset_url: str = Field(..., alias="assetUrl")
    storage_key: str = Field(..., alias="storageKey")
    size: int | None = None
    content_type: str | None = Field(default=None, alias="contentType")
    uploaded_at: datetime | None = Field(default=None, alias="uploadedAt")


class GuardrailFollowUpRequest(BaseModel):
    provider_id: str = Field(..., alias="providerId")
    provider_name: str | None = Field(default=None, alias="providerName")
    action: str = Field(..., min_length=1, max_length=64)
    notes: str | None = Field(default=None, max_length=500)
    platform_context: GuardrailPlatformContextPayload | None = Field(
        default=None,
        alias="platformContext",
    )
    conversion_cursor: str | None = Field(default=None, alias="conversionCursor")
    conversion_href: str | None = Field(default=None, alias="conversionHref")
    attachments: list[GuardrailAttachmentPayload] | None = None


class GuardrailFollowUpResponse(BaseModel):
    id: UUID
    provider_id: str = Field(alias="providerId")
    provider_name: str | None = Field(default=None, alias="providerName")
    action: str
    notes: str | None
    platform_context: GuardrailPlatformContextPayload | None = Field(
        default=None,
        alias="platformContext",
    )
    attachments: list[GuardrailAttachmentPayload] | None = None
    created_at: datetime = Field(alias="createdAt")
    conversion_cursor: str | None = Field(default=None, alias="conversionCursor")
    conversion_href: str | None = Field(default=None, alias="conversionHref")


class GuardrailFollowUpStatusResponse(BaseModel):
    provider_id: str = Field(..., alias="providerId")
    provider_name: str | None = Field(default=None, alias="providerName")
    is_paused: bool = Field(..., alias="isPaused")
    last_action: str | None = Field(default=None, alias="lastAction")
    updated_at: datetime = Field(..., alias="updatedAt")
    last_follow_up_id: UUID | None = Field(default=None, alias="lastFollowUpId")


class GuardrailFollowUpSubmissionResponse(BaseModel):
    entry: GuardrailFollowUpResponse
    status: GuardrailFollowUpStatusResponse | None = None
    provider_telemetry: ProviderAutomationTelemetryPayload | None = Field(
        default=None,
        alias="providerTelemetry",
    )


class GuardrailFollowUpListResponse(BaseModel):
    entries: list[GuardrailFollowUpResponse]
    next_cursor: datetime | None = Field(default=None, alias="nextCursor")
    status: GuardrailFollowUpStatusResponse | None = None
    provider_telemetry: ProviderAutomationTelemetryPayload | None = Field(
        default=None,
        alias="providerTelemetry",
    )


@router.get(
    "/blueprint-metrics",
    summary="Blueprint adoption and provider engagement metrics",
)
async def get_blueprint_metrics(
    window_days: int = Query(30, ge=1, le=365, description="Lookback window in days"),
    option_limit: int = Query(50, ge=1, le=250),
    add_on_limit: int = Query(50, ge=1, le=250),
    provider_limit: int = Query(50, ge=1, le=250),
    preset_limit: int = Query(50, ge=1, le=250),
    session=Depends(get_session),
):
    service = BlueprintMetricsService(session)
    return await service.fetch_metrics(
        window_days=window_days,
        option_limit=option_limit,
        add_on_limit=add_on_limit,
        provider_limit=provider_limit,
        preset_limit=preset_limit,
    )


@router.get(
    "/onboarding/experiment-events",
    response_model=PricingExperimentEventResponse,
    summary="Pricing experiment events attributed to onboarding journeys",
)
async def export_onboarding_pricing_experiments(
    limit: int = Query(250, ge=1, le=1000, description="Maximum number of rows to return"),
    cursor: datetime | None = Query(
        default=None,
        description="Return entries recorded before this timestamp (use nextCursor for pagination)",
    ),
    session=Depends(get_session),
) -> PricingExperimentEventResponse:
    service = OnboardingService(session)
    rows = await service.export_pricing_experiment_events(limit=limit + 1, cursor=cursor)
    has_more = len(rows) > limit
    trimmed = rows[:limit]
    next_cursor = trimmed[-1].recorded_at if has_more and trimmed else None

    return PricingExperimentEventResponse(
        events=[
            PricingExperimentEventPayload(
                eventId=row.event_id,
                journeyId=row.journey_id,
                orderId=row.order_id,
                orderNumber=row.order_number,
                slug=row.slug,
                variantKey=row.variant_key,
                variantName=row.variant_name,
                isControl=row.is_control,
                assignmentStrategy=row.assignment_strategy,
                status=row.status,
                featureFlagKey=row.feature_flag_key,
                recordedAt=row.recorded_at,
                orderTotal=_decimal_to_float(row.order_total),
                orderCurrency=row.order_currency,
                loyaltyProjectionPoints=row.loyalty_projection_points,
            )
            for row in trimmed
        ],
        nextCursor=next_cursor,
    )


@router.get(
    "/onboarding/experiment-conversions",
    response_model=ExperimentConversionSnapshotResponse,
    summary="Aggregated conversion metrics for onboarding experiments",
)
async def list_experiment_conversion_metrics(
    limit: int = Query(25, ge=1, le=100, description="Maximum number of rows to return"),
    cursor: str | None = Query(
        default=None,
        description="Resume pagination after the provided slug",
    ),
    session=Depends(get_session),
) -> ExperimentConversionSnapshotResponse:
    service = ExperimentAnalyticsService(session)
    snapshot = await service.fetch_conversion_snapshot(limit=limit, cursor=cursor)
    return ExperimentConversionSnapshotResponse(
        metrics=[_serialize_conversion_metric(metric) for metric in snapshot.metrics],
        nextCursor=snapshot.next_cursor,
        cursor=snapshot.cursor,
    )


@router.post(
    "/guardrails/followups",
    response_model=GuardrailFollowUpSubmissionResponse,
    response_model_exclude_none=False,
    summary="Record a guardrail follow-up entry",
    status_code=201,
)
async def record_guardrail_follow_up(
    payload: GuardrailFollowUpRequest,
    session=Depends(get_session),
) -> GuardrailFollowUpSubmissionResponse:
    service = GuardrailFollowUpService(session)
    entry, status = await service.record_follow_up(
        provider_id=payload.provider_id,
        provider_name=payload.provider_name,
        action=payload.action,
        notes=payload.notes,
        platform_context=payload.platform_context.model_dump(by_alias=True)
        if payload.platform_context
        else None,
        conversion_cursor=payload.conversion_cursor,
        conversion_href=payload.conversion_href,
        attachments=(
            [attachment.model_dump(by_alias=True) for attachment in payload.attachments]
            if payload.attachments
            else None
        ),
    )
    telemetry_summary = await load_provider_telemetry_summary(session, payload.provider_id)
    telemetry_data = serialize_provider_automation_telemetry(telemetry_summary)
    telemetry_payload = (
        ProviderAutomationTelemetryPayload.model_validate(telemetry_data) if telemetry_data else None
    )
    notifier = GuardrailFollowUpNotifier()
    await notifier.notify(
        entry=entry,
        status=status,
        conversion_cursor=payload.conversion_cursor,
        conversion_href=payload.conversion_href,
        telemetry_summary=telemetry_summary,
    )
    return GuardrailFollowUpSubmissionResponse(
        entry=build_guardrail_follow_up_payload(entry),
        status=build_guardrail_follow_up_status_payload(status),
        providerTelemetry=telemetry_payload,
    )


@router.get(
    "/guardrails/followups",
    response_model=GuardrailFollowUpListResponse,
    response_model_exclude_none=False,
    summary="List guardrail follow-up entries",
)
async def list_guardrail_follow_ups(
    provider_id: str = Query(..., alias="providerId", description="Provider identifier"),
    limit: int = Query(
        15,
        ge=1,
        le=100,
        description="Maximum number of follow-up entries to return",
    ),
    cursor: datetime | None = Query(
        default=None,
        description="Return entries created before this timestamp (use nextCursor for pagination)",
    ),
    session=Depends(get_session),
) -> GuardrailFollowUpListResponse:
    service = GuardrailFollowUpService(session)
    rows, status = await service.list_follow_ups(provider_id=provider_id, limit=limit + 1, cursor=cursor)
    has_more = len(rows) > limit
    trimmed = rows[:limit]
    next_cursor = trimmed[-1].created_at if has_more and trimmed else None
    telemetry_summary = await load_provider_telemetry_summary(session, provider_id)
    telemetry_data = serialize_provider_automation_telemetry(telemetry_summary)
    telemetry_payload = (
        ProviderAutomationTelemetryPayload.model_validate(telemetry_data) if telemetry_data else None
    )
    return GuardrailFollowUpListResponse(
        entries=[build_guardrail_follow_up_payload(entry) for entry in trimmed],
        nextCursor=next_cursor,
        status=build_guardrail_follow_up_status_payload(status),
        providerTelemetry=telemetry_payload,
    )


def build_guardrail_follow_up_payload(entry: ProviderGuardrailFollowUp) -> GuardrailFollowUpResponse:
    platform_context = (
        GuardrailPlatformContextPayload.model_validate(entry.platform_context)
        if entry.platform_context
        else None
    )
    attachments = None
    if entry.attachments:
        attachments = [
            GuardrailAttachmentPayload.model_validate(attachment)
            for attachment in entry.attachments
            if isinstance(attachment, dict)
        ]
    return GuardrailFollowUpResponse(
        id=entry.id,
        providerId=entry.provider_id,
        providerName=entry.provider_name,
        action=entry.action,
        notes=entry.notes,
        platformContext=platform_context,
        attachments=attachments,
        createdAt=entry.created_at,
        conversionCursor=entry.conversion_cursor,
        conversionHref=entry.conversion_href,
    )


def build_guardrail_follow_up_status_payload(
    status: ProviderGuardrailStatus | None,
) -> GuardrailFollowUpStatusResponse | None:
    if status is None:
        return None
    return GuardrailFollowUpStatusResponse(
        providerId=status.provider_id,
        providerName=status.provider_name,
        isPaused=status.is_paused,
        lastAction=status.last_action,
        updatedAt=status.updated_at,
        lastFollowUpId=status.last_follow_up_id,
    )


def _decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _serialize_conversion_metric(metric: ExperimentConversionDigest) -> ExperimentConversionMetricPayload:
    return ExperimentConversionMetricPayload(
        slug=metric.slug,
        orderCount=metric.order_count,
        journeyCount=metric.journey_count,
        orderTotal=metric.order_total,
        orderCurrency=metric.order_currency,
        loyaltyPoints=metric.loyalty_points,
        lastActivity=metric.last_activity,
    )

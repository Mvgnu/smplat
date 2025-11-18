"""Onboarding journey API endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.onboarding import OnboardingActorType, OnboardingTaskStatus
from smplat_api.services.orders import OnboardingService

router = APIRouter(prefix="/orders/{order_id}/onboarding", tags=["onboarding"])


class OnboardingTaskPayload(BaseModel):
    """Serialized onboarding task for client consumption."""

    id: UUID
    slug: str
    title: str
    description: str | None
    status: OnboardingTaskStatus
    sort_order: int
    due_at: datetime | None
    completed_at: datetime | None


class OnboardingJourneyPayload(BaseModel):
    """Serialized onboarding journey with tasks."""

    id: UUID
    order_id: UUID
    status: str
    progress_percentage: float
    referral_code: str | None
    started_at: datetime | None
    completed_at: datetime | None
    tasks: list[OnboardingTaskPayload]


class TaskToggleRequest(BaseModel):
    """Request payload for toggling onboarding tasks."""

    completed: bool = Field(..., description="Whether the task should be marked complete")
    actor: OnboardingActorType = Field(
        default=OnboardingActorType.CLIENT,
        description="Actor performing the change",
    )


class PlatformContextPayload(BaseModel):
    """Normalized platform context snapshot from checkout."""

    id: str = Field(..., description="Storefront platform identifier or saved handle")
    label: str = Field(..., description="Display label shown during checkout/success flows")
    handle: str | None = Field(
        default=None,
        description="Optional user handle or URL used for routing automations",
    )
    platform_type: str | None = Field(
        default=None,
        alias="platformType",
        description="Platform classification (instagram, tiktok, etc.)",
    )

    model_config = ConfigDict(populate_by_name=True)


class JourneyIngestRequest(BaseModel):
    """Payload captured from checkout success to enrich journeys."""

    referralCode: str | None = Field(default=None, description="Referral code generated for client")
    offer: dict[str, Any] | None = Field(default=None, description="Offer metadata presented at checkout")
    addons: list[dict[str, Any]] | None = Field(default=None, description="Add-ons accepted during checkout")
    support: dict[str, Any] | None = Field(default=None, description="Support contact context")
    platformContexts: list[PlatformContextPayload] | None = Field(
        default=None,
        description="Platform contexts attached to the order’s line items",
    )

    model_config = ConfigDict(populate_by_name=True)


class ReferralRequest(BaseModel):
    """Referral copy telemetry payload."""

    referral_code: str = Field(..., description="Referral code surfaced to the user")


class PricingExperimentRecord(BaseModel):
    """Priced experiment segmentation payload."""

    slug: str = Field(..., description="Experiment slug")
    variant_key: str = Field(..., alias="variantKey", description="Assigned variant key")
    variant_name: str | None = Field(
        default=None,
        alias="variantName",
        description="Human-readable variant name",
    )
    is_control: bool | None = Field(
        default=None,
        alias="isControl",
        description="Whether the variant is a control arm",
    )
    assignment_strategy: str | None = Field(
        default=None,
        alias="assignmentStrategy",
        description="Assignment strategy used to pick variants",
    )
    status: str | None = Field(
        default=None,
        description="Experiment status when the assignment occurred",
    )
    feature_flag_key: str | None = Field(
        default=None,
        alias="featureFlagKey",
        description="Feature flag gating the storefront copy for this experiment",
    )

    model_config = ConfigDict(populate_by_name=True)


class PricingExperimentsRequest(BaseModel):
    """Batch of experiment segments to record."""

    experiments: list[PricingExperimentRecord] = Field(
        ...,
        min_length=1,
        description="Experiments assigned during checkout/success flows",
    )

    model_config = ConfigDict(populate_by_name=True)


@router.get(
    "",
    response_model=OnboardingJourneyPayload,
    dependencies=[Depends(require_checkout_api_key)],
)
async def fetch_onboarding_journey(
    order_id: UUID,
    db=Depends(get_session),
) -> OnboardingJourneyPayload:
    """Return onboarding journey details for the specified order."""

    service = OnboardingService(db)
    journey = await service.fetch_journey(order_id)
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    return OnboardingJourneyPayload(
        id=journey.id,
        order_id=journey.order_id,
        status=journey.status.value,
        progress_percentage=float(journey.progress_percentage or 0),
        referral_code=journey.referral_code,
        started_at=journey.started_at,
        completed_at=journey.completed_at,
        tasks=[
            OnboardingTaskPayload(
                id=task.id,
                slug=task.slug,
                title=task.title,
                description=task.description,
                status=task.status,
                sort_order=task.sort_order,
                due_at=task.due_at,
                completed_at=task.completed_at,
            )
            for task in sorted(journey.tasks, key=lambda candidate: candidate.sort_order)
        ],
    )


@router.post(
    "",
    response_model=OnboardingJourneyPayload,
    dependencies=[Depends(require_checkout_api_key)],
)
async def ingest_checkout_journey(
    order_id: UUID,
    payload: JourneyIngestRequest,
    db=Depends(get_session),
) -> OnboardingJourneyPayload:
    """Persist checkout payload and return enriched journey state."""

    service = OnboardingService(db)
    await service.ingest_success_payload(order_id, checkout_payload=payload.model_dump())
    await db.commit()
    return await fetch_onboarding_journey(order_id, db)


@router.patch(
    "/tasks/{task_id}",
    response_model=OnboardingTaskPayload,
    dependencies=[Depends(require_checkout_api_key)],
)
async def toggle_task(
    order_id: UUID,
    task_id: UUID,
    request: TaskToggleRequest,
    db=Depends(get_session),
) -> OnboardingTaskPayload:
    """Toggle task completion and emit analytics deltas."""

    service = OnboardingService(db)
    try:
        task = await service.toggle_task_completion(
            order_id,
            task_id,
            completed=request.completed,
            actor=request.actor,
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error

    await db.commit()
    return OnboardingTaskPayload(
        id=task.id,
        slug=task.slug,
        title=task.title,
        description=task.description,
        status=task.status,
        sort_order=task.sort_order,
        due_at=task.due_at,
        completed_at=task.completed_at,
    )


@router.post(
    "/referral",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def record_referral(
    order_id: UUID,
    request: ReferralRequest,
    db=Depends(get_session),
) -> dict[str, str]:
    """Record referral copy interactions for analytics."""

    service = OnboardingService(db)
    await service.record_referral_copy(order_id, referral_code=request.referral_code)
    await db.commit()
    return {"status": "accepted"}


@router.post(
    "/pricing-experiments",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def record_pricing_experiments(
    order_id: UUID,
    request: PricingExperimentsRequest,
    db=Depends(get_session),
) -> dict[str, str]:
    """Record pricing experiment segmentation details for analytics."""

    service = OnboardingService(db)
    await service.record_pricing_experiment_segment(
        order_id,
        experiments=[experiment.dict(by_alias=True) for experiment in request.experiments],
    )
    await db.commit()
    return {"status": "accepted"}

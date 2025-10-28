"""Operator-facing onboarding journey endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models import Order
from smplat_api.models.onboarding import (
    OnboardingActorType,
    OnboardingInteractionChannel,
    OnboardingJourneyStatus,
)
from smplat_api.services.notifications import NotificationService
from smplat_api.services.orders.onboarding import (
    OnboardingJourneyAggregates,
    OnboardingJourneyFilters,
    OnboardingJourneySummary,
    OnboardingNudgeOpportunity,
    OnboardingService,
)

router = APIRouter(prefix="/operators/onboarding", tags=["operator-onboarding"])


class OperatorJourneySummaryPayload(BaseModel):
    """Serialized summary for operator dashboards."""

    journey_id: UUID = Field(..., alias="journeyId")
    order_id: UUID = Field(..., alias="orderId")
    order_number: str | None = Field(None, alias="orderNumber")
    status: str
    risk_level: str = Field(..., alias="riskLevel")
    progress_percentage: float = Field(..., alias="progressPercentage")
    referral_code: str | None = Field(None, alias="referralCode")
    started_at: datetime | None = Field(None, alias="startedAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")
    last_interaction_at: datetime | None = Field(None, alias="lastInteractionAt")
    total_tasks: int = Field(..., alias="totalTasks")
    completed_tasks: int = Field(..., alias="completedTasks")
    overdue_tasks: int = Field(..., alias="overdueTasks")
    awaiting_artifacts: int = Field(..., alias="awaitingArtifacts")

    @classmethod
    def from_summary(cls, summary: OnboardingJourneySummary) -> "OperatorJourneySummaryPayload":
        return cls(
            journeyId=summary.journey_id,
            orderId=summary.order_id,
            orderNumber=summary.order_number,
            status=summary.status.value,
            riskLevel=summary.risk_level,
            progressPercentage=summary.progress_percentage,
            referralCode=summary.referral_code,
            startedAt=summary.started_at,
            updatedAt=summary.updated_at,
            lastInteractionAt=summary.last_interaction_at,
            totalTasks=summary.total_tasks,
            completedTasks=summary.completed_tasks,
            overdueTasks=summary.overdue_tasks,
            awaitingArtifacts=summary.awaiting_artifacts,
        )


class OperatorJourneyAggregatesPayload(BaseModel):
    """Aggregated status counts for journeys."""

    total: int
    active: int
    stalled: int
    completed: int
    with_referrals: int = Field(..., alias="withReferrals")

    @classmethod
    def from_aggregates(
        cls, aggregates: OnboardingJourneyAggregates
    ) -> "OperatorJourneyAggregatesPayload":
        return cls(
            total=aggregates.total,
            active=aggregates.active,
            stalled=aggregates.stalled,
            completed=aggregates.completed,
            withReferrals=aggregates.with_referrals,
        )


class OperatorArtifactPayload(BaseModel):
    """Artifact metadata for operator consumption."""

    id: UUID
    label: str
    required: bool
    received_at: datetime | None = Field(None, alias="receivedAt")
    url: str | None


class OperatorTaskPayload(BaseModel):
    """Task payload enriched with operator metadata."""

    id: UUID
    slug: str
    title: str
    status: str
    due_at: datetime | None = Field(None, alias="dueAt")
    completed_at: datetime | None = Field(None, alias="completedAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class OperatorInteractionPayload(BaseModel):
    """Interaction log entry."""

    id: UUID
    actor: str
    channel: str
    summary: str | None
    details: str | None
    created_at: datetime = Field(..., alias="createdAt")
    metadata: dict[str, Any] | None


class OperatorNudgeOpportunityPayload(BaseModel):
    """Serializable nudge opportunity."""

    journey_id: UUID = Field(..., alias="journeyId")
    order_id: UUID = Field(..., alias="orderId")
    order_number: str | None = Field(None, alias="orderNumber")
    task_id: UUID | None = Field(None, alias="taskId")
    task_slug: str | None = Field(None, alias="taskSlug")
    reason: str
    dedupe_key: str = Field(..., alias="dedupeKey")
    idle_hours: int = Field(..., alias="idleHours")
    recommended_channel: str = Field(..., alias="recommendedChannel")
    sla_expires_at: datetime = Field(..., alias="slaExpiresAt")
    subject: str
    message: str

    @classmethod
    def from_opportunity(
        cls, opportunity: OnboardingNudgeOpportunity
    ) -> "OperatorNudgeOpportunityPayload":
        return cls(
            journeyId=opportunity.journey_id,
            orderId=opportunity.order_id,
            orderNumber=opportunity.order_number,
            taskId=opportunity.task_id,
            taskSlug=opportunity.task_slug,
            reason=opportunity.reason,
            dedupeKey=opportunity.dedupe_key,
            idleHours=opportunity.idle_hours,
            recommendedChannel=opportunity.recommended_channel.value,
            slaExpiresAt=opportunity.sla_expires_at,
            subject=opportunity.subject,
            message=opportunity.message,
        )


class JourneySummariesResponse(BaseModel):
    """Envelope for summary requests."""

    summaries: list[OperatorJourneySummaryPayload]
    aggregates: OperatorJourneyAggregatesPayload


class JourneyDetailPayload(BaseModel):
    """Detailed journey payload for operator consoles."""

    journey_id: UUID = Field(..., alias="journeyId")
    order_id: UUID = Field(..., alias="orderId")
    order_number: str | None = Field(None, alias="orderNumber")
    status: str
    risk_level: str = Field(..., alias="riskLevel")
    progress_percentage: float = Field(..., alias="progressPercentage")
    referral_code: str | None = Field(None, alias="referralCode")
    started_at: datetime | None = Field(None, alias="startedAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")
    tasks: list[OperatorTaskPayload]
    artifacts: list[OperatorArtifactPayload]
    interactions: list[OperatorInteractionPayload]
    nudge_opportunities: list[OperatorNudgeOpportunityPayload] = Field(
        ..., alias="nudgeOpportunities"
    )


class ManualNudgeRequest(BaseModel):
    """Manual concierge nudge payload."""

    channel: OnboardingInteractionChannel
    subject: str = Field(..., min_length=3, max_length=120)
    message: str = Field(..., min_length=10)
    task_id: UUID | None = Field(None, alias="taskId")
    triggered_by: str = Field(..., alias="triggeredBy", min_length=2, max_length=120)


@router.get(
    "/journeys",
    response_model=JourneySummariesResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_operator_journeys(
    *,
    status: list[OnboardingJourneyStatus] | None = Query(default=None),
    stalled_only: bool = Query(False, alias="stalled"),
    referral_only: bool = Query(False, alias="referrals"),
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_session),
) -> JourneySummariesResponse:
    """Return journey summaries for operator dashboards."""

    service = OnboardingService(db)
    statuses = tuple(status) if status else None
    filters = OnboardingJourneyFilters(
        statuses=statuses,
        stalled_only=stalled_only,
        referral_only=referral_only,
        search=search,
        limit=limit,
    )
    summaries = await service.list_journey_summaries(filters=filters)
    aggregates = await service.compute_aggregates()

    return JourneySummariesResponse(
        summaries=[OperatorJourneySummaryPayload.from_summary(summary) for summary in summaries],
        aggregates=OperatorJourneyAggregatesPayload.from_aggregates(aggregates),
    )


@router.get(
    "/journeys/{journey_id}",
    response_model=JourneyDetailPayload,
    dependencies=[Depends(require_checkout_api_key)],
)
async def fetch_operator_journey_detail(
    journey_id: UUID,
    db=Depends(get_session),
) -> JourneyDetailPayload:
    """Return detailed journey payload for operator use."""

    service = OnboardingService(db)
    journey = await service.fetch_journey_by_id(journey_id)
    if journey is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    order = await db.get(Order, journey.order_id)
    summary = service.build_summary(journey, order)
    opportunities = await service.compute_nudge_opportunities(journey_ids=[journey_id])

    tasks = [
        OperatorTaskPayload(
            id=task.id,
            slug=task.slug,
            title=task.title,
            status=task.status.value,
            dueAt=task.due_at,
            completedAt=task.completed_at,
            updatedAt=task.updated_at,
        )
        for task in sorted(journey.tasks, key=lambda candidate: candidate.sort_order)
    ]

    artifacts = [
        OperatorArtifactPayload(
            id=artifact.id,
            label=artifact.label,
            required=artifact.required,
            receivedAt=artifact.received_at,
            url=artifact.url,
        )
        for artifact in sorted(journey.artifacts, key=lambda candidate: candidate.created_at)
    ]

    interactions = [
        OperatorInteractionPayload(
            id=interaction.id,
            actor=interaction.actor_type.value,
            channel=interaction.channel.value,
            summary=interaction.summary,
            details=interaction.details,
            createdAt=interaction.created_at,
            metadata=interaction.metadata_json,
        )
        for interaction in sorted(
            journey.interactions,
            key=lambda candidate: candidate.created_at
            or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    ][:50]

    return JourneyDetailPayload(
        journeyId=journey.id,
        orderId=journey.order_id,
        orderNumber=order.order_number if order else None,
        status=journey.status.value,
        riskLevel=summary.risk_level,
        progressPercentage=summary.progress_percentage,
        referralCode=journey.referral_code,
        startedAt=journey.started_at,
        updatedAt=journey.updated_at,
        tasks=tasks,
        artifacts=artifacts,
        interactions=interactions,
        nudgeOpportunities=[
            OperatorNudgeOpportunityPayload.from_opportunity(opportunity)
            for opportunity in opportunities
        ],
    )


@router.post(
    "/journeys/{journey_id}/nudges/manual",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def trigger_manual_nudge(
    journey_id: UUID,
    request: ManualNudgeRequest,
    db=Depends(get_session),
) -> dict[str, str]:
    """Dispatch manual concierge nudges from operator consoles."""

    if request.channel not in {
        OnboardingInteractionChannel.EMAIL,
        OnboardingInteractionChannel.SLACK,
    }:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported channel")

    service = OnboardingService(db)
    journey = await service.fetch_journey_by_id(journey_id)
    if journey is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    task = None
    if request.task_id:
        task = next((candidate for candidate in journey.tasks if candidate.id == request.task_id), None)
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    order = await db.get(Order, journey.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order missing for journey")

    notification_service = NotificationService(db)
    delivered = False
    if request.channel == OnboardingInteractionChannel.EMAIL:
        delivered = await notification_service.send_onboarding_concierge_nudge(
            order,
            subject=request.subject,
            message_text=request.message,
            triggered_by=request.triggered_by,
        )

    dedupe_key = (
        f"{request.task_id or journey.id}:manual:{request.channel.value}"
    )
    await service.log_nudge(
        journey,
        task=task,
        channel=request.channel,
        actor=OnboardingActorType.OPERATOR,
        triggered_by=request.triggered_by,
        subject=request.subject,
        message=request.message,
        dedupe_key=dedupe_key,
        delivery_status="sent" if delivered else "logged",
        metadata={"channel": request.channel.value, "manual": True, "delivered": delivered},
    )
    await db.commit()

    return {"status": "sent" if delivered else "queued"}

"""Service primitives for managing onboarding journeys."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models import Order, OrderStatusEnum
from smplat_api.models.onboarding import (
    OnboardingActorType,
    OnboardingEvent,
    OnboardingEventType,
    OnboardingInteraction,
    OnboardingInteractionChannel,
    OnboardingJourney,
    OnboardingJourneyStatus,
    OnboardingTask,
    OnboardingTaskStatus,
)


DEFAULT_TASKS: tuple[dict[str, Any], ...] = (
    {
        "slug": "intake",
        "title": "Submit campaign intake",
        "description": "Share growth goals, budgets, and target audiences so operators can configure sprint lanes.",
        "sort_order": 1,
    },
    {
        "slug": "assets",
        "title": "Upload creative & access assets",
        "description": "Drop logos, paid media references, and grant account access for automation warmups.",
        "sort_order": 2,
    },
    {
        "slug": "collaboration",
        "title": "Confirm collaboration channels",
        "description": "Accept Slack Connect, confirm reporting recipients, and flag compliance boundaries.",
        "sort_order": 3,
    },
)


@dataclass(slots=True)
class OnboardingJourneyFilters:
    """Filter configuration for operator journey listings."""

    statuses: tuple[OnboardingJourneyStatus, ...] | None = None
    stalled_only: bool = False
    referral_only: bool = False
    search: str | None = None
    limit: int = 50


@dataclass(slots=True)
class OnboardingJourneySummary:
    """Lightweight summary suitable for operator dashboards."""

    journey_id: UUID
    order_id: UUID
    order_number: str | None
    status: OnboardingJourneyStatus
    risk_level: str
    progress_percentage: float
    referral_code: str | None
    started_at: datetime | None
    updated_at: datetime | None
    last_interaction_at: datetime | None
    total_tasks: int
    completed_tasks: int
    overdue_tasks: int
    awaiting_artifacts: int


@dataclass(slots=True)
class OnboardingJourneyAggregates:
    """Aggregated counts for journey dashboards."""

    total: int
    active: int
    stalled: int
    completed: int
    with_referrals: int


@dataclass(slots=True)
class OnboardingNudgeOpportunity:
    """Represents a deterministic concierge nudge opportunity."""

    journey_id: UUID
    order_id: UUID
    order_number: str | None
    task_id: UUID | None
    task_slug: str | None
    reason: str
    dedupe_key: str
    idle_hours: int
    recommended_channel: OnboardingInteractionChannel
    sla_expires_at: datetime
    subject: str
    message: str


@dataclass(slots=True)
class OnboardingService:
    """Coordinator for onboarding journey persistence and instrumentation."""

    # meta: service: onboarding-journeys

    db: AsyncSession

    async def ensure_journey(
        self,
        order_id: UUID,
        *,
        referral_code: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> OnboardingJourney:
        """Create or update a journey for an order and ensure default tasks exist."""

        stmt = (
            select(OnboardingJourney)
            .options(selectinload(OnboardingJourney.tasks))
            .where(OnboardingJourney.order_id == order_id)
        )
        result = await self.db.execute(stmt)
        journey = result.scalar_one_or_none()

        if journey:
            logger.debug(
                "Onboarding journey already exists", order_id=str(order_id), journey_id=str(journey.id)
            )
            if referral_code and journey.referral_code != referral_code:
                journey.referral_code = referral_code
            if context:
                journey.context = {**(journey.context or {}), **context}
            await self.db.flush()
            return journey

        order_stmt = select(Order).where(Order.id == order_id)
        order_result = await self.db.execute(order_stmt)
        order = order_result.scalar_one_or_none()
        if not order:
            raise ValueError(f"Order {order_id} does not exist")

        journey = OnboardingJourney(
            order_id=order_id,
            status=OnboardingJourneyStatus.ACTIVE,
            started_at=datetime.utcnow(),
            referral_code=referral_code,
            context=context,
        )
        self.db.add(journey)
        await self.db.flush()

        for task in DEFAULT_TASKS:
            self.db.add(
                OnboardingTask(
                    journey_id=journey.id,
                    slug=task["slug"],
                    title=task["title"],
                    description=task.get("description"),
                    sort_order=task.get("sort_order", 0),
                )
            )

        await self.db.flush()
        await self._refresh_progress(journey)
        await self._record_event(
            journey,
            event_type=OnboardingEventType.JOURNEY_STARTED,
            metadata={"source_order_status": order.status.value},
        )
        logger.info(
            "Created onboarding journey",
            order_id=str(order_id),
            journey_id=str(journey.id),
            tasks=len(DEFAULT_TASKS),
        )
        return journey

    async def fetch_journey(self, order_id: UUID) -> OnboardingJourney | None:
        """Fetch a journey with eager-loaded tasks and artifacts."""

        stmt = (
            select(OnboardingJourney)
            .options(
                selectinload(OnboardingJourney.tasks),
                selectinload(OnboardingJourney.artifacts),
                selectinload(OnboardingJourney.interactions),
            )
            .where(OnboardingJourney.order_id == order_id)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def fetch_journey_by_id(self, journey_id: UUID) -> OnboardingJourney | None:
        """Fetch a journey by identifier for operator consoles."""

        stmt = (
            select(OnboardingJourney)
            .options(
                selectinload(OnboardingJourney.tasks),
                selectinload(OnboardingJourney.artifacts),
                selectinload(OnboardingJourney.interactions),
            )
            .where(OnboardingJourney.id == journey_id)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_journey_summaries(
        self,
        *,
        filters: OnboardingJourneyFilters | None = None,
    ) -> list[OnboardingJourneySummary]:
        """Return operator-focused summaries honoring provided filters."""

        filters = filters or OnboardingJourneyFilters()
        stmt = (
            select(OnboardingJourney)
            .options(
                selectinload(OnboardingJourney.tasks),
                selectinload(OnboardingJourney.artifacts),
                selectinload(OnboardingJourney.interactions),
            )
            .order_by(OnboardingJourney.started_at.desc())
        )

        if filters.statuses:
            stmt = stmt.where(OnboardingJourney.status.in_(filters.statuses))
        if filters.stalled_only:
            stmt = stmt.where(OnboardingJourney.status == OnboardingJourneyStatus.STALLED)
        if filters.referral_only:
            stmt = stmt.where(OnboardingJourney.referral_code.is_not(None))

        if filters.search:
            search_term = f"%{filters.search.lower()}%"
            stmt = stmt.where(OnboardingJourney.referral_code.ilike(search_term))

        stmt = stmt.limit(filters.limit)
        result = await self.db.execute(stmt)
        journeys: Sequence[OnboardingJourney] = result.scalars().all()

        order_ids = {journey.order_id for journey in journeys}
        orders: dict[UUID, Order] = {}
        if order_ids:
            order_stmt = select(Order).where(Order.id.in_(order_ids))
            order_result = await self.db.execute(order_stmt)
            orders = {order.id: order for order in order_result.scalars().all()}

        return [self.build_summary(journey, orders.get(journey.order_id)) for journey in journeys]

    async def compute_aggregates(self) -> OnboardingJourneyAggregates:
        """Return aggregate journey counts for operator dashboards."""

        stmt = select(OnboardingJourney)
        result = await self.db.execute(stmt)
        journeys: Sequence[OnboardingJourney] = result.scalars().all()

        total = len(journeys)
        active = sum(1 for journey in journeys if journey.status == OnboardingJourneyStatus.ACTIVE)
        stalled = sum(1 for journey in journeys if journey.status == OnboardingJourneyStatus.STALLED)
        completed = sum(1 for journey in journeys if journey.status == OnboardingJourneyStatus.COMPLETED)
        with_referrals = sum(1 for journey in journeys if journey.referral_code)

        return OnboardingJourneyAggregates(
            total=total,
            active=active,
            stalled=stalled,
            completed=completed,
            with_referrals=with_referrals,
        )

    async def toggle_task_completion(
        self,
        order_id: UUID,
        task_id: UUID,
        *,
        completed: bool,
        actor: OnboardingActorType = OnboardingActorType.CLIENT,
    ) -> OnboardingTask:
        """Set task completion state and emit interaction + analytics events."""

        journey = await self.fetch_journey(order_id)
        if not journey:
            raise ValueError(f"Onboarding journey missing for order {order_id}")

        task = next((candidate for candidate in journey.tasks if candidate.id == task_id), None)
        if not task:
            raise ValueError(f"Task {task_id} not found for order {order_id}")

        previous_status = task.status
        task.status = OnboardingTaskStatus.COMPLETED if completed else OnboardingTaskStatus.PENDING
        task.completed_at = datetime.utcnow() if completed else None
        await self.db.flush()

        await self._refresh_progress(journey)
        await self._record_event(
            journey,
            event_type=OnboardingEventType.TASK_STATUS_CHANGED,
            task=task,
            status_before=previous_status.value,
            status_after=task.status.value,
            metadata={"actor": actor.value},
        )
        await self._log_interaction(
            journey,
            task,
            summary="Checklist updated",
            details=f"Task {task.slug} marked {'complete' if completed else 'open'}",
            actor=actor,
        )
        logger.info(
            "Onboarding task updated",
            order_id=str(order_id),
            journey_id=str(journey.id),
            task_id=str(task.id),
            status=task.status.value,
        )
        return task

    async def record_referral_copy(self, order_id: UUID, *, referral_code: str) -> None:
        """Record referral copy telemetry as a structured onboarding event."""

        journey = await self.fetch_journey(order_id)
        if not journey:
            journey = await self.ensure_journey(order_id, referral_code=referral_code)
        else:
            if not journey.referral_code:
                journey.referral_code = referral_code

        await self._record_event(
            journey,
            event_type=OnboardingEventType.REFERRAL_COPIED,
            metadata={"referral_code": referral_code},
        )
        await self.db.flush()

    async def ingest_success_payload(
        self,
        order_id: UUID,
        *,
        checkout_payload: dict[str, Any],
    ) -> OnboardingJourney:
        """Persist additional context from checkout success flows."""

        referral_code = checkout_payload.get("referralCode")
        context = {
            "offer": checkout_payload.get("offer"),
            "addons": checkout_payload.get("addons"),
            "support": checkout_payload.get("support"),
        }
        journey = await self.ensure_journey(order_id, referral_code=referral_code, context=context)
        await self.db.flush()
        return journey

    async def backfill_stalled_status(self) -> int:
        """Mark journeys as stalled when parent order is not progressing."""

        stmt = (
            select(OnboardingJourney)
            .options(selectinload(OnboardingJourney.tasks))
            .join(Order, Order.id == OnboardingJourney.order_id)
            .where(OnboardingJourney.status == OnboardingJourneyStatus.ACTIVE)
            .where(Order.status == OrderStatusEnum.PENDING)
        )
        result = await self.db.execute(stmt)
        stalled: Iterable[OnboardingJourney] = result.scalars().all()
        updated = 0
        for journey in stalled:
            all_pending = all(task.status == OnboardingTaskStatus.PENDING for task in journey.tasks)
            if all_pending:
                journey.status = OnboardingJourneyStatus.STALLED
                await self._record_event(
                    journey,
                    event_type=OnboardingEventType.TASK_STATUS_CHANGED,
                    metadata={"auto_reason": "pending_order"},
                )
                updated += 1
        if updated:
            logger.warning("Marked onboarding journeys stalled", count=updated)
        return updated

    async def _refresh_progress(self, journey: OnboardingJourney) -> None:
        """Update progress percentage and status for the provided journey."""

        total = len(journey.tasks)
        completed = sum(1 for task in journey.tasks if task.status == OnboardingTaskStatus.COMPLETED)
        journey.progress_percentage = float(completed * 100) / total if total else 0
        if total and completed == total:
            journey.status = OnboardingJourneyStatus.COMPLETED
            journey.completed_at = journey.completed_at or datetime.utcnow()
        elif completed > 0:
            journey.status = OnboardingJourneyStatus.ACTIVE
        await self.db.flush()

    async def _record_event(
        self,
        journey: OnboardingJourney,
        *,
        event_type: OnboardingEventType,
        task: OnboardingTask | None = None,
        status_before: str | None = None,
        status_after: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Persist a normalized analytics delta for the journey."""

        event = OnboardingEvent(
            journey_id=journey.id,
            order_id=journey.order_id,
            task_id=task.id if task else None,
            event_type=event_type,
            status_before=status_before,
            status_after=status_after,
            metadata=metadata,
        )
        self.db.add(event)
        await self.db.flush()

    async def _log_interaction(
        self,
        journey: OnboardingJourney,
        task: OnboardingTask | None,
        *,
        summary: str,
        details: str | None,
        actor: OnboardingActorType,
        channel: OnboardingInteractionChannel = OnboardingInteractionChannel.DASHBOARD,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Append an interaction log entry for operator visibility."""

        interaction = OnboardingInteraction(
            journey_id=journey.id,
            task_id=task.id if task else None,
            actor_type=actor,
            channel=channel,
            summary=summary,
            details=details,
            metadata=metadata,
        )
        self.db.add(interaction)
        await self.db.flush()

    def build_summary(self, journey: OnboardingJourney, order: Order | None) -> OnboardingJourneySummary:
        """Derive operator summary payload from journey context."""

        now = datetime.now(timezone.utc)
        total_tasks = len(journey.tasks)
        completed_tasks = sum(1 for task in journey.tasks if task.status == OnboardingTaskStatus.COMPLETED)
        overdue_tasks = sum(
            1
            for task in journey.tasks
            if task.due_at and task.due_at < now and task.status != OnboardingTaskStatus.COMPLETED
        )
        awaiting_artifacts = sum(
            1
            for artifact in journey.artifacts
            if artifact.required and not artifact.received_at
        )

        last_interaction_at = None
        if journey.interactions:
            last_interaction_at = max((interaction.created_at for interaction in journey.interactions), default=None)

        updated_at = journey.updated_at or journey.started_at
        reference_point = last_interaction_at or updated_at or journey.started_at
        risk_level = "low"
        if journey.status == OnboardingJourneyStatus.STALLED:
            risk_level = "high"
        elif reference_point:
            delta = now - reference_point
            if delta >= timedelta(hours=72):
                risk_level = "high"
            elif delta >= timedelta(hours=36):
                risk_level = "medium"

        progress_percentage = float(journey.progress_percentage or 0)

        return OnboardingJourneySummary(
            journey_id=journey.id,
            order_id=journey.order_id,
            order_number=order.order_number if order else None,
            status=journey.status,
            risk_level=risk_level,
            progress_percentage=progress_percentage,
            referral_code=journey.referral_code,
            started_at=journey.started_at,
            updated_at=updated_at,
            last_interaction_at=last_interaction_at,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            overdue_tasks=overdue_tasks,
            awaiting_artifacts=awaiting_artifacts,
        )

    async def compute_nudge_opportunities(
        self,
        *,
        idle_threshold_hours: int = 24,
        limit: int | None = None,
        journey_ids: Sequence[UUID] | None = None,
    ) -> list[OnboardingNudgeOpportunity]:
        """Identify deterministic concierge nudges for idle onboarding tasks."""

        stmt = (
            select(OnboardingJourney)
            .options(
                selectinload(OnboardingJourney.tasks),
                selectinload(OnboardingJourney.interactions),
            )
            .where(OnboardingJourney.status != OnboardingJourneyStatus.COMPLETED)
        )

        if journey_ids:
            stmt = stmt.where(OnboardingJourney.id.in_(journey_ids))

        if limit:
            stmt = stmt.limit(limit)

        result = await self.db.execute(stmt)
        journeys: Sequence[OnboardingJourney] = result.scalars().all()

        order_ids = {journey.order_id for journey in journeys}
        orders: dict[UUID, Order] = {}
        if order_ids:
            order_stmt = select(Order).where(Order.id.in_(order_ids))
            order_result = await self.db.execute(order_stmt)
            orders = {order.id: order for order in order_result.scalars().all()}

        now = datetime.now(timezone.utc)
        idle_delta = timedelta(hours=idle_threshold_hours)
        opportunities: list[OnboardingNudgeOpportunity] = []

        for journey in journeys:
            order = orders.get(journey.order_id)
            for task in journey.tasks:
                if task.status == OnboardingTaskStatus.COMPLETED:
                    continue

                last_touch_candidates = [task.updated_at or journey.updated_at or journey.started_at]
                last_touch_candidates.extend(
                    interaction.created_at
                    for interaction in journey.interactions
                    if interaction.task_id == task.id
                )
                last_touch = max((candidate for candidate in last_touch_candidates if candidate), default=None)
                if not last_touch:
                    continue

                if (now - last_touch) < idle_delta:
                    continue

                reason = "task_idle"
                if task.due_at and task.due_at < now:
                    reason = "task_overdue"

                dedupe_key = f"{task.id}:{reason}"
                last_nudge = next(
                    (
                        interaction
                        for interaction in sorted(
                            journey.interactions,
                            key=lambda candidate: candidate.created_at or datetime.min.replace(tzinfo=timezone.utc),
                            reverse=True,
                        )
                        if interaction.metadata
                        and interaction.metadata.get("nudge", {}).get("key") == dedupe_key
                    ),
                    None,
                )
                if last_nudge and last_nudge.created_at and (now - last_nudge.created_at) < timedelta(hours=12):
                    continue

                idle_hours = int((now - last_touch).total_seconds() // 3600)
                preferred_channel = (task.metadata or {}).get("preferred_channel") if task.metadata else None
                if preferred_channel and preferred_channel.lower() == "slack":
                    recommended_channel = OnboardingInteractionChannel.SLACK
                else:
                    recommended_channel = OnboardingInteractionChannel.EMAIL

                sla_expires_at = task.due_at or (now + timedelta(hours=idle_threshold_hours))

                subject = f"Action needed: {task.title}"
                message_lines = [
                    "Hi there,",
                    "",
                    f"We're keeping your onboarding journey moving and noticed '{task.title}' is still pending.",
                ]
                if reason == "task_overdue":
                    message_lines.append("This task is now past its expected completion window.")
                message_lines.extend(
                    [
                        "",
                        "Let us know if you need help or share the required artifacts right in the dashboard.",
                        "",
                        "— The SMPLAT Concierge Team",
                    ]
                )
                message = "\n".join(message_lines)

                opportunities.append(
                    OnboardingNudgeOpportunity(
                        journey_id=journey.id,
                        order_id=journey.order_id,
                        order_number=order.order_number if order else None,
                        task_id=task.id,
                        task_slug=task.slug,
                        reason=reason,
                        dedupe_key=dedupe_key,
                        idle_hours=idle_hours,
                        recommended_channel=recommended_channel,
                        sla_expires_at=sla_expires_at,
                        subject=subject,
                        message=message,
                    )
                )

        return opportunities

    async def log_nudge(
        self,
        journey: OnboardingJourney,
        *,
        task: OnboardingTask | None,
        channel: OnboardingInteractionChannel,
        actor: OnboardingActorType,
        triggered_by: str,
        subject: str,
        message: str,
        dedupe_key: str,
        delivery_status: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Persist an interaction entry for concierge nudges."""

        envelope = {
            "nudge": {
                "key": dedupe_key,
                "triggered_by": triggered_by,
                "delivery_status": delivery_status,
            }
        }
        if metadata:
            envelope["nudge"].update(metadata)

        await self._log_interaction(
            journey,
            task,
            summary="Concierge nudge dispatched",
            details=f"Subject: {subject}\n\n{message}",
            actor=actor,
            channel=channel,
            metadata=envelope,
        )

"""Service primitives for managing onboarding journeys."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable
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
    ) -> None:
        """Append an interaction log entry for operator visibility."""

        interaction = OnboardingInteraction(
            journey_id=journey.id,
            task_id=task.id if task else None,
            actor_type=actor,
            channel=channel,
            summary=summary,
            details=details,
        )
        self.db.add(interaction)
        await self.db.flush()

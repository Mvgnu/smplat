"""Service primitives for managing onboarding journeys."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
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
    experiment_slug: str | None = None
    experiment_variant: str | None = None


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
    pricing_experiments: tuple[dict[str, Any], ...] = ()


@dataclass(slots=True)
class OnboardingPricingExperimentEventRow:
    """Flattened pricing experiment event suitable for reporting exports."""

    event_id: UUID
    journey_id: UUID
    order_id: UUID
    order_number: str | None
    slug: str
    variant_key: str
    variant_name: str | None
    is_control: bool | None
    assignment_strategy: str | None
    status: str | None
    feature_flag_key: str | None
    recorded_at: datetime
    order_total: Decimal | None
    order_currency: str | None
    loyalty_projection_points: int | None


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

        for task in DEFAULT_TASKS:
            journey.tasks.append(
                OnboardingTask(
                    slug=task["slug"],
                    title=task["title"],
                    description=task.get("description"),
                    sort_order=task.get("sort_order", 0),
                    status=OnboardingTaskStatus.PENDING,
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
            selectinload(OnboardingJourney.events),
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
                selectinload(OnboardingJourney.events),
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
                selectinload(OnboardingJourney.events),
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

        slug_filter = (filters.experiment_slug or "").strip().lower() if filters.experiment_slug else None
        variant_filter = (
            (filters.experiment_variant or "").strip().lower() if filters.experiment_variant else None
        )

        filtered: list[tuple[OnboardingJourney, list[dict[str, Any]]]] = []
        for journey in journeys:
            segments = self.build_pricing_experiment_segments(journey)
            if slug_filter or variant_filter:
                matches = False
                for segment in segments:
                    slug_value = str(segment.get("slug") or "").lower()
                    variant_value = str(segment.get("variant_key") or "").lower()
                    slug_ok = slug_filter is None or slug_value == slug_filter
                    variant_ok = variant_filter is None or variant_value == variant_filter
                    if slug_ok and variant_ok:
                        matches = True
                        break
                if not matches:
                    continue
            filtered.append((journey, segments))

        order_ids = {journey.order_id for journey, _ in filtered}
        orders: dict[UUID, Order] = {}
        if order_ids:
            order_stmt = select(Order).where(Order.id.in_(order_ids))
            order_result = await self.db.execute(order_stmt)
            orders = {order.id: order for order in order_result.scalars().all()}

        return [
            self.build_summary(
                journey,
                orders.get(journey.order_id),
                pricing_experiments=tuple(segments),
            )
            for journey, segments in filtered
        ]

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
        logger.info(
            "Recorded onboarding referral copy",
            order_id=str(order_id),
            journey_id=str(journey.id),
            referral_code=referral_code,
        )

    async def record_pricing_experiment_segment(
        self,
        order_id: UUID,
        *,
        experiments: Sequence[dict[str, Any]],
    ) -> None:
        """Record pricing experiment segmentation for analytics + loyalty telemetry."""

        normalized: list[dict[str, Any]] = []
        for experiment in experiments:
            normalized_entry = self._normalize_pricing_experiment_entry(experiment)
            if normalized_entry:
                normalized.append(normalized_entry)

        if not normalized:
            return

        journey = await self.ensure_journey(order_id)
        await self._record_event(
            journey,
            event_type=OnboardingEventType.PRICING_EXPERIMENT_SEGMENT,
            metadata={"experiments": normalized},
        )
        await self.db.flush()
        logger.info(
            "Recorded pricing experiment segments",
            order_id=str(order_id),
            journey_id=str(journey.id),
            experiments=len(normalized),
        )

    def build_pricing_experiment_segments(self, journey: OnboardingJourney) -> list[dict[str, Any]]:
        """Summarize pricing experiment segments from journey events."""

        if not journey.events:
            return []

        segments: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for event in sorted(
            journey.events,
            key=lambda candidate: candidate.occurred_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        ):
            event_type = (
                event.event_type.value
                if isinstance(event.event_type, OnboardingEventType)
                else str(event.event_type)
            )
            if event_type != OnboardingEventType.PRICING_EXPERIMENT_SEGMENT.value:
                continue
            experiments = (event.metadata_json or {}).get("experiments")
            if not isinstance(experiments, list):
                continue
            for entry in experiments:
                if not isinstance(entry, dict):
                    continue
                slug = entry.get("slug")
                variant_key = entry.get("variant_key") or entry.get("variantKey")
                if not isinstance(slug, str) or not isinstance(variant_key, str):
                    continue
                dedupe_key = (slug, variant_key)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                segments.append(
                    {
                        "slug": slug,
                        "variant_key": variant_key,
                        "variant_name": entry.get("variant_name") or entry.get("variantName"),
                        "is_control": entry.get("is_control")
                        if isinstance(entry.get("is_control"), bool)
                        else entry.get("isControl"),
                        "assignment_strategy": entry.get("assignment_strategy")
                        or entry.get("assignmentStrategy"),
                        "status": entry.get("status"),
                        "feature_flag_key": entry.get("feature_flag_key")
                        or entry.get("featureFlagKey"),
                        "recorded_at": event.occurred_at,
                    }
                )
        return segments

    async def export_pricing_experiment_events(
        self,
        *,
        limit: int = 500,
        cursor: datetime | None = None,
    ) -> list[OnboardingPricingExperimentEventRow]:
        """Return flattened pricing experiment events for reporting + exports."""
        # TODO(snowflake-ingest): Pipe these normalized rows into the warehouse export so
        # ExperimentAnalyticsService metrics hit the Snowflake dashboards described in
        # docs/storefront-platform-roadmap.md.

        stmt = (
            select(OnboardingEvent)
            .options(selectinload(OnboardingEvent.journey))
            .where(OnboardingEvent.event_type == OnboardingEventType.PRICING_EXPERIMENT_SEGMENT)
            .order_by(OnboardingEvent.occurred_at.desc())
        )

        if cursor:
            stmt = stmt.where(OnboardingEvent.occurred_at < cursor)

        stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        events: Sequence[OnboardingEvent] = result.scalars().all()

        order_ids = {event.order_id for event in events}
        orders: dict[UUID, Order] = {}
        if order_ids:
            order_stmt = select(Order).where(Order.id.in_(order_ids))
            order_result = await self.db.execute(order_stmt)
            orders = {order.id: order for order in order_result.scalars().all()}

        rows: list[OnboardingPricingExperimentEventRow] = []
        for event in events:
            experiments = (event.metadata_json or {}).get("experiments")
            if not isinstance(experiments, list):
                continue
            for entry in experiments:
                normalized = self._normalize_pricing_experiment_entry(entry)
                if not normalized:
                    continue
                recorded_at = event.occurred_at or datetime.now(timezone.utc)
                order = orders.get(event.order_id)
                rows.append(
                    OnboardingPricingExperimentEventRow(
                        event_id=event.id,
                        journey_id=event.journey_id,
                        order_id=event.order_id,
                        order_number=order.order_number if order else None,
                        slug=normalized["slug"],
                        variant_key=normalized["variant_key"],
                        variant_name=normalized.get("variant_name"),
                        is_control=normalized.get("is_control"),
                        assignment_strategy=normalized.get("assignment_strategy"),
                        status=normalized.get("status"),
                        feature_flag_key=normalized.get("feature_flag_key"),
                        recorded_at=recorded_at,
                        order_total=order.total if order else None,
                        order_currency=order.currency.value if order and order.currency else None,
                        loyalty_projection_points=order.loyalty_projection_points if order else None,
                    )
                )
        return rows

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
            "platform_contexts": checkout_payload.get("platformContexts"),
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
            metadata_json=metadata,
        )
        self.db.add(event)
        await self.db.flush()

    def _normalize_pricing_experiment_entry(
        self, experiment: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """Normalize heterogeneous experiment payloads into snake_case fields."""

        if not isinstance(experiment, dict):
            return None

        slug = experiment.get("slug")
        if not isinstance(slug, str) or not slug.strip():
            return None

        variant_key = experiment.get("variant_key") or experiment.get("variantKey")
        if not isinstance(variant_key, str) or not variant_key.strip():
            return None

        variant_name = experiment.get("variant_name") or experiment.get("variantName")
        is_control = experiment.get("is_control")
        if not isinstance(is_control, bool):
            is_control = experiment.get("isControl") if isinstance(experiment.get("isControl"), bool) else None
        assignment_strategy = experiment.get("assignment_strategy") or experiment.get("assignmentStrategy")
        status_value = experiment.get("status")
        if not isinstance(status_value, str):
            status_value = None

        feature_flag_key = experiment.get("feature_flag_key") or experiment.get("featureFlagKey")
        if feature_flag_key is not None and not isinstance(feature_flag_key, str):
            feature_flag_key = None

        return {
            "slug": slug,
            "variant_key": variant_key,
            "variant_name": variant_name,
            "is_control": is_control,
            "assignment_strategy": assignment_strategy,
            "status": status_value,
            "feature_flag_key": feature_flag_key,
        }

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

    def build_summary(
        self,
        journey: OnboardingJourney,
        order: Order | None,
        *,
        pricing_experiments: Sequence[dict[str, Any]] | None = None,
    ) -> OnboardingJourneySummary:
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

        def normalize(dt: datetime | None) -> datetime | None:
            if dt is None:
                return None
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

        last_interaction_at = None
        if journey.interactions:
            last_interaction_at = normalize(
                max((interaction.created_at for interaction in journey.interactions), default=None)
            )

        updated_at = journey.updated_at or journey.started_at
        reference_point = last_interaction_at or normalize(updated_at) or normalize(journey.started_at)
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
        experiments = tuple(pricing_experiments or self.build_pricing_experiment_segments(journey))

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
            pricing_experiments=experiments,
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
                        if interaction.metadata_json
                        and interaction.metadata_json.get("nudge", {}).get("key") == dedupe_key
                    ),
                    None,
                )
                if last_nudge and last_nudge.created_at and (now - last_nudge.created_at) < timedelta(hours=12):
                    continue

                idle_hours = int((now - last_touch).total_seconds() // 3600)
                preferred_channel = (task.metadata_json or {}).get("preferred_channel") if task.metadata_json else None
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

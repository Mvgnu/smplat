"""Checkout orchestration state machine utilities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.checkout import (
    CheckoutOrchestration,
    CheckoutOrchestrationEvent,
    CheckoutOrchestrationStage,
    CheckoutOrchestrationStatus,
)

_STAGE_SEQUENCE: Sequence[CheckoutOrchestrationStage] = (
    CheckoutOrchestrationStage.PAYMENT,
    CheckoutOrchestrationStage.VERIFICATION,
    CheckoutOrchestrationStage.LOYALTY_HOLD,
    CheckoutOrchestrationStage.FULFILLMENT,
    CheckoutOrchestrationStage.COMPLETED,
)


@dataclass
class StageUpdate:
    """Payload describing a stage transition."""

    stage: CheckoutOrchestrationStage
    status: CheckoutOrchestrationStatus
    note: str | None = None
    payload: dict[str, Any] | None = None
    next_action_at: datetime | None = None
    metadata_patch: dict[str, Any] | None = None


class CheckoutOrchestrationService:
    """State machine helper for checkout orchestration."""

    # meta: checkout-orchestration: service

    def __init__(self, db: AsyncSession):
        self._db = db

    async def get_or_create(
        self,
        order_id: UUID,
        *,
        user_id: UUID | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CheckoutOrchestration:
        """Return an orchestration for the order, creating one if needed."""

        stmt = select(CheckoutOrchestration).where(CheckoutOrchestration.order_id == order_id)
        result = await self._db.execute(stmt)
        orchestration = result.scalar_one_or_none()
        if orchestration:
            return orchestration

        orchestration = CheckoutOrchestration(
            order_id=order_id,
            user_id=user_id,
            metadata_json=metadata or {},
            stage_status=CheckoutOrchestrationStatus.NOT_STARTED,
            current_stage=CheckoutOrchestrationStage.PAYMENT,
        )
        self._db.add(orchestration)
        await self._db.flush()
        await self._record_event(
            orchestration,
            stage=CheckoutOrchestrationStage.PAYMENT,
            status=CheckoutOrchestrationStatus.NOT_STARTED,
            note="Checkout orchestration initialized",
            payload=metadata or {},
        )
        return orchestration

    async def _record_event(
        self,
        orchestration: CheckoutOrchestration,
        *,
        stage: CheckoutOrchestrationStage,
        status: CheckoutOrchestrationStatus,
        note: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> CheckoutOrchestrationEvent:
        event = CheckoutOrchestrationEvent(
            orchestration_id=orchestration.id,
            stage=stage,
            status=status,
            transition_note=note,
            payload=payload or {},
        )
        self._db.add(event)
        await self._db.flush()
        return event

    async def apply_update(
        self,
        orchestration: CheckoutOrchestration,
        update: StageUpdate,
    ) -> CheckoutOrchestration:
        """Apply a transition update to the orchestration."""

        now = datetime.now(timezone.utc)
        orchestration.last_transition_at = now
        metadata = dict(orchestration.metadata_json or {})
        if update.metadata_patch:
            metadata.update(update.metadata_patch)
        orchestration.metadata_json = metadata

        if update.status == CheckoutOrchestrationStatus.FAILED:
            orchestration.stage_status = CheckoutOrchestrationStatus.FAILED
            orchestration.failed_at = now
            orchestration.locked_until = None
            await self._record_event(
                orchestration,
                stage=update.stage,
                status=CheckoutOrchestrationStatus.FAILED,
                note=update.note,
                payload=update.payload,
            )
            return orchestration

        if update.status == CheckoutOrchestrationStatus.COMPLETED:
            await self._record_event(
                orchestration,
                stage=update.stage,
                status=CheckoutOrchestrationStatus.COMPLETED,
                note=update.note,
                payload=update.payload,
            )
            self._advance_stage(orchestration, now)
            return orchestration

        orchestration.stage_status = update.status
        orchestration.current_stage = update.stage
        orchestration.locked_until = None
        if update.status == CheckoutOrchestrationStatus.IN_PROGRESS and orchestration.started_at is None:
            orchestration.started_at = now
        if update.status == CheckoutOrchestrationStatus.WAITING:
            orchestration.next_action_at = update.next_action_at
            orchestration.locked_until = update.next_action_at
        else:
            orchestration.next_action_at = None
        await self._record_event(
            orchestration,
            stage=update.stage,
            status=update.status,
            note=update.note,
            payload=update.payload,
        )
        return orchestration

    def _advance_stage(self, orchestration: CheckoutOrchestration, now: datetime) -> None:
        current_index = _STAGE_SEQUENCE.index(orchestration.current_stage)
        if orchestration.current_stage is CheckoutOrchestrationStage.COMPLETED:
            orchestration.stage_status = CheckoutOrchestrationStatus.COMPLETED
            orchestration.completed_at = orchestration.completed_at or now
            orchestration.next_action_at = None
            orchestration.locked_until = None
            return

        next_index = min(current_index + 1, len(_STAGE_SEQUENCE) - 1)
        next_stage = _STAGE_SEQUENCE[next_index]
        orchestration.current_stage = next_stage
        orchestration.stage_status = (
            CheckoutOrchestrationStatus.NOT_STARTED
            if next_stage is not CheckoutOrchestrationStage.COMPLETED
            else CheckoutOrchestrationStatus.COMPLETED
        )
        if next_stage is CheckoutOrchestrationStage.COMPLETED:
            orchestration.completed_at = now
            orchestration.next_action_at = None
            orchestration.locked_until = None
        else:
            orchestration.next_action_at = None
            orchestration.locked_until = None

    async def acquire_due(self, *, limit: int = 50) -> list[CheckoutOrchestration]:
        """Acquire orchestrations whose next action time has passed."""

        now = datetime.now(timezone.utc)
        stmt = (
            select(CheckoutOrchestration)
            .where(
                and_(
                    CheckoutOrchestration.next_action_at.is_not(None),
                    CheckoutOrchestration.next_action_at <= now,
                    or_(
                        CheckoutOrchestration.locked_until.is_(None),
                        CheckoutOrchestration.locked_until <= now,
                    ),
                    CheckoutOrchestration.stage_status == CheckoutOrchestrationStatus.WAITING,
                )
            )
            .order_by(CheckoutOrchestration.next_action_at.asc())
            .limit(limit)
        )
        result = await self._db.execute(stmt)
        orchestrations = list(result.scalars().all())
        lock_deadline = now + timedelta(minutes=5)
        for orchestration in orchestrations:
            orchestration.locked_until = lock_deadline
        return orchestrations

    async def mark_complete(
        self,
        orchestration: CheckoutOrchestration,
        *,
        note: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> CheckoutOrchestration:
        update = StageUpdate(
            stage=orchestration.current_stage,
            status=CheckoutOrchestrationStatus.COMPLETED,
            note=note,
            payload=payload,
        )
        return await self.apply_update(orchestration, update)

    async def mark_failed(
        self,
        orchestration: CheckoutOrchestration,
        *,
        note: str,
        payload: dict[str, Any] | None = None,
    ) -> CheckoutOrchestration:
        update = StageUpdate(
            stage=orchestration.current_stage,
            status=CheckoutOrchestrationStatus.FAILED,
            note=note,
            payload=payload,
        )
        return await self.apply_update(orchestration, update)


__all__ = ["CheckoutOrchestrationService", "StageUpdate"]

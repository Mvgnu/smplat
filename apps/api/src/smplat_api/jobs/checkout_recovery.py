"""Checkout recovery monitoring job."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.order import Order
from smplat_api.models.loyalty import LoyaltyMember
from smplat_api.services.checkout import CheckoutOrchestrationService
from smplat_api.services.checkout.orchestrator import StageUpdate
from smplat_api.services.loyalty import LoyaltyService
from smplat_api.services.notifications import NotificationService
from smplat_api.models.checkout import CheckoutOrchestrationStatus

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def monitor_checkout_orchestrations(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Sweep checkout orchestrations to trigger recovery nudges."""

    maybe_session = session_factory()
    session = maybe_session if isinstance(maybe_session, AsyncSession) else await maybe_session

    async with session as managed_session:
        service = CheckoutOrchestrationService(managed_session)
        notifications = NotificationService(managed_session)
        loyalty = LoyaltyService(managed_session, notification_service=notifications)

        orchestrations = await service.acquire_due(limit=50)
        if not orchestrations:
            logger.info("No checkout orchestrations ready for recovery sweep")
            return {"processed": 0, "nudges_sent": 0}

        nudges_sent = 0
        escalations = 0
        now = datetime.now(timezone.utc)
        retry_at = now + timedelta(hours=6)

        for orchestration in orchestrations:
            order = await managed_session.get(Order, orchestration.order_id)
            if order is None:
                logger.warning(
                    "Checkout orchestration missing order", orchestration_id=str(orchestration.id)
                )
                continue

            member = None
            if order.user_id:
                result = await managed_session.execute(
                    select(LoyaltyMember).where(LoyaltyMember.user_id == order.user_id)
                )
                member = result.scalar_one_or_none()
                if member is None:
                    member = await loyalty.ensure_member(order.user_id)

            metadata_patch: dict[str, Any] = {
                "lastRecoverySweepAt": now.isoformat(),
                "lastRecoveryStage": orchestration.current_stage.value,
            }

            if member:
                intents = await loyalty.list_checkout_next_actions(member)
                if intents:
                    await notifications.send_checkout_recovery_prompt(
                        order,
                        stage=orchestration.current_stage.value,
                        metadata={
                            "intentCount": len(intents),
                            "stage": orchestration.current_stage.value,
                        },
                    )
                    nudges_sent += 1
                else:
                    metadata_patch["note"] = "No pending checkout intents"
            else:
                escalations += 1
                metadata_patch["note"] = "Missing member for checkout recovery"

            update = StageUpdate(
                stage=orchestration.current_stage,
                status=CheckoutOrchestrationStatus.WAITING,
                note="Recovery sweep executed",
                next_action_at=retry_at,
                metadata_patch=metadata_patch,
            )
            await service.apply_update(orchestration, update)

        await managed_session.commit()
        summary = {
            "processed": len(orchestrations),
            "nudges_sent": nudges_sent,
            "escalations": escalations,
        }
        logger.bind(summary=summary).info("Checkout recovery sweep completed")
        return summary


__all__ = ["monitor_checkout_orchestrations"]

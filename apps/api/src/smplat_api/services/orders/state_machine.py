"""Order state machine orchestration and audit logging."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.order import Order, OrderStatusEnum
from smplat_api.models.order_state_event import (
    OrderStateActorTypeEnum,
    OrderStateEvent,
    OrderStateEventTypeEnum,
)


class OrderStateError(RuntimeError):
    """Base exception for order state machine failures."""


class InvalidOrderTransitionError(OrderStateError):
    """Raised when a state transition violates the configured state machine."""

    def __init__(self, current_status: OrderStatusEnum, requested_status: OrderStatusEnum) -> None:
        message = f"Cannot transition order from {current_status.value} to {requested_status.value}"
        super().__init__(message)
        self.current_status = current_status
        self.requested_status = requested_status


class OrderNotFoundError(OrderStateError):
    """Raised when attempting to mutate a missing order."""


@dataclass(slots=True)
class OrderEventDescriptor:
    """Internal representation of a state timeline entry."""

    event: OrderStateEvent
    order: Order


class OrderStateMachine:
    """Encapsulates order state transitions, audit logging, and delivery proof notes."""

    _ALLOWED_TRANSITIONS: dict[OrderStatusEnum, set[OrderStatusEnum]] = {
        OrderStatusEnum.PENDING: {
            OrderStatusEnum.PROCESSING,
            OrderStatusEnum.ACTIVE,
            OrderStatusEnum.COMPLETED,
            OrderStatusEnum.CANCELED,
        },
        OrderStatusEnum.PROCESSING: {
            OrderStatusEnum.ACTIVE,
            OrderStatusEnum.COMPLETED,
            OrderStatusEnum.ON_HOLD,
            OrderStatusEnum.CANCELED,
        },
        OrderStatusEnum.ACTIVE: {
            OrderStatusEnum.COMPLETED,
            OrderStatusEnum.ON_HOLD,
            OrderStatusEnum.CANCELED,
        },
        OrderStatusEnum.ON_HOLD: {
            OrderStatusEnum.PROCESSING,
            OrderStatusEnum.ACTIVE,
            OrderStatusEnum.CANCELED,
        },
        OrderStatusEnum.COMPLETED: {
            OrderStatusEnum.ACTIVE,
        },
        OrderStatusEnum.CANCELED: set(),
    }

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def transition(
        self,
        *,
        order_id: UUID,
        target_status: OrderStatusEnum,
        actor_type: OrderStateActorTypeEnum | None,
        actor_id: str | None,
        actor_label: str | None,
        notes: str | None,
        metadata: dict | None = None,
    ) -> OrderEventDescriptor:
        """Transition an order to a new status if allowed by the state machine."""

        order = await self._get_order(order_id)
        current_status = order.status
        if target_status == current_status:
            raise InvalidOrderTransitionError(current_status, target_status)

        allowed = self._ALLOWED_TRANSITIONS.get(current_status, set())
        if target_status not in allowed:
            raise InvalidOrderTransitionError(current_status, target_status)

        order.status = target_status
        event = OrderStateEvent(
            order_id=order.id,
            event_type=OrderStateEventTypeEnum.STATE_CHANGE,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=actor_label,
            notes=notes,
            metadata_json=metadata or {},
            from_status=current_status.value,
            to_status=target_status.value,
        )
        self._session.add(event)
        await self._session.commit()
        await self._session.refresh(order)
        logger.info(
            "Order status transitioned",
            order_id=str(order.id),
            from_status=current_status.value,
            to_status=target_status.value,
            actor_type=actor_type.value if actor_type else None,
        )
        return OrderEventDescriptor(event=event, order=order)

    async def record_event(
        self,
        *,
        order_id: UUID,
        event_type: OrderStateEventTypeEnum,
        actor_type: OrderStateActorTypeEnum | None,
        actor_id: str | None,
        actor_label: str | None,
        notes: str | None,
        metadata: dict | None = None,
    ) -> OrderEventDescriptor:
        """Insert a non-state-change audit entry (refill/refund/note)."""

        order = await self._get_order(order_id)
        event = OrderStateEvent(
            order_id=order.id,
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=actor_label,
            notes=notes,
            metadata_json=metadata or {},
        )
        self._session.add(event)
        await self._session.commit()
        logger.info(
            "Order timeline event recorded",
            order_id=str(order.id),
            event_type=event_type.value,
            actor_type=actor_type.value if actor_type else None,
        )
        return OrderEventDescriptor(event=event, order=order)

    async def list_events(self, order_id: UUID) -> list[OrderStateEvent]:
        """Return chronological order state events."""

        stmt = (
            select(OrderStateEvent)
            .where(OrderStateEvent.order_id == order_id)
            .order_by(OrderStateEvent.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def _get_order(self, order_id: UUID) -> Order:
        stmt = select(Order).where(Order.id == order_id)
        result = await self._session.execute(stmt)
        order = result.scalar_one_or_none()
        if not order:
            raise OrderNotFoundError(f"Order {order_id} not found")
        return order

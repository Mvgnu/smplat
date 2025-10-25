"""Utilities for dispatching weekly digest notifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from loguru import logger as app_logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
)
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.order import Order, OrderItem, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum

from .service import NotificationService


@dataclass
class DigestContext:
    user: User
    highlighted_orders: Sequence[Order]
    pending_actions: Sequence[str]


class WeeklyDigestDispatcher:
    """Aggregate customer activity and send weekly digest notifications."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        notification_service: NotificationService | None = None,
    ) -> None:
        self._session = session
        self._notifications = notification_service or NotificationService(session)

    async def run(self) -> int:
        """Send weekly digest emails to eligible users.

        Returns:
            Number of digests dispatched.
        """
        digests_sent = 0
        for context in await self._gather_contexts():
            if context.user.email is None:
                continue

            if not context.highlighted_orders and not context.pending_actions:
                # Skip empty digests to avoid noisy emails.
                continue

            await self._notifications.send_weekly_digest(
                context.user,
                highlighted_orders=context.highlighted_orders,
                pending_actions=context.pending_actions,
            )
            digests_sent += 1

        if digests_sent:
            app_logger.info("Weekly digests dispatched", count=digests_sent)
        else:
            app_logger.info("Weekly digest run completed with no outgoing messages")
        return digests_sent

    async def _gather_contexts(self) -> list[DigestContext]:
        result = await self._session.execute(
            select(User)
            .join(NotificationPreference, NotificationPreference.user_id == User.id)
            .where(
                NotificationPreference.marketing_messages.is_(True),
                User.status == UserStatusEnum.ACTIVE,
                User.role == UserRoleEnum.CLIENT,
            )
            .order_by(User.created_at)
        )
        users: Iterable[User] = result.scalars().all()

        contexts: list[DigestContext] = []
        for user in users:
            orders = await self._load_orders(user)
            highlighted = self._select_highlighted_orders(orders)
            pending_actions = self._build_pending_actions(orders)
            contexts.append(
                DigestContext(
                    user=user,
                    highlighted_orders=highlighted,
                    pending_actions=pending_actions,
                )
            )
        return contexts

    async def _load_orders(self, user: User) -> list[Order]:
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.fulfillment_tasks))
            .where(Order.user_id == user.id)
            .order_by(Order.updated_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    def _select_highlighted_orders(self, orders: Sequence[Order]) -> list[Order]:
        prioritized = [
            order
            for order in orders
            if order.status
            and order.status
            in {
                OrderStatusEnum.ON_HOLD,
                OrderStatusEnum.ACTIVE,
                OrderStatusEnum.PROCESSING,
            }
        ]

        if not prioritized:
            prioritized = list(orders)

        # Limit to the 5 most relevant orders for the digest.
        return list(prioritized[:5])

    def _build_pending_actions(self, orders: Sequence[Order]) -> list[str]:
        on_hold = sum(1 for order in orders if order.status == OrderStatusEnum.ON_HOLD)

        failed_tasks = 0
        pending_tasks = 0
        for order in orders:
            for item in getattr(order, "items", []):
                tasks: Iterable[FulfillmentTask] = getattr(item, "fulfillment_tasks", [])
                for task in tasks:
                    if task.status == FulfillmentTaskStatusEnum.FAILED:
                        failed_tasks += 1
                    elif task.status == FulfillmentTaskStatusEnum.PENDING:
                        pending_tasks += 1

        pending_messages: list[str] = []
        if on_hold:
            pending_messages.append(f"{on_hold} order(s) are currently on hold.")
        if failed_tasks:
            pending_messages.append(f"{failed_tasks} fulfillment task(s) need review.")
        if pending_tasks:
            pending_messages.append(f"{pending_tasks} fulfillment task(s) are waiting to start.")

        return pending_messages

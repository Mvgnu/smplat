from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.notifications import (
    NotificationService,
    WeeklyDigestDispatcher,
    WeeklyDigestScheduler,
)


@pytest.mark.asyncio
async def test_weekly_digest_sends_for_opted_in_user(session_factory):
    async with session_factory() as session:
        user = User(
            email="digest@example.com",
            display_name="Digest Client",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        preference = NotificationPreference(
            user_id=user.id,
            order_updates=True,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=True,
        )
        session.add(preference)

        order = Order(
            order_number="SM900010",
            status=OrderStatusEnum.ACTIVE,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("150.00"),
            tax=Decimal("0"),
            total=Decimal("150.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        order_item = OrderItem(
            order=order,
            product_title="Campaign bundle",
            quantity=1,
            unit_price=Decimal("150.00"),
            total_price=Decimal("150.00"),
            selected_options={
                "options": [
                    {
                        "groupId": "hero",
                        "groupName": "Hero",
                        "optionId": "bundle-hero",
                        "label": "Hero resonance",
                        "marketingTagline": "Top-of-feed reach",
                    }
                ],
                "addOns": [
                    {
                        "id": "concierge",
                        "label": "Concierge QA",
                        "priceDelta": 75,
                        "pricingMode": "flat",
                    }
                ],
            },
        )
        task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Campaign wrap-up",
            status=FulfillmentTaskStatusEnum.COMPLETED,
            scheduled_at=datetime.utcnow() - timedelta(days=1),
        )

        session.add_all([order, order_item, task])
        await session.commit()

        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()
        dispatcher = WeeklyDigestDispatcher(session, notification_service=notification_service)

        count = await dispatcher.run()

        assert count == 1
        events = [event for event in notification_service.sent_events if event.event_type == "weekly_digest"]
        assert events
        digest_event = events[-1]
        assert "SM900010" in digest_event.metadata["orders"]
        html_part = backend.sent_messages[-1].get_body(preferencelist=("html",))
        assert html_part is not None
        html_content = html_part.get_content()
        assert "weekly summary" in html_content.lower()
        assert "Order SM900010 blueprint" in html_content
        text_part = backend.sent_messages[-1].get_body(preferencelist=("plain",))
        assert text_part is not None
        text_content = text_part.get_content()
        assert "Blueprint snapshots" in text_content
        assert "Concierge QA" in text_content


@pytest.mark.asyncio
async def test_weekly_digest_skips_when_no_activity(session_factory):
    async with session_factory() as session:
        user = User(
            email="noactivity@example.com",
            display_name="No Activity",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        preference = NotificationPreference(
            user_id=user.id,
            order_updates=True,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=True,
        )
        session.add(preference)
        await session.commit()

        notification_service = NotificationService(session)
        notification_service.use_in_memory_backend()
        dispatcher = WeeklyDigestDispatcher(session, notification_service=notification_service)

        count = await dispatcher.run()

        assert count == 0
        assert all(event.event_type != "weekly_digest" for event in notification_service.sent_events)


@pytest.mark.asyncio
async def test_weekly_digest_includes_pending_actions(session_factory):
    async with session_factory() as session:
        user = User(
            email="actions@example.com",
            display_name="Action Needed",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        preference = NotificationPreference(
            user_id=user.id,
            order_updates=True,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=True,
        )
        session.add(preference)

        order = Order(
            order_number="SM900011",
            status=OrderStatusEnum.ON_HOLD,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("80.00"),
            tax=Decimal("0"),
            total=Decimal("80.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        order_item = OrderItem(
            order=order,
            product_title="Engagement boost",
            quantity=1,
            unit_price=Decimal("80.00"),
            total_price=Decimal("80.00"),
        )
        failed_task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
            title="Engagement start",
            status=FulfillmentTaskStatusEnum.FAILED,
            scheduled_at=datetime.utcnow() - timedelta(hours=2),
        )
        pending_task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
            title="Follower batch",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() + timedelta(hours=2),
        )

        session.add_all([order, order_item, failed_task, pending_task])
        await session.commit()

        notification_service = NotificationService(session)
        notification_service.use_in_memory_backend()
        dispatcher = WeeklyDigestDispatcher(session, notification_service=notification_service)

        await dispatcher.run()

        digest_events = [event for event in notification_service.sent_events if event.event_type == "weekly_digest"]
        assert digest_events
        pending_actions = digest_events[-1].metadata["pending_actions"]
        assert any("on hold" in action.lower() for action in pending_actions)
        assert any("fulfillment task" in action.lower() for action in pending_actions)


@pytest.mark.asyncio
async def test_weekly_digest_scheduler_dispatch_once(session_factory):
    async with session_factory() as session:
        user = User(
            email="scheduler@example.com",
            display_name="Scheduler Client",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        preference = NotificationPreference(
            user_id=user.id,
            order_updates=True,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=True,
        )
        session.add(preference)

        order = Order(
            order_number="SM900012",
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("60.00"),
            tax=Decimal("0"),
            total=Decimal("60.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        session.add(order)
        await session.commit()

    scheduler = WeeklyDigestScheduler(session_factory, interval_seconds=60, dry_run=True)
    count = await scheduler.dispatch_once()

    assert count == 1

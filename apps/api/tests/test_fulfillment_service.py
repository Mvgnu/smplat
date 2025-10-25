from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from loguru import logger
from sqlalchemy import select

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.fulfillment.fulfillment_service import FulfillmentService
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.notifications import NotificationService


@pytest.mark.asyncio
async def test_process_order_fulfillment_creates_instagram_tasks(session_factory):
    async with session_factory() as session:
        product = Product(
            slug="instagram-growth",
            title="Instagram Growth",
            description="Boost your presence",
            category="instagram",
            base_price=Decimal("299.00"),
            currency=CurrencyEnum.EUR,
            status=ProductStatusEnum.ACTIVE,
        )

        order = Order(
            order_number="SM100001",
            subtotal=Decimal("299.00"),
            tax=Decimal("0"),
            total=Decimal("299.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )

        session.add(product)
        await session.flush()

        order_item = OrderItem(
            product_id=product.id,
            product_title=product.title,
            quantity=1,
            unit_price=Decimal("299.00"),
            total_price=Decimal("299.00"),
        )
        order.items.append(order_item)

        session.add(order)
        await session.commit()

        service = FulfillmentService(session)
        result = await service.process_order_fulfillment(order.id)
        assert result is True

        refreshed_order = await session.get(Order, order.id)
        assert refreshed_order.status == OrderStatusEnum.PROCESSING

        tasks = (
            await session.execute(
                select(FulfillmentTask).where(FulfillmentTask.order_item_id == order_item.id)
            )
        ).scalars().all()

        assert len(tasks) == 4
        assert {task.task_type for task in tasks} == {
            FulfillmentTaskTypeEnum.INSTAGRAM_SETUP,
            FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
            FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
            FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
        }


@pytest.mark.asyncio
async def test_process_order_fulfillment_respects_product_configuration(session_factory, caplog):
    async with session_factory() as session:
        config = {
            "tasks": [
                {
                    "type": FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION.value,
                    "title": "Baseline snapshot",
                    "schedule_offset_minutes": 0,
                    "execution": {
                        "kind": "http",
                        "method": "POST",
                        "url": "https://example.test/hooks/{{ order.id }}",
                        "headers": {"X-Order-Number": "{{ order.order_number }}"},
                        "body": {"itemId": "{{ item.id }}", "quantity": "{{ item.quantity }}"},
                        "environment_keys": ["FULFILLMENT_BASE_URL"],
                    },
                    "payload": {"playbook": "baseline"},
                },
                {
                    "type": FulfillmentTaskTypeEnum.CONTENT_PROMOTION.value,
                    "title": "Campaign kickoff",
                    "schedule_offset_minutes": 0,
                    "execution": {
                        "kind": "http",
                        "method": "POST",
                        "url": "https://example.test/campaign/{{ product.slug }}",
                        "body": {"order": "{{ order }}", "product": "{{ product }}"},
                    },
                },
            ]
        }

        product = Product(
            slug="configurable-service",
            title="Configurable Service",
            description="Uses fulfillment config",
            category="automation",
            base_price=Decimal("150.00"),
            currency=CurrencyEnum.EUR,
            status=ProductStatusEnum.ACTIVE,
            fulfillment_config=config,
        )

        order = Order(
            order_number="SM200001",
            subtotal=Decimal("150.00"),
            tax=Decimal("0"),
            total=Decimal("150.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )

        session.add(product)
        await session.flush()

        order_item = OrderItem(
            product_id=product.id,
            product_title=product.title,
            quantity=2,
            unit_price=Decimal("75.00"),
            total_price=Decimal("150.00"),
        )
        order.items.append(order_item)

        session.add(order)
        await session.commit()

        service = FulfillmentService(session)

        await service._create_fulfillment_tasks_for_item(order_item)
        await session.flush()

        tasks = (
            await session.execute(
                select(FulfillmentTask)
                .where(FulfillmentTask.order_item_id == order_item.id)
                .order_by(FulfillmentTask.created_at)
            )
        ).scalars().all()

        assert len(tasks) == 2

        first_task = tasks[0]
        assert first_task.task_type == FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION
        assert first_task.payload["execution"]["headers"]["X-Order-Number"] == "{{ order.order_number }}"
        assert first_task.payload["context"]["order"]["order_number"] == order.order_number
        assert first_task.payload["context"]["item"]["quantity"] == 2
        assert first_task.payload["execution"]["environment_keys"] == ["FULFILLMENT_BASE_URL"]
        assert first_task.payload["raw_payload"]["playbook"] == "baseline"

        second_task = tasks[1]
        assert second_task.task_type == FulfillmentTaskTypeEnum.CONTENT_PROMOTION
        assert second_task.payload["context"]["product"]["slug"] == product.slug
        assert second_task.payload["execution"]["body"]["order"] == "{{ order }}"


@pytest.mark.asyncio
async def test_process_order_fulfillment_skips_non_pending_order(session_factory):
    async with session_factory() as session:
        product = Product(
            slug="generic-service",
            title="Generic Service",
            description="Generic",
            category="other",
            base_price=Decimal("100.00"),
            currency=CurrencyEnum.EUR,
            status=ProductStatusEnum.ACTIVE,
        )

        order = Order(
            order_number="SM100002",
            subtotal=Decimal("100.00"),
            tax=Decimal("0"),
            total=Decimal("100.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )

        session.add(product)
        await session.flush()

        order.items.append(
            OrderItem(
                product_id=product.id,
                product_title=product.title,
                quantity=1,
                unit_price=Decimal("100.00"),
                total_price=Decimal("100.00"),
            )
        )

        session.add(order)
        await session.commit()

        service = FulfillmentService(session)
        result = await service.process_order_fulfillment(order.id)

        assert result is False
        stored_tasks = (
            await session.execute(select(FulfillmentTask).where(FulfillmentTask.order_item_id == order.items[0].id))
        ).scalars().all()
        assert stored_tasks == []


@pytest.mark.asyncio
async def test_update_task_status_tracks_retries(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM100003",
            subtotal=Decimal("150.00"),
            tax=Decimal("0"),
            total=Decimal("150.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            order=order,
            product_title="Retry Service",
            quantity=1,
            unit_price=Decimal("150.00"),
            total_price=Decimal("150.00"),
        )

        task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Deliver content",
            description="Deliver the configured content",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=5),
        )
        session.add(order)
        session.add(task)
        await session.commit()

        service = FulfillmentService(session)

        await service.update_task_status(
            task.id,
            FulfillmentTaskStatusEnum.IN_PROGRESS,
        )
        refreshed = await session.get(FulfillmentTask, task.id)
        assert refreshed.status == FulfillmentTaskStatusEnum.IN_PROGRESS
        assert refreshed.started_at is not None
        order_after_start = await session.get(Order, order.id)
        assert order_after_start.status == OrderStatusEnum.ACTIVE

        await service.update_task_status(
            task.id,
            FulfillmentTaskStatusEnum.FAILED,
            error_message="temporary failure",
        )
        refreshed = await session.get(FulfillmentTask, task.id)
        assert refreshed.status == FulfillmentTaskStatusEnum.FAILED
        assert refreshed.retry_count == 1
        assert refreshed.error_message == "temporary failure"
        order_after_failure = await session.get(Order, order.id)
        assert order_after_failure.status == OrderStatusEnum.ON_HOLD


@pytest.mark.asyncio
async def test_get_pending_tasks_filters_by_schedule(session_factory):
    async with session_factory() as session:
        order_id = uuid4()
        # Minimal order item to satisfy FK
        order = Order(
            id=order_id,
            order_number="SM100004",
            subtotal=Decimal("10.00"),
            tax=Decimal("0"),
            total=Decimal("10.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            order=order,
            product_title="Placeholder",
            quantity=1,
            unit_price=Decimal("10.00"),
            total_price=Decimal("10.00"),
        )

        due_task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Due task",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=1),
        )
        future_task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
            title="Future task",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() + timedelta(minutes=5),
        )
        session.add_all([order, order_item, due_task, future_task])
        await session.commit()

        service = FulfillmentService(session)
        pending = await service.get_pending_tasks()

        assert len(pending) == 1
        assert pending[0].title == "Due task"


@pytest.mark.asyncio
async def test_schedule_retry_updates_task(session_factory):
    async with session_factory() as session:
        user = User(
            email="fulfillment-retry@example.com",
            display_name="Retry Owner",
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
            marketing_messages=False,
        )
        session.add(preference)

        order_id = uuid4()
        order = Order(
            id=order_id,
            order_number="SM100010",
            subtotal=Decimal("150.00"),
            tax=Decimal("0"),
            total=Decimal("150.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            user_id=user.id,
        )
        order_item = OrderItem(
            order=order,
            product_title="Retry product",
            quantity=1,
            unit_price=Decimal("150.00"),
            total_price=Decimal("150.00"),
        )

        task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Retry me",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=10),
            max_retries=2,
            retry_count=0,
        )

        session.add_all([order, order_item, task])
        await session.commit()

        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()
        service = FulfillmentService(session, notification_service=notification_service)
        await service.schedule_retry(task, delay_seconds=120, error_message="transient issue")

        refreshed = await session.get(FulfillmentTask, task.id)
        assert refreshed.retry_count == 1
        assert refreshed.status == FulfillmentTaskStatusEnum.PENDING
        assert refreshed.error_message == "transient issue"
        assert refreshed.scheduled_at is not None
        assert refreshed.scheduled_at > datetime.utcnow()
        retry_events = [event for event in notification_service.sent_events if event.event_type == "fulfillment_retry"]
        assert retry_events
        last_retry = retry_events[-1]
        assert last_retry.metadata["order_number"] == order.order_number
        html_part = backend.sent_messages[-1].get_body(preferencelist=("html",))
        assert html_part is not None


@pytest.mark.asyncio
async def test_get_order_fulfillment_progress(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM100005",
            subtotal=Decimal("50.00"),
            tax=Decimal("0"),
            total=Decimal("50.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            order=order,
            product_title="Progress check",
            quantity=1,
            unit_price=Decimal("50.00"),
            total_price=Decimal("50.00"),
        )
        tasks = [
            FulfillmentTask(
                order_item=order_item,
                task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
                title="Complete",
                status=FulfillmentTaskStatusEnum.COMPLETED,
            ),
            FulfillmentTask(
                order_item=order_item,
                task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
                title="Failed",
                status=FulfillmentTaskStatusEnum.FAILED,
            ),
            FulfillmentTask(
                order_item=order_item,
                task_type=FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
                title="In progress",
                status=FulfillmentTaskStatusEnum.IN_PROGRESS,
            ),
        ]

        session.add_all([order, order_item, *tasks])
        await session.commit()

        service = FulfillmentService(session)
        progress = await service.get_order_fulfillment_progress(order.id)

        assert progress["order_id"] == str(order.id)
        assert progress["total_tasks"] == 3
        assert progress["completed_tasks"] == 1
        assert progress["failed_tasks"] == 1
        assert progress["in_progress_tasks"] == 1
        assert progress["progress_percentage"] == round(1 / 3 * 100, 2)


@pytest.mark.asyncio
async def test_update_task_status_marks_order_completed(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM100006",
            subtotal=Decimal("80.00"),
            tax=Decimal("0"),
            total=Decimal("80.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            order=order,
            product_title="Milestone service",
            quantity=1,
            unit_price=Decimal("80.00"),
            total_price=Decimal("80.00"),
        )
        task_a = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Phase A",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=5),
        )
        task_b = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
            title="Phase B",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=1),
        )

        session.add_all([order, order_item, task_a, task_b])
        await session.commit()

        service = FulfillmentService(session)
        await service.update_task_status(task_a.id, FulfillmentTaskStatusEnum.COMPLETED)
        intermediate_status = await session.get(Order, order.id)
        assert intermediate_status.status == OrderStatusEnum.ACTIVE

        await service.update_task_status(task_b.id, FulfillmentTaskStatusEnum.COMPLETED)
        final_status = await session.get(Order, order.id)
        assert final_status.status == OrderStatusEnum.COMPLETED


@pytest.mark.asyncio
async def test_fulfillment_completion_triggers_notifications(session_factory):
    async with session_factory() as session:
        user = User(
            email="progress@example.com",
            display_name="Progress Owner",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order = Order(
            order_number="SM100007",
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
            user_id=user.id,
        )
        order_item = OrderItem(
            order=order,
            product_title="Milestone",
            quantity=1,
            unit_price=Decimal("120.00"),
            total_price=Decimal("120.00"),
        )
        task_a = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Phase A",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=5),
        )
        task_b = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
            title="Phase B",
            status=FulfillmentTaskStatusEnum.PENDING,
            scheduled_at=datetime.utcnow() - timedelta(minutes=1),
        )
        session.add_all([order, order_item, task_a, task_b])
        await session.commit()

        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()
        service = FulfillmentService(session, notification_service=notification_service)

        await service.update_task_status(task_a.id, FulfillmentTaskStatusEnum.COMPLETED)
        await service.update_task_status(task_b.id, FulfillmentTaskStatusEnum.COMPLETED)

        completion_events = [event for event in notification_service.sent_events if event.event_type == "fulfillment_completion"]
        assert completion_events
        final_event = completion_events[-1]
        assert final_event.metadata["order_number"] == order.order_number
        assert backend.sent_messages
        html_body = backend.sent_messages[-1].get_body(preferencelist=("html",))
        assert html_body is not None
        status_events = [event for event in notification_service.sent_events if event.event_type == "order_status_update"]
        assert any(event.metadata.get("current_status") == OrderStatusEnum.COMPLETED.value for event in status_events)

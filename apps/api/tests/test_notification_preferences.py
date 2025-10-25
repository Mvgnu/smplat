import pytest
import pytest_asyncio
from decimal import Decimal
from uuid import uuid4
from datetime import datetime

from smplat_api.models.user import User
from smplat_api.models.order import Order, OrderStatusEnum, OrderSourceEnum
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.notification import NotificationPreference
from smplat_api.services.notifications import NotificationService


@pytest_asyncio.fixture
async def persisted_user(session_factory):
    async with session_factory() as session:
        user = User(
            id=uuid4(),
            email="client@example.com",
            display_name="Client Example",
        )
        session.add(user)
        await session.commit()
        yield user


@pytest_asyncio.fixture
async def persisted_order(session_factory, persisted_user):
    async with session_factory() as session:
        order = Order(
            id=uuid4(),
            order_number="SM000123",
            user_id=persisted_user.id,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("120.00"),
            tax=Decimal("0.00"),
            total=Decimal("120.00"),
            currency=CurrencyEnum.EUR,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(order)
        await session.commit()
        yield order


@pytest.mark.asyncio
async def test_order_status_notification_skips_when_preference_disabled(session_factory, persisted_user, persisted_order):
    async with session_factory() as session:
        preference = NotificationPreference(
            user_id=persisted_user.id,
            order_updates=False,
            payment_updates=True,
            fulfillment_alerts=True,
            marketing_messages=False,
        )
        session.add(preference)
        await session.commit()

        service = NotificationService(session)
        backend = service.use_in_memory_backend()

        await service.send_order_status_update(persisted_order)

        assert backend.sent_messages == []
        assert service.sent_events == []


@pytest.mark.asyncio
async def test_weekly_digest_respects_marketing_preference(session_factory):
    async with session_factory() as session:
        user = User(
            id=uuid4(),
            email="digest@example.com",
            display_name="Digest Owner",
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

        order = Order(
            id=uuid4(),
            order_number="SM900001",
            user_id=user.id,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("45.00"),
            tax=Decimal("0"),
            total=Decimal("45.00"),
            currency=CurrencyEnum.EUR,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(order)
        await session.commit()

        service = NotificationService(session)
        backend = service.use_in_memory_backend()

        await service.send_weekly_digest(
            user,
            highlighted_orders=[order],
            pending_actions=["Approve new Instagram assets"],
        )

        assert service.sent_events == []
        assert backend.sent_messages == []

        preference.marketing_messages = True
        await session.commit()

        await service.send_weekly_digest(
            user,
            highlighted_orders=[order],
            pending_actions=["Approve new Instagram assets"],
        )

        digest_events = [event for event in service.sent_events if event.event_type == "weekly_digest"]
        assert digest_events
        digest = digest_events[-1]
        assert digest.metadata["orders"] == [order.order_number]
        message = backend.sent_messages[-1]
        html_part = message.get_body(preferencelist=("html",))
        assert html_part is not None

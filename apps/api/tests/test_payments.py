from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict
from uuid import UUID, uuid4

from unittest.mock import AsyncMock

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.payment import Payment, PaymentProviderEnum, PaymentStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.payments.payment_service import PaymentService
from smplat_api.services.notifications import NotificationService
from smplat_api.models.notification import NotificationPreference


class _Result:
    def __init__(self, value: Payment | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Payment | None:
        return self._value


class DummySession:
    """Minimal async session double for PaymentService tests."""

    def __init__(self, payment: Payment) -> None:
        self._payment = payment
        self.committed = False
        self.flushed = False
        self.rollback_called = False

    async def execute(self, *_: Any, **__: Any) -> _Result:
        return _Result(self._payment)

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, obj: Any, attribute_names: list[str] | None = None) -> None:
        if attribute_names and "order" in attribute_names:
            obj.order = self._payment.order

    async def flush(self) -> None:
        self.flushed = True

    async def rollback(self) -> None:
        self.rollback_called = True

    # SQLAlchemy session interface compatibility stubs
    def add(self, _: Any) -> None:  # pragma: no cover - not used in current tests
        pass


def _build_order(total: Decimal = Decimal("100.00")) -> Order:
    order = Order(
        order_number="SM000001",
        status=OrderStatusEnum.PENDING,
        source=OrderSourceEnum.CHECKOUT,
        subtotal=total,
        tax=Decimal("0"),
        total=total,
        currency=CurrencyEnum.EUR,
    )
    order.id = uuid4()
    order.created_at = datetime.now(timezone.utc)
    order.updated_at = datetime.now(timezone.utc)
    return order


def _build_payment(order: Order) -> Payment:
    payment = Payment(
        order_id=order.id,
        provider=PaymentProviderEnum.STRIPE,
        provider_reference="pi_123",
        status=PaymentStatusEnum.PENDING,
        amount=Decimal("100.00"),
        currency=CurrencyEnum.EUR,
    )
    payment.id = uuid4()
    payment.order = order
    return payment


@pytest.mark.asyncio
async def test_payment_intent_success_triggers_fulfillment(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    observed_order_id: UUID | None = None

    async def fake_start(order_id: UUID) -> None:
        nonlocal observed_order_id
        observed_order_id = order_id

    monkeypatch.setattr(service, "_start_fulfillment", fake_start)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_record_webhook", AsyncMock())

    event = {
        "type": "payment_intent.succeeded",
        "id": "evt_123",
        "data": {
            "object": {
                "id": "pi_123",
                "amount_received": 10000,
                "created": 1_700_000_000,
            }
        },
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is True
    assert observed_order_id == order.id
    assert payment.status == PaymentStatusEnum.SUCCEEDED
    assert dummy_session.committed is True


@pytest.mark.asyncio
async def test_payment_intent_success_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    call_count = 0

    async def fake_start(order_id: UUID) -> None:
        nonlocal call_count
        call_count += 1

    monkeypatch.setattr(service, "_start_fulfillment", fake_start)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(side_effect=[False, True]))
    monkeypatch.setattr(service, "_record_webhook", AsyncMock())

    event = {
        "type": "payment_intent.succeeded",
        "id": "evt_repeat",
        "data": {
            "object": {
                "id": "pi_123",
                "amount_received": 10000,
                "created": 1_700_000_000,
            }
        },
    }

    result_first = await service.process_stripe_webhook_event(event)
    result_second = await service.process_stripe_webhook_event(event)

    assert result_first is True
    assert result_second is True
    assert call_count == 1
    assert payment.status == PaymentStatusEnum.SUCCEEDED


@pytest.mark.asyncio
async def test_payment_intent_success_handles_update_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    async def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("database error")

    monkeypatch.setattr(service, "update_payment_status", boom)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_record_webhook", AsyncMock())

    event = {
        "type": "payment_intent.succeeded",
        "id": "evt_321",
        "data": {
            "object": {
                "id": "pi_123",
                "amount_received": 10000,
                "created": 1_700_000_000,
            }
        },
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is False
    assert payment.status == PaymentStatusEnum.PENDING


@pytest.mark.asyncio
async def test_payment_intent_failure_marks_order_on_hold(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    order.notes = "Existing note"
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    async def fake_start(_: UUID) -> None:
        raise AssertionError("Fulfillment should not start for failed payments")

    monkeypatch.setattr(service, "_start_fulfillment", fake_start)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_record_webhook", AsyncMock())

    event = {
        "type": "payment_intent.payment_failed",
        "id": "evt_456",
        "data": {
            "object": {
                "id": "pi_123",
                "last_payment_error": {"message": "Card declined"},
            }
        },
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is True
    assert payment.status == PaymentStatusEnum.FAILED
    assert order.status == OrderStatusEnum.ON_HOLD
    assert "Payment failure" in (order.notes or "")
    assert dummy_session.flushed is True


@pytest.mark.asyncio
async def test_payment_intent_failure_handles_update_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    async def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("db write failed")

    monkeypatch.setattr(service, "update_payment_status", boom)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_record_webhook", AsyncMock())

    event = {
        "type": "payment_intent.payment_failed",
        "id": "evt_fail",
        "data": {"object": {"id": "pi_123", "last_payment_error": {"message": "Card declined"}}},
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is False
    assert payment.status == PaymentStatusEnum.PENDING


@pytest.mark.asyncio
async def test_webhook_failure_does_not_record_event(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    async def failing_handler(_: Dict[str, Any]) -> bool:
        return False

    record_mock = AsyncMock()

    monkeypatch.setattr(service, "_handle_payment_succeeded", failing_handler)
    monkeypatch.setattr(service, "_is_duplicate_webhook", AsyncMock(return_value=False))
    monkeypatch.setattr(service, "_record_webhook", record_mock)

    event = {
        "type": "payment_intent.succeeded",
        "id": "evt_no_record",
        "data": {"object": {"id": "pi_123", "amount_received": 10000, "created": 1_700_000_000}},
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is False
    record_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_unhandled_webhook_types_are_ignored() -> None:
    order = _build_order()
    payment = _build_payment(order)
    dummy_session = DummySession(payment)
    service = PaymentService(dummy_session)

    async def record(_: str, __: str) -> None:
        pass

    service._record_webhook = record  # type: ignore[assignment]

    async def is_dup(_: str) -> bool:
        return False

    service._is_duplicate_webhook = is_dup  # type: ignore[assignment]

    event = {
        "type": "customer.created",
        "id": "evt_999",
        "data": {"object": {"id": "cus_123"}},
    }

    result = await service.process_stripe_webhook_event(event)

    assert result is True
    assert payment.status == PaymentStatusEnum.PENDING


@pytest.mark.asyncio
async def test_create_payment_record_persists(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM500001",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("80.00"),
            tax=Decimal("0"),
            total=Decimal("80.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(order)
        await session.commit()
        await session.refresh(order)

        service = PaymentService(session)
        record = await service.create_payment_record(
            order_id=order.id,
            provider_reference="pi_db_1",
            amount=Decimal("80.00"),
            currency=CurrencyEnum.EUR,
        )

        stored = await session.get(Payment, record.id)
        assert stored is not None
        assert stored.status == PaymentStatusEnum.PENDING
        assert stored.order_id == order.id


@pytest.mark.asyncio
async def test_update_payment_status_marks_order_on_hold_in_db(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM500002",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("60.00"),
            tax=Decimal("0"),
            total=Decimal("60.00"),
            currency=CurrencyEnum.EUR,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_db_fail",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("60.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()

        service = PaymentService(session)
        await service.update_payment_status(
            provider_reference="pi_db_fail",
            status=PaymentStatusEnum.FAILED,
            failure_reason="declined",
        )

        refreshed_order = await session.get(Order, order.id)
        refreshed_payment = await session.get(Payment, payment.id)
        assert refreshed_order.status == OrderStatusEnum.ON_HOLD
        assert refreshed_payment.status == PaymentStatusEnum.FAILED
        assert "declined" in (refreshed_order.notes or "")


@pytest.mark.asyncio
async def test_payment_failure_sends_notification(session_factory):
    async with session_factory() as session:
        user = User(
            email="client@example.com",
            display_name="Client Test",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order = Order(
            order_number="SM500010",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("75.00"),
            tax=Decimal("0"),
            total=Decimal("75.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_notify_fail",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("75.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add_all([order, payment])
        await session.commit()

        service = PaymentService(session)
        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()
        service._notification_service = notification_service

        await service.update_payment_status(
            provider_reference="pi_notify_fail",
            status=PaymentStatusEnum.FAILED,
            failure_reason="card_declined",
        )

        assert len(notification_service.sent_events) == 1
        assert backend.sent_messages
        event = notification_service.sent_events[0]
        assert event.metadata["trigger"] == "payment_failure"
        message = backend.sent_messages[0]
        assert "SM500010" in message["Subject"]
        assert "On Hold" in message["Subject"]


@pytest.mark.asyncio
async def test_payment_success_sends_receipt(session_factory, monkeypatch: pytest.MonkeyPatch):
    async with session_factory() as session:
        user = User(
            email="client-success@example.com",
            display_name="Client Success",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order = Order(
            order_number="SM600001",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("99.00"),
            tax=Decimal("0"),
            total=Decimal("99.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_notify_success",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("99.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add_all([order, payment])
        await session.commit()

        service = PaymentService(session)
        notification_service = NotificationService(session)
        backend = notification_service.use_in_memory_backend()
        service._notification_service = notification_service
        monkeypatch.setattr(service, "_start_fulfillment", AsyncMock())

        await service.update_payment_status(
            provider_reference="pi_notify_success",
            status=PaymentStatusEnum.SUCCEEDED,
        )

        receipt_events = [event for event in notification_service.sent_events if event.event_type == "payment_success"]
        assert receipt_events
        receipt = receipt_events[-1]
        assert receipt.metadata["order_number"] == order.order_number
        message = backend.sent_messages[-1]
        html_body = message.get_body(preferencelist=("html",))
        assert html_body is not None
        assert "Payment received" in message["Subject"]


@pytest.mark.asyncio
async def test_payment_success_respects_preferences(session_factory, monkeypatch: pytest.MonkeyPatch):
    async with session_factory() as session:
        user = User(
            email="client-nopay@example.com",
            display_name="Client NoPay",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        preference = NotificationPreference(
            user_id=user.id,
            order_updates=True,
            payment_updates=False,
            fulfillment_alerts=True,
            marketing_messages=False,
        )
        session.add(preference)
        await session.flush()

        order = Order(
            order_number="SM600002",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("55.00"),
            tax=Decimal("0"),
            total=Decimal("55.00"),
            currency=CurrencyEnum.EUR,
            user_id=user.id,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_notify_skip",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("55.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add_all([order, payment])
        await session.commit()

        service = PaymentService(session)
        notification_service = NotificationService(session)
        notification_service.use_in_memory_backend()
        service._notification_service = notification_service
        monkeypatch.setattr(service, "_start_fulfillment", AsyncMock())

        await service.update_payment_status(
            provider_reference="pi_notify_skip",
            status=PaymentStatusEnum.SUCCEEDED,
        )

        assert all(event.event_type != "payment_success" for event in notification_service.sent_events)


@pytest.mark.asyncio
async def test_update_payment_status_success_triggers_fulfillment(session_factory, monkeypatch: pytest.MonkeyPatch):
    async with session_factory() as session:
        order = Order(
            order_number="SM500003",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            currency=CurrencyEnum.EUR,
        )
        payment = Payment(
            order=order,
            provider=PaymentProviderEnum.STRIPE,
            provider_reference="pi_db_success",
            status=PaymentStatusEnum.PENDING,
            amount=Decimal("120.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(payment)
        await session.commit()

        service = PaymentService(session)

        class StubFulfillment:
            def __init__(self):
                self.calls: list[UUID] = []

            async def process_order_fulfillment(self, order_id: UUID) -> bool:
                self.calls.append(order_id)
                return True

        stub = StubFulfillment()
        monkeypatch.setattr(PaymentService, "_get_fulfillment_service", lambda self: stub)

        await service.update_payment_status(
            provider_reference="pi_db_success",
            status=PaymentStatusEnum.SUCCEEDED,
        )

        refreshed_payment = await session.get(Payment, payment.id)
        assert refreshed_payment.status == PaymentStatusEnum.SUCCEEDED
        assert stub.calls == [order.id]

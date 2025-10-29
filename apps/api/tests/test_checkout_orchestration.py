from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.core.settings import settings
from smplat_api.jobs.checkout_recovery import monitor_checkout_orchestrations
from smplat_api.models.checkout import (
    CheckoutOrchestration,
    CheckoutOrchestrationEvent,
    CheckoutOrchestrationStage,
    CheckoutOrchestrationStatus,
)
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.loyalty import (
    LoyaltyCheckoutIntent,
    LoyaltyCheckoutIntentKind,
    LoyaltyCheckoutIntentStatus,
)
from smplat_api.models.order import Order, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.checkout import CheckoutOrchestrationService
from smplat_api.services.checkout.orchestrator import StageUpdate
from smplat_api.services.loyalty import LoyaltyService


@pytest.mark.asyncio
async def test_checkout_orchestration_state_machine_records_events(session_factory):
    async with session_factory() as session:
        user = User(
            email="customer@example.com",
            display_name="Casey Customer",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()
        order = Order(
            order_number="SM10001",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("100.00"),
            tax=Decimal("0.00"),
            total=Decimal("100.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(order)
        await session.commit()

        service = CheckoutOrchestrationService(session)
        orchestration = await service.get_or_create(order.id, user_id=user.id)
        await session.commit()
        await session.refresh(orchestration, attribute_names=["events"])

        assert orchestration.current_stage == CheckoutOrchestrationStage.PAYMENT
        assert orchestration.stage_status == CheckoutOrchestrationStatus.NOT_STARTED
        assert len(orchestration.events) == 1

        start_update = StageUpdate(
            stage=CheckoutOrchestrationStage.PAYMENT,
            status=CheckoutOrchestrationStatus.IN_PROGRESS,
            note="Payment initiated",
            metadata_patch={"attempt": 1},
        )
        await service.apply_update(orchestration, start_update)
        await service.apply_update(
            orchestration,
            StageUpdate(
                stage=CheckoutOrchestrationStage.PAYMENT,
                status=CheckoutOrchestrationStatus.COMPLETED,
                note="Payment confirmed",
            ),
        )
        await session.commit()
        await session.refresh(orchestration, attribute_names=["events"])

        assert orchestration.current_stage == CheckoutOrchestrationStage.VERIFICATION
        assert orchestration.stage_status == CheckoutOrchestrationStatus.NOT_STARTED
        assert orchestration.metadata_json["attempt"] == 1
        notes = {event.transition_note for event in orchestration.events}
        assert "Payment confirmed" in notes


@pytest.mark.asyncio
async def test_checkout_orchestration_api_endpoints(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "checkout-key"
    try:
        async with session_factory() as session:
            user = User(
                email="flow@example.com",
                display_name="Flow Customer",
                role=UserRoleEnum.CLIENT,
                status=UserStatusEnum.ACTIVE,
            )
            session.add(user)
            await session.flush()
            order = Order(
                order_number="SM20002",
                user_id=user.id,
                status=OrderStatusEnum.PENDING,
                source=OrderSourceEnum.CHECKOUT,
                subtotal=Decimal("55.00"),
                tax=Decimal("0.00"),
                total=Decimal("55.00"),
                currency=CurrencyEnum.EUR,
            )
            session.add(order)
            await session.commit()
            order_id = order.id

        async with AsyncClient(app=app, base_url="http://test") as client:
            headers = {"X-API-Key": settings.checkout_api_key}
            response = await client.get(f"/api/v1/checkout/orchestrations/{order_id}", headers=headers)
            assert response.status_code == 200
            body = response.json()
            assert body["orderId"] == str(order_id)
            assert body["currentStage"] == CheckoutOrchestrationStage.PAYMENT.value
            assert body["status"] == CheckoutOrchestrationStatus.NOT_STARTED.value

            payload = {
                "stage": CheckoutOrchestrationStage.PAYMENT.value,
                "status": CheckoutOrchestrationStatus.WAITING.value,
                "note": "Awaiting verification",
                "nextActionAt": datetime.now(timezone.utc).isoformat(),
                "metadataPatch": {
                    "lastRecoveryStage": CheckoutOrchestrationStage.PAYMENT.value
                },
            }
            update_response = await client.post(
                f"/api/v1/checkout/orchestrations/{order_id}/events",
                json=payload,
                headers=headers,
            )
            assert update_response.status_code == 200
            updated = update_response.json()
            assert updated["status"] == CheckoutOrchestrationStatus.WAITING.value
            assert updated["metadata"]["lastRecoveryStage"] == CheckoutOrchestrationStage.PAYMENT.value
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_checkout_recovery_job_dispatches_nudge(session_factory):
    async with session_factory() as session:
        user = User(
            email="recover@example.com",
            display_name="Recovery Customer",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()
        order = Order(
            order_number="SM30003",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("75.00"),
            tax=Decimal("0.00"),
            total=Decimal("75.00"),
            currency=CurrencyEnum.EUR,
        )
        session.add(order)
        await session.commit()

        loyalty_service = LoyaltyService(session)
        member = await loyalty_service.ensure_member(user.id)

        intent = LoyaltyCheckoutIntent(
            member_id=member.id,
            external_id="checkout-1",
            kind=LoyaltyCheckoutIntentKind.REDEMPTION,
            status=LoyaltyCheckoutIntentStatus.PENDING,
        )
        orchestration = CheckoutOrchestration(
            order_id=order.id,
            user_id=user.id,
            current_stage=CheckoutOrchestrationStage.PAYMENT,
            stage_status=CheckoutOrchestrationStatus.WAITING,
            next_action_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            metadata_json={"lastRecoveryStage": "seed"},
        )
        session.add_all([intent, orchestration])
        await session.commit()
        orchestration_id = orchestration.id

        intents_for_member = await loyalty_service.list_checkout_next_actions(member)
        assert len(intents_for_member) == 1

    summary = await monitor_checkout_orchestrations(session_factory=session_factory)
    assert summary["processed"] == 1
    assert summary["nudges_sent"] == 1

    async with session_factory() as session:
        refreshed = await session.get(CheckoutOrchestration, orchestration_id)
        assert refreshed is not None
        assert refreshed.next_action_at is not None
        next_action = refreshed.next_action_at
        if next_action.tzinfo is None:
            next_action = next_action.replace(tzinfo=timezone.utc)
        assert next_action > datetime.now(timezone.utc)
        assert refreshed.metadata_json.get("lastRecoverySweepAt") is not None
        events = (
            await session.execute(
                select(CheckoutOrchestrationEvent).where(
                    CheckoutOrchestrationEvent.orchestration_id == refreshed.id
                )
            )
        ).scalars().all()
        assert any(event.transition_note == "Recovery sweep executed" for event in events)

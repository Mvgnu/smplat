from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.models.loyalty import (
    LoyaltyLedgerEntryType,
    LoyaltyRedemption,
    LoyaltyRedemptionStatus,
    LoyaltyReward,
    LoyaltyTier,
)
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService


@pytest.mark.asyncio
async def test_member_snapshot_includes_progression(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        bronze = LoyaltyTier(slug="bronze", name="Bronze", point_threshold=Decimal("0"), benefits=["welcome"])
        silver = LoyaltyTier(slug="silver", name="Silver", point_threshold=Decimal("100"), benefits=["concierge"])
        user = User(email="snapshot@example.com")
        session.add_all([bronze, silver, user])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("50"),
            description="Initial activity",
        )
        await session.commit()

    async with AsyncClient(app=app, base_url="http://test") as client:
        user_id = str(user.id)
        # ensure member created and earn some points via referral completion
        response = await client.get(f"/api/v1/loyalty/members/{user_id}")
        assert response.status_code == 200
        snapshot = response.json()
        assert snapshot["currentTier"] == "bronze"
        assert snapshot["nextTier"] == "silver"
        assert isinstance(snapshot["expiringPoints"], list)
        assert "progressToNextTier" in snapshot


@pytest.mark.asyncio
async def test_redemption_endpoints_flow(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        tier = LoyaltyTier(slug="gold", name="Gold", point_threshold=Decimal("0"), benefits=[])
        user = User(email="redeem@example.com")
        reward = LoyaltyReward(slug="spa-day", name="Spa Day", cost_points=Decimal("25"))
        session.add_all([tier, user, reward])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("80"),
            description="Seed points",
        )
        await session.commit()

    async with AsyncClient(app=app, base_url="http://test") as client:
        user_id = str(user.id)

        create_resp = await client.post(
            f"/api/v1/loyalty/members/{user_id}/redemptions",
            json={"rewardSlug": "spa-day", "quantity": 1},
        )
        assert create_resp.status_code == 201
        redemption = create_resp.json()
        assert redemption["status"] == "requested"

        fulfill_resp = await client.post(
            f"/api/v1/loyalty/redemptions/{redemption['id']}/fulfill",
            json={"description": "Spa certificate"},
        )
        assert fulfill_resp.status_code == 200
        fulfilled = fulfill_resp.json()
        assert fulfilled["status"] == "fulfilled"

        member_resp = await client.get(f"/api/v1/loyalty/members/{user_id}")
        assert member_resp.status_code == 200
        member_payload = member_resp.json()
        assert member_payload["pointsOnHold"] == 0

        rewards_resp = await client.get("/api/v1/loyalty/rewards")
        assert rewards_resp.status_code == 200
        rewards = rewards_resp.json()
        assert any(item["slug"] == "spa-day" for item in rewards)


@pytest.mark.asyncio
async def test_checkout_intent_confirmation_is_idempotent(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        tier = LoyaltyTier(slug="platinum", name="Platinum", point_threshold=Decimal("0"), benefits=[])
        reward = LoyaltyReward(slug="vip-dinner", name="VIP Dinner", cost_points=Decimal("40"))
        user = User(email="checkout-intent@example.com")
        session.add_all([tier, reward, user])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("120"),
            description="Seed checkout balance",
        )
        member_id = member.id
        user_id = str(user.id)
        await session.commit()

    intent_id = uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    order_id = "order-checkout-123"

    async with AsyncClient(app=app, base_url="http://test") as client:
        payload = {
            "orderId": order_id,
            "action": "confirm",
            "userId": user_id,
            "intents": [
                {
                    "id": str(intent_id),
                    "kind": "redemption",
                    "createdAt": created_at,
                    "rewardSlug": "vip-dinner",
                    "pointsCost": 40,
                    "quantity": 1,
                    "metadata": {"note": "initial"},
                }
            ],
        }
        first_resp = await client.post("/api/v1/loyalty/checkout/intents", json=payload)
        assert first_resp.status_code == 204

        payload["intents"][0]["metadata"] = {"note": "updated"}
        second_resp = await client.post("/api/v1/loyalty/checkout/intents", json=payload)
        assert second_resp.status_code == 204

    async with session_factory() as session:
        stmt = select(LoyaltyRedemption).where(LoyaltyRedemption.member_id == member_id)
        result = await session.execute(stmt)
        redemptions = result.scalars().all()
        assert len(redemptions) == 1
        redemption = redemptions[0]
        assert redemption.status == LoyaltyRedemptionStatus.REQUESTED
        metadata = redemption.metadata_json or {}
        assert metadata.get("checkout_intent_id") == str(intent_id)
        assert metadata.get("order_id") == order_id
        assert metadata.get("note") == "updated"
        assert metadata.get("checkout_channel") == "checkout"


@pytest.mark.asyncio
async def test_checkout_intent_cancel_releases_redemption(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        tier = LoyaltyTier(slug="diamond", name="Diamond", point_threshold=Decimal("0"), benefits=[])
        reward = LoyaltyReward(slug="spa-suite", name="Spa Suite", cost_points=Decimal("60"))
        user = User(email="checkout-cancel@example.com")
        session.add_all([tier, reward, user])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("200"),
            description="Cancellation balance",
        )
        member_id = member.id
        user_id = str(user.id)
        await session.commit()

    intent_id = uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    order_id = "order-cancel-789"

    confirm_payload = {
        "orderId": order_id,
        "action": "confirm",
        "userId": user_id,
        "intents": [
            {
                "id": str(intent_id),
                "kind": "redemption",
                "createdAt": created_at,
                "rewardSlug": "spa-suite",
                "pointsCost": 60,
                "quantity": 1,
            }
        ],
    }

    cancel_payload = {
        "orderId": order_id,
        "action": "cancel",
        "userId": user_id,
        "intents": [confirm_payload["intents"][0]],
    }

    async with AsyncClient(app=app, base_url="http://test") as client:
        confirm_resp = await client.post("/api/v1/loyalty/checkout/intents", json=confirm_payload)
        assert confirm_resp.status_code == 204
        cancel_resp = await client.post("/api/v1/loyalty/checkout/intents", json=cancel_payload)
        assert cancel_resp.status_code == 204

    async with session_factory() as session:
        stmt = select(LoyaltyRedemption).where(LoyaltyRedemption.member_id == member_id)
        result = await session.execute(stmt)
        redemption = result.scalars().one()
        assert redemption.status == LoyaltyRedemptionStatus.CANCELLED
        metadata = redemption.metadata_json or {}
        assert metadata.get("checkout_intent_id") == str(intent_id)
        assert metadata.get("order_id") == order_id
        assert metadata.get("cancellationReason") == "checkout_intent_cancelled"

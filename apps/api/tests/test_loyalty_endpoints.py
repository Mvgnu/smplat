from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.models.loyalty import (
    LoyaltyCheckoutIntent,
    LoyaltyCheckoutIntentStatus,
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
        assert first_resp.status_code == 200
        first_payload = first_resp.json()
        assert first_payload["intents"]
        intent_snapshot = first_payload["intents"][0]
        assert intent_snapshot["clientIntentId"] == str(intent_id)
        assert intent_snapshot["metadata"]["note"] == "initial"
        assert first_payload["cards"][0]["id"] == intent_snapshot["id"]

        payload["intents"][0]["metadata"] = {"note": "updated"}
        second_resp = await client.post("/api/v1/loyalty/checkout/intents", json=payload)
        assert second_resp.status_code == 200
        second_payload = second_resp.json()
        assert len(second_payload["intents"]) == 1
        intent_after_update = second_payload["intents"][0]
        assert intent_after_update["metadata"]["note"] == "updated"
        assert intent_after_update["status"] == "pending"

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

        intent_stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member_id
        )
        intent_result = await session.execute(intent_stmt)
        stored_intent = intent_result.scalars().one()
        assert stored_intent.status == LoyaltyCheckoutIntentStatus.PENDING
        assert stored_intent.metadata_json.get("note") == "updated"


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
        assert confirm_resp.status_code == 200
        cancel_resp = await client.post("/api/v1/loyalty/checkout/intents", json=cancel_payload)
        assert cancel_resp.status_code == 200
        cancel_payload_body = cancel_resp.json()
        assert cancel_payload_body["intents"] == []
        assert cancel_payload_body["cards"] == []

    async with session_factory() as session:
        stmt = select(LoyaltyRedemption).where(LoyaltyRedemption.member_id == member_id)
        result = await session.execute(stmt)
        redemption = result.scalars().one()
        assert redemption.status == LoyaltyRedemptionStatus.CANCELLED
        metadata = redemption.metadata_json or {}
        assert metadata.get("checkout_intent_id") == str(intent_id)
        assert metadata.get("order_id") == order_id
        assert metadata.get("cancellationReason") == "checkout_intent_cancelled"

        intent_stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member_id
        )
        intent_result = await session.execute(intent_stmt)
        stored_intent = intent_result.scalars().one()
        assert stored_intent.status == LoyaltyCheckoutIntentStatus.CANCELLED
        assert stored_intent.resolved_at is not None


@pytest.mark.asyncio
async def test_checkout_next_actions_fetch_and_resolve(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        tier = LoyaltyTier(slug="emerald", name="Emerald", point_threshold=Decimal("0"), benefits=[])
        reward = LoyaltyReward(slug="emerald-retreat", name="Emerald Retreat", cost_points=Decimal("30"))
        user = User(email="next-actions@example.com")
        session.add_all([tier, reward, user])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("100"),
            description="Next action balance",
        )
        member_id = member.id
        user_id = str(user.id)
        await session.commit()

    intent_id = uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    order_id = "order-next-actions-456"

    confirm_payload = {
        "orderId": order_id,
        "action": "confirm",
        "userId": user_id,
        "intents": [
            {
                "id": str(intent_id),
                "kind": "redemption",
                "createdAt": created_at,
                "rewardSlug": "emerald-retreat",
                "pointsCost": 30,
                "quantity": 1,
            }
        ],
    }

    session_headers = {"X-Session-User": user_id}

    async with AsyncClient(app=app, base_url="http://test") as client:
        confirm_resp = await client.post("/api/v1/loyalty/checkout/intents", json=confirm_payload)
        assert confirm_resp.status_code == 200

        list_resp = await client.get("/api/v1/loyalty/next-actions", headers=session_headers)
        assert list_resp.status_code == 200
        payload = list_resp.json()
        assert len(payload["intents"]) == 1
        intent_record = payload["intents"][0]
        assert intent_record["clientIntentId"] == str(intent_id)
        assert payload["cards"][0]["headline"]

        resolve_resp = await client.post(
            f"/api/v1/loyalty/next-actions/{intent_record['id']}/resolve",
            json={"status": "resolved"},
            headers=session_headers,
        )
        assert resolve_resp.status_code == 200
        resolved_payload = resolve_resp.json()
        assert resolved_payload["status"] == "resolved"

        final_list = await client.get("/api/v1/loyalty/next-actions", headers=session_headers)
        assert final_list.status_code == 200
        assert final_list.json()["intents"] == []

    async with session_factory() as session:
        stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member_id
        )
        result = await session.execute(stmt)
        stored_intent = result.scalars().one()
        assert stored_intent.status == LoyaltyCheckoutIntentStatus.RESOLVED
        assert stored_intent.resolved_at is not None


@pytest.mark.asyncio
async def test_referral_share_intent_persistence(app_with_db) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        tier = LoyaltyTier(slug="ruby", name="Ruby", point_threshold=Decimal("0"), benefits=[])
        user = User(email="referral-intent@example.com")
        session.add_all([tier, user])
        await session.flush()
        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("50"),
            description="Referral intent balance",
        )
        member_id = member.id
        user_id = str(user.id)
        await session.commit()

    intent_id = uuid4()
    created_at = datetime.now(timezone.utc).isoformat()

    confirm_payload = {
        "orderId": "order-referral-001",
        "action": "confirm",
        "userId": user_id,
        "intents": [
            {
                "id": str(intent_id),
                "kind": "referral_share",
                "createdAt": created_at,
                "referralCode": "SHAREME123",
                "metadata": {"channel": "email"},
            }
        ],
    }

    session_headers = {"X-Session-User": user_id}

    async with AsyncClient(app=app, base_url="http://test") as client:
        confirm_resp = await client.post("/api/v1/loyalty/checkout/intents", json=confirm_payload)
        assert confirm_resp.status_code == 200
        confirm_body = confirm_resp.json()
        assert confirm_body["intents"][0]["kind"] == "referral_share"

        list_resp = await client.get("/api/v1/loyalty/next-actions", headers=session_headers)
        assert list_resp.status_code == 200
        payload = list_resp.json()
        assert payload["cards"][0]["kind"] == "referral_share"
        assert "Manage referrals" in payload["cards"][0]["ctaLabel"]

    async with session_factory() as session:
        stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member_id
        )
        result = await session.execute(stmt)
        stored_intent = result.scalars().one()
        assert stored_intent.status == LoyaltyCheckoutIntentStatus.PENDING
        assert stored_intent.referral_code == "SHAREME123"
        assert stored_intent.metadata_json.get("channel") == "email"

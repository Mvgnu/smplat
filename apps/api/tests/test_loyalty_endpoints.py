from decimal import Decimal

import pytest
from httpx import AsyncClient

from smplat_api.models.loyalty import LoyaltyLedgerEntryType, LoyaltyReward, LoyaltyTier
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

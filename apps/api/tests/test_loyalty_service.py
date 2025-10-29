import datetime as dt
import datetime as dt
from decimal import Decimal

import pytest

from sqlalchemy import select

from smplat_api.models.loyalty import (
    LoyaltyCheckoutIntent,
    LoyaltyCheckoutIntentKind,
    LoyaltyCheckoutIntentStatus,
    LoyaltyLedgerEntry,
    LoyaltyLedgerEntryType,
    LoyaltyNudge,
    LoyaltyNudgeStatus,
    LoyaltyPointExpiration,
    LoyaltyPointExpirationStatus,
    LoyaltyRedemption,
    LoyaltyRedemptionStatus,
    LoyaltyReward,
    LoyaltyTier,
)
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService


@pytest.mark.asyncio
async def test_redemption_flow(session_factory) -> None:
    async with session_factory() as session:
        service = LoyaltyService(session)

        tier = LoyaltyTier(slug="bronze", name="Bronze", point_threshold=Decimal("0"), benefits=[])
        user = User(email="member@example.com")
        session.add_all([tier, user])
        await session.flush()

        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("120"),
            description="Initial grant",
        )

        reward = LoyaltyReward(slug="coffee", name="Coffee", cost_points=Decimal("40"))
        session.add(reward)
        await session.flush()

        redemption = await service.create_redemption(member, reward_slug="coffee")
        assert redemption.status.value == "requested"
        assert Decimal(member.points_on_hold or 0) == Decimal("40")

        await service.fulfill_redemption(redemption, description="Coffee reward")
        await session.flush()
        await session.refresh(member)

        assert redemption.status.value == "fulfilled"
        assert Decimal(member.points_balance or 0) == Decimal("80")
        assert Decimal(member.points_on_hold or 0) == Decimal("0")

        ledger_entries = (await session.execute(select(LoyaltyLedgerEntry))).scalars().all()
        assert any(entry.entry_type == LoyaltyLedgerEntryType.REDEEM for entry in ledger_entries)


@pytest.mark.asyncio
async def test_expiration_job(session_factory) -> None:
    async with session_factory() as session:
        service = LoyaltyService(session)

        tier = LoyaltyTier(slug="silver", name="Silver", point_threshold=Decimal("0"), benefits=[])
        user = User(email="expiry@example.com")
        session.add_all([tier, user])
        await session.flush()

        member = await service.ensure_member(user.id)
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.EARN,
            amount=Decimal("50"),
            description="Initial earning",
        )

        expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
        await service.schedule_point_expiration(
            member,
            points=Decimal("20"),
            expires_at=expires_at,
            metadata={"source": "promo"},
        )
        await session.flush()

        expired = await service.expire_scheduled_points(reference_time=expires_at + dt.timedelta(days=1))
        await session.flush()
        assert len(expired) == 1
        assert expired[0].status == LoyaltyPointExpirationStatus.EXPIRED

        await session.refresh(member)
        assert Decimal(member.points_balance or 0) == Decimal("30")


@pytest.mark.asyncio
async def test_member_nudges_from_signals(session_factory) -> None:
    async with session_factory() as session:
        service = LoyaltyService(session)

        tier = LoyaltyTier(slug="gold", name="Gold", point_threshold=Decimal("0"), benefits=[])
        user = User(email="nudges@example.com")
        session.add_all([tier, user])
        await session.flush()

        member = await service.ensure_member(user.id)
        now = dt.datetime.now(dt.timezone.utc)

        expiration = LoyaltyPointExpiration(
            member_id=member.id,
            points=Decimal("125"),
            consumed_points=Decimal("0"),
            expires_at=now + dt.timedelta(days=3),
            status=LoyaltyPointExpirationStatus.SCHEDULED,
        )
        session.add(expiration)

        checkout_intent = LoyaltyCheckoutIntent(
            member_id=member.id,
            external_id="intent-001",
            kind=LoyaltyCheckoutIntentKind.REDEMPTION,
            status=LoyaltyCheckoutIntentStatus.PENDING,
            created_at=now - dt.timedelta(hours=2),
            expires_at=now + dt.timedelta(days=2),
            metadata_json={"rewardName": "Coffee Reward"},
        )
        session.add(checkout_intent)

        stalled_redemption = LoyaltyRedemption(
            member_id=member.id,
            status=LoyaltyRedemptionStatus.REQUESTED,
            points_cost=Decimal("500"),
            quantity=1,
            requested_at=now - dt.timedelta(days=4),
        )
        session.add(stalled_redemption)

        await session.flush()

        cards = await service.list_member_nudges(member, now=now)
        card_types = {card.nudge_type.value for card in cards}
        assert card_types == {
            "expiring_points",
            "checkout_reminder",
            "redemption_follow_up",
        }

        nudges = (await session.execute(select(LoyaltyNudge))).scalars().all()
        assert len(nudges) == 3

        target = nudges[0]
        await service.update_member_nudge_status(
            member,
            target.id,
            status=LoyaltyNudgeStatus.DISMISSED,
            now=now,
        )
        await session.flush()

        updated = await session.get(LoyaltyNudge, target.id)
        assert updated is not None
        assert updated.status == LoyaltyNudgeStatus.DISMISSED

        refreshed_cards = await service.list_member_nudges(member, now=now)
        refreshed_ids = {card.id for card in refreshed_cards}
        assert target.id not in refreshed_ids

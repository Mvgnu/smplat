"""Tests for loyalty scheduler jobs."""

import datetime as dt
from decimal import Decimal

import pytest

from sqlalchemy import select

from smplat_api.jobs.loyalty.nudges import aggregate_loyalty_nudges
from smplat_api.models.loyalty import (
    LoyaltyMember,
    LoyaltyNudge,
    LoyaltyPointExpiration,
    LoyaltyPointExpirationStatus,
    LoyaltyTier,
)
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService
from smplat_api.services.notifications import InMemoryEmailBackend, NotificationService


@pytest.mark.asyncio
async def test_loyalty_nudge_job_refreshes_and_dispatches(session_factory, monkeypatch) -> None:
    """Nudge aggregation job should persist nudges and dispatch notifications."""

    monkeypatch.setattr(
        NotificationService,
        "_build_default_backend",
        lambda self: InMemoryEmailBackend(),
    )

    async with session_factory() as session:
        service = LoyaltyService(session)

        tier = LoyaltyTier(slug="starter", name="Starter", point_threshold=Decimal("0"), benefits=[])
        user = User(email="nudge-member@example.com", display_name="Loyal Member")
        session.add_all([tier, user])
        await session.flush()

        preference = NotificationPreference(user_id=user.id, marketing_messages=True)
        session.add(preference)
        await session.flush()

        member = await service.ensure_member(user.id)
        now = dt.datetime.now(dt.timezone.utc)

        expiration = LoyaltyPointExpiration(
            member_id=member.id,
            points=Decimal("25"),
            consumed_points=Decimal("0"),
            expires_at=now + dt.timedelta(days=3),
            status=LoyaltyPointExpirationStatus.SCHEDULED,
        )
        session.add(expiration)
        await session.commit()

    summary = await aggregate_loyalty_nudges(session_factory=session_factory)

    assert summary["members_refreshed"] >= 1
    assert summary["nudges_refreshed"] >= 1
    assert summary["dispatch_attempts"] >= 1
    assert summary["notifications_sent"] == summary["dispatch_attempts"]

    async with session_factory() as session:
        nudges = (await session.execute(select(LoyaltyNudge))).scalars().all()
        assert len(nudges) >= 1
        for nudge in nudges:
            assert nudge.status.value == "active"
            assert nudge.last_triggered_at is not None

        member = (await session.execute(select(LoyaltyMember))).scalars().first()
        assert member is not None
        cards = await LoyaltyService(session).list_member_nudges(member, now=dt.datetime.now(dt.timezone.utc))
        assert cards

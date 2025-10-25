from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from smplat_api.models.customer_profile import CustomerProfile, CurrencyEnum
from smplat_api.models.fulfillment import InstagramAccount, InstagramAnalyticsSnapshot
from smplat_api.models.user import User
from smplat_api.services.fulfillment.instagram_service import InstagramService


async def _create_profile(session) -> CustomerProfile:
    user = User(email=f"owner-{uuid4()}@example.com")
    session.add(user)
    await session.commit()
    await session.refresh(user)

    profile = CustomerProfile(user_id=user.id, company_name="Test Co", preferred_currency=CurrencyEnum.EUR)
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


@pytest.mark.asyncio
async def test_verify_instagram_account_creates_account(session_factory, monkeypatch):
    async with session_factory() as session:
        profile = await _create_profile(session)

        async def fake_fetch(_self, username: str):
            return {
                "id": "insta-123",
                "username": username,
                "followers_count": 500,
                "following_count": 120,
                "media_count": 45,
                "is_business": True,
                "profile_picture_url": "https://example.com/pic.jpg",
                "biography": "bio",
                "website": None,
            }

        monkeypatch.setattr(InstagramService, "_fetch_basic_account_info", fake_fetch)

        service = InstagramService(session)
        data = await service.verify_instagram_account("agencyops", profile.id)

        assert data is not None
        assert data["username"] == "agencyops"

        account = (
            await session.execute(
                select(InstagramAccount).where(InstagramAccount.customer_profile_id == profile.id)
            )
        ).scalar_one()
        snapshots = (
            await session.execute(
                select(InstagramAnalyticsSnapshot).where(
                    InstagramAnalyticsSnapshot.instagram_account_id == account.id
                )
            )
        ).scalars().all()

        assert account.is_verified is True
        assert len(snapshots) == 1

        # Second verification should not create duplicate
        data_again = await service.verify_instagram_account("agencyops", profile.id)
        assert data_again["id"] == data["id"]
        accounts_again = (
            await session.execute(
                select(InstagramAccount).where(InstagramAccount.customer_profile_id == profile.id)
            )
        ).scalars().all()
        assert len(accounts_again) == 1


@pytest.mark.asyncio
async def test_update_account_analytics_creates_snapshot(session_factory, monkeypatch):
    async with session_factory() as session:
        profile = await _create_profile(session)

        account = InstagramAccount(
            customer_profile_id=profile.id,
            username="campaignops",
            instagram_user_id="insta-999",
            follower_count=100,
            following_count=50,
            media_count=10,
            is_verified=True,
            last_sync_at=datetime.utcnow(),
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)

        async def fake_metrics(_self, username: str):
            return {
                "followers_count": 150,
                "following_count": 70,
                "media_count": 20,
                "avg_likes": 40,
                "avg_comments": 5,
                "engagement_rate": 5.0,
                "reach": 1000,
                "impressions": 2000,
                "stories_count": 3,
                "reels_count": 6,
                "additional": {"profile_views": 120},
            }

        monkeypatch.setattr(InstagramService, "_fetch_account_metrics", fake_metrics)

        service = InstagramService(session)
        result = await service.update_account_analytics(account.id)
        assert result is True

        refreshed = await session.get(InstagramAccount, account.id)
        assert refreshed.follower_count == 150

        snapshots = (
            await session.execute(
                select(InstagramAnalyticsSnapshot).where(
                    InstagramAnalyticsSnapshot.instagram_account_id == account.id
                )
            )
        ).scalars().all()
        assert len(snapshots) == 1
        assert snapshots[0].engagement_rate == 500  # stored as percentage * 100


@pytest.mark.asyncio
async def test_update_account_analytics_missing_account(session_factory):
    async with session_factory() as session:
        service = InstagramService(session)
        result = await service.update_account_analytics(uuid4())
        assert result is False


@pytest.mark.asyncio
async def test_get_account_analytics_history_filters_by_days(session_factory):
    async with session_factory() as session:
        profile = await _create_profile(session)
        account = InstagramAccount(
            customer_profile_id=profile.id,
            username="historyaccount",
            instagram_user_id="hist-1",
            follower_count=100,
            following_count=50,
            media_count=10,
            is_verified=True,
            last_sync_at=datetime.utcnow(),
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)

        snapshots = [
            InstagramAnalyticsSnapshot(
                instagram_account_id=account.id,
                snapshot_date=datetime.utcnow() - timedelta(days=1),
                follower_count=150,
                following_count=60,
                avg_likes_per_post=10,
                avg_comments_per_post=2,
                engagement_rate=400,
                reach=1000,
                impressions=2000,
                posts_count=20,
                stories_count=2,
                reels_count=3,
            ),
            InstagramAnalyticsSnapshot(
                instagram_account_id=account.id,
                snapshot_date=datetime.utcnow() - timedelta(days=40),
                follower_count=120,
                following_count=55,
                avg_likes_per_post=8,
                avg_comments_per_post=1,
                engagement_rate=350,
                reach=800,
                impressions=1600,
                posts_count=18,
                stories_count=1,
                reels_count=2,
            ),
        ]
        session.add_all(snapshots)
        await session.commit()

        service = InstagramService(session)
        history = await service.get_account_analytics_history(account.id, days=30)

        assert len(history) == 1
        assert history[0]["followers"] == 150
        assert history[0]["engagement_rate"] == 4.0

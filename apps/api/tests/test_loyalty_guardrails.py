import datetime as dt
from decimal import Decimal

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.loyalty import ReferralInvite, ReferralStatus
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService


@pytest.mark.asyncio
async def test_guardrail_snapshot_and_override(app_with_db, monkeypatch) -> None:
    app, session_factory = app_with_db

    monkeypatch.setattr(settings, "referral_member_max_active_invites", 1, raising=False)
    monkeypatch.setattr(settings, "referral_member_invite_cooldown_seconds", 600, raising=False)

    async with session_factory() as session:
        user = User(email="guardrail@example.com")
        session.add(user)
        await session.flush()

        service = LoyaltyService(session)
        member = await service.ensure_member(user.id)

        invite_now = ReferralInvite(
            referrer_id=member.id,
            code="INVITE-A",
            status=ReferralStatus.SENT,
            reward_points=Decimal("100"),
            created_at=dt.datetime.now(dt.timezone.utc),
        )
        invite_pending = ReferralInvite(
            referrer_id=member.id,
            code="INVITE-B",
            status=ReferralStatus.DRAFT,
            reward_points=Decimal("50"),
            created_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5),
        )
        session.add_all([invite_now, invite_pending])
        await session.commit()
        user_id = user.id

    headers = {"X-API-Key": settings.checkout_api_key}

    async with AsyncClient(app=app, base_url="http://test") as client:
        snapshot_resp = await client.get("/api/v1/loyalty/guardrails", headers=headers)
        assert snapshot_resp.status_code == 200
        snapshot = snapshot_resp.json()
        assert snapshot["inviteQuota"] == 1
        assert snapshot["totalActiveInvites"] == 2
        assert snapshot["membersAtQuota"] == 1
        assert snapshot["cooldownSeconds"] == 600
        assert snapshot["cooldownRemainingSeconds"] is not None

        override_resp = await client.post(
            "/api/v1/loyalty/guardrails/overrides",
            headers=headers,
            json={
                "scope": "invite_cooldown",
                "justification": "Reduce cooldown for launch week",
                "actorUserId": str(user_id),
                "metadata": {"ticket": "OPS-42"},
            },
        )
        assert override_resp.status_code == 201
        override = override_resp.json()
        assert override["scope"] == "invite_cooldown"
        assert override["justification"] == "Reduce cooldown for launch week"
        assert override["isActive"] is True

        refreshed = await client.get("/api/v1/loyalty/guardrails", headers=headers)
        assert refreshed.status_code == 200
        data = refreshed.json()
        assert any(item["id"] == override["id"] for item in data["overrides"])
        assert data["throttleOverrideActive"] is False

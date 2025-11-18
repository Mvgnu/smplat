from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.core.settings import settings
from smplat_api.models.social_account import CustomerSocialAccount
from smplat_api.services.metrics.sourcer import MetricScraperClient


@pytest.mark.asyncio
async def test_validate_account_uses_scraper_payload(app_with_db, monkeypatch):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_base_url = settings.metric_scraper_api_base_url
    previous_token = settings.metric_scraper_api_token

    settings.checkout_api_key = "metric-key"
    settings.metric_scraper_api_base_url = "https://scraper.test"
    settings.metric_scraper_api_token = "fake-token"

    async def fake_fetch(self, platform, handle):
        assert platform.value == "instagram"
        assert handle == "brand"
        return {
            "accountId": "acct_123",
            "displayName": "Brand",
            "profileUrl": "https://instagram.com/brand",
            "avatarUrl": "https://cdn.test/avatar.jpg",
            "metrics": {
                "followers": 12345,
                "followingCount": 321,
                "avgLikes": 480,
                "avgComments": 32,
                "engagementRatePct": 3.2,
                "sampleSize": 20,
                "lastPostAt": "2024-01-01T12:00:00Z",
            },
            "qualityScore": 0.92,
            "latencyMs": 450,
        }

    monkeypatch.setattr(MetricScraperClient, "fetch_snapshot", fake_fetch, raising=False)

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/metrics/accounts/validate",
                json={"platform": "instagram", "handle": "@brand"},
                headers={"X-API-Key": "metric-key"},
            )
    finally:
        settings.checkout_api_key = previous_key
        settings.metric_scraper_api_base_url = previous_base_url
        settings.metric_scraper_api_token = previous_token

    assert response.status_code == 201
    body = response.json()
    assert body["account"]["handle"] == "brand"
    assert body["account"]["verificationStatus"] == "verified"
    assert body["snapshot"]["metrics"]["followerCount"] == 12345
    assert body["snapshot"]["metrics"]["avgLikes"] == 480
    assert body["snapshot"]["source"] == "scraper"

    async with session_factory() as session:
        result = await session.execute(select(CustomerSocialAccount))
        account = result.scalars().first()
        assert account is not None
        assert account.baseline_metrics["metrics"]["followerCount"] == 12345
        assert account.delivery_snapshots["latest"]["metrics"]["avgLikes"] == 480


@pytest.mark.asyncio
async def test_validate_account_manual_override(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    previous_base_url = settings.metric_scraper_api_base_url

    settings.checkout_api_key = "metric-key"
    settings.metric_scraper_api_base_url = None

    payload = {
        "platform": "tiktok",
        "handle": "creator",
        "manualMetrics": {
            "followers": 2200,
            "following": 150,
            "avgLikes": 90,
            "avgComments": 12,
            "engagementRatePct": 4.1,
            "sampleSize": 8,
        },
        "metadata": {"note": "manual-test"},
    }

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/metrics/accounts/validate",
                json=payload,
                headers={"X-API-Key": "metric-key"},
            )
    finally:
        settings.checkout_api_key = previous_key
        settings.metric_scraper_api_base_url = previous_base_url

    assert response.status_code == 201
    body = response.json()
    assert body["snapshot"]["metrics"]["followerCount"] == 2200
    assert body["snapshot"]["source"] == "manual"
    assert body["account"]["metadata"]["note"] == "manual-test"

    async with session_factory() as session:
        result = await session.execute(select(CustomerSocialAccount))
        account = result.scalars().first()
        assert account is not None
        assert account.platform.value == "tiktok"
        assert account.verification_status.value == "pending"

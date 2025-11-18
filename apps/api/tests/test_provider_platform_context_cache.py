from __future__ import annotations

import pytest
from httpx import AsyncClient

from smplat_api.services.providers.platform_context_cache import ProviderPlatformContextCacheService


@pytest.mark.asyncio
async def test_platform_context_cache_records_and_updates(session_factory):
    async with session_factory() as session:
        service = ProviderPlatformContextCacheService(session)
        await service.record_context(
            "provider-alpha",
            {"id": "instagram::@alpha", "label": "Instagram @alpha", "handle": "@alpha", "platformType": "instagram"},
        )
        await service.record_context(
            "provider-alpha",
            {"id": "instagram::@alpha", "label": "IG @alpha", "handle": "@alpha", "platformType": "instagram"},
        )
        mapping = await service.fetch_contexts_for_providers(["provider-alpha"])

    assert "provider-alpha" in mapping
    assert len(mapping["provider-alpha"]) == 1
    entry = mapping["provider-alpha"][0]
    assert entry.label == "IG @alpha"
    assert entry.platform_id == "instagram::@alpha"


@pytest.mark.asyncio
async def test_platform_context_endpoint_returns_cached_contexts(app_with_db):
    app, session_factory = app_with_db
    async with session_factory() as session:
        service = ProviderPlatformContextCacheService(session)
        await service.record_context(
            "provider-beta",
            {"id": "tiktok::@brand", "label": "TikTok @brand", "handle": "@brand", "platformType": "tiktok"},
        )
        await session.commit()

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/fulfillment/providers/platform-contexts",
            params=[("providerId", "provider-beta"), ("limit", "5")],
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload == [
        {
            "providerId": "provider-beta",
            "contexts": [
                {
                    "id": "tiktok::@brand",
                    "label": "TikTok @brand",
                    "handle": "@brand",
                    "platformType": "tiktok",
                }
            ],
        }
    ]

from __future__ import annotations

import httpx
import pytest

from smplat_api.jobs.fulfillment.provider_health import run_provider_health_snapshot
from smplat_api.models.fulfillment import (
    FulfillmentProvider,
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderStatusEnum,
    FulfillmentService,
    FulfillmentServiceStatusEnum,
)


@pytest.mark.asyncio
async def test_provider_health_snapshot_updates_provider_and_service(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-health",
            name="Health Provider",
            base_url="https://provider-health.test",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.UNKNOWN,
            metadata_json={"health": {"endpoint": "/health"}},
        )
        service = FulfillmentService(
            id="svc-health",
            provider_id=provider.id,
            name="Hero Boost",
            action="hero_boost",
            status=FulfillmentServiceStatusEnum.ACTIVE,
            metadata_json={"health": {"endpoint": "/service-health"}},
        )
        provider.services.append(service)
        session.add(provider)
        await session.commit()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if request.url.path == "/service-health":
            return httpx.Response(503, json={"status": "down"})
        return httpx.Response(404, json={"status": "unknown"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        summary = await run_provider_health_snapshot(
            session_factory=session_factory,
            http_client=client,
            concurrency=2,
        )

    assert summary["providers_checked"] == 1
    assert summary["healthy"] == 1

    async with session_factory() as session:
        refreshed_provider = await session.get(FulfillmentProvider, "prov-health")
        assert refreshed_provider is not None
        assert refreshed_provider.health_status == FulfillmentProviderHealthStatusEnum.HEALTHY
        assert refreshed_provider.health_payload["status_code"] == 200
        refreshed_service = await session.get(FulfillmentService, "svc-health")
        assert refreshed_service is not None
        assert refreshed_service.health_status == FulfillmentProviderHealthStatusEnum.OFFLINE
        assert refreshed_service.health_payload["status_code"] == 503


@pytest.mark.asyncio
async def test_provider_health_snapshot_inherits_when_no_service_endpoint(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-inherit",
            name="No Service Endpoint",
            base_url="https://provider-inherit.test",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.UNKNOWN,
            metadata_json={"health": {"endpoint": "/healthz"}},
        )
        service = FulfillmentService(
            id="svc-inherit",
            provider_id=provider.id,
            name="Followers",
            action="followers_plus",
            status=FulfillmentServiceStatusEnum.ACTIVE,
        )
        provider.services.append(service)
        session.add(provider)
        await session.commit()

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        await run_provider_health_snapshot(
            session_factory=session_factory,
            http_client=client,
            concurrency=1,
        )

    async with session_factory() as session:
        refreshed_service = await session.get(FulfillmentService, "svc-inherit")
        assert refreshed_service is not None
        assert refreshed_service.health_status == FulfillmentProviderHealthStatusEnum.HEALTHY
        assert refreshed_service.health_payload.get("inherited") is True

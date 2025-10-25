from __future__ import annotations

import pytest
from httpx import AsyncClient

from smplat_api.app import create_app
from smplat_api.core.settings import settings
from smplat_api.observability.catalog import get_catalog_store
from smplat_api.observability.fulfillment import get_fulfillment_store
from smplat_api.observability.payments import get_payment_store


@pytest.mark.asyncio
async def test_record_catalog_search_rejects_negative_results() -> None:
    app = create_app()
    store = get_catalog_store()
    store.reset()

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/observability/catalog-search",
            json={
                "query": "instagram",
                "category": "social",
                "sort": "price-asc",
                "results_count": -1,
            },
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_catalog_search_snapshot_requires_key() -> None:
    app = create_app()
    store = get_catalog_store()
    store.reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "snapshot-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/v1/observability/catalog-search")
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_prometheus_metrics_requires_key() -> None:
    app = create_app()
    store = get_catalog_store()
    store.reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "prom-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/v1/observability/prometheus")
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_record_and_retrieve_catalog_search_snapshot() -> None:
    app = create_app()
    store = get_catalog_store()
    store.reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "snapshot-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/observability/catalog-search",
                json={
                    "query": "instagram growth",
                    "category": "instagram",
                    "sort": "price-asc",
                    "results_count": 3,
                },
            )
            assert response.status_code == 202

            snapshot = await client.get(
                "/api/v1/observability/catalog-search",
                headers={"X-API-Key": "snapshot-key"},
            )

        assert snapshot.status_code == 200
        body = snapshot.json()
        assert body["totals"]["searches"] == 1
        assert body["categories"]["instagram"] == 1
        assert body["sorts"]["price-asc"] == 1
        assert body["queries"]["instagram growth"] == 1
        assert body["zero_result_queries"] == {}
        assert body["totals"]["zero_results"] == 0
        assert body["metrics"]["zero_results_rate"] == 0
        assert body["metrics"]["average_results_per_search"] == 3
        assert body["events"]["recent"][0]["results_count"] == 3
        assert body["events"]["last_results_count"] == 3
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_prometheus_metrics_output() -> None:
    app = create_app()
    get_catalog_store().reset()
    get_fulfillment_store().reset()
    get_payment_store().reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "prom-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            await client.post(
                "/api/v1/observability/catalog-search",
                json={"query": "instagram", "category": "instagram", "sort": "featured", "results_count": 5},
            )

            response = await client.get(
                "/api/v1/observability/prometheus",
                headers={"X-API-Key": "prom-key"},
            )

        assert response.status_code == 200
        body = response.text
        assert "smplat_catalog_search_total" in body
        assert "instagram" in body
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_catalog_zero_results_metrics() -> None:
    app = create_app()
    store = get_catalog_store()
    store.reset()

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "snapshot-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            await client.post(
                "/api/v1/observability/catalog-search",
                json={
                    "query": "no results",
                    "category": "instagram",
                    "sort": "featured",
                    "results_count": 0,
                },
            )
            await client.post(
                "/api/v1/observability/catalog-search",
                json={
                    "query": "still empty",
                    "category": "instagram",
                    "sort": "featured",
                    "results_count": 0,
                },
            )

            snapshot = await client.get(
                "/api/v1/observability/catalog-search",
                headers={"X-API-Key": "snapshot-key"},
            )

        assert snapshot.status_code == 200
        body = snapshot.json()
        assert body["totals"]["searches"] == 2
        assert body["totals"]["zero_results"] == 2
        assert body["metrics"]["zero_results_rate"] == 1
        assert body["metrics"]["average_results_per_search"] == 0
        assert body["zero_result_queries"]["no results"] == 1
        assert body["zero_result_queries"]["still empty"] == 1
    finally:
        settings.checkout_api_key = previous_key

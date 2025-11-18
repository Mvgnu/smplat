from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.services.analytics.experiment_analytics import (
    ExperimentConversionDigest,
    ExperimentConversionSnapshot,
)
from smplat_api.services.analytics import experiment_analytics


@pytest.mark.asyncio
async def test_list_conversion_metrics_paginates(app_with_db, monkeypatch):
    app, _ = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "reporting-key"

    metrics = [
        ExperimentConversionDigest(
            slug="alpha-launch",
            order_currency="USD",
            order_total=1500.0,
            order_count=5,
            journey_count=7,
            loyalty_points=4200,
            last_activity=datetime(2025, 1, 20, tzinfo=timezone.utc),
        ),
        ExperimentConversionDigest(
            slug="beta-launch",
            order_currency="EUR",
            order_total=900.0,
            order_count=3,
            journey_count=4,
            loyalty_points=1800,
            last_activity=datetime(2025, 1, 18, tzinfo=timezone.utc),
        ),
        ExperimentConversionDigest(
            slug="gamma-pilot",
            order_currency="USD",
            order_total=450.0,
            order_count=2,
            journey_count=3,
            loyalty_points=600,
            last_activity=None,
        ),
    ]

    async def fake_snapshot(self, *, limit=None, cursor=None, sample_size=500):
        start_index = 0
        if cursor:
            for index, entry in enumerate(metrics):
                if entry.slug == cursor:
                    start_index = index + 1
                    break
        sliced = metrics[start_index:]
        if limit is not None:
            sliced = sliced[:limit]
        next_cursor = None
        if limit is not None and start_index + len(sliced) < len(metrics) and sliced:
            next_cursor = sliced[-1].slug
        return ExperimentConversionSnapshot(metrics=sliced, cursor=cursor, next_cursor=next_cursor)

    monkeypatch.setattr(
        experiment_analytics.ExperimentAnalyticsService,
        "fetch_conversion_snapshot",
        fake_snapshot,
    )

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/reporting/onboarding/experiment-conversions",
                params={"limit": 2},
                headers={"X-API-Key": "reporting-key"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["metrics"][0]["slug"] == "alpha-launch"
        assert payload["metrics"][1]["slug"] == "beta-launch"
        assert payload["metrics"][0]["orderCurrency"] == "USD"
        assert payload["metrics"][0]["lastActivity"].startswith("2025-01-20")
        assert payload["nextCursor"] == "beta-launch"
        assert payload.get("cursor") is None

        async with AsyncClient(app=app, base_url="http://test") as client:
            response_next = await client.get(
                "/api/v1/reporting/onboarding/experiment-conversions",
                params={"cursor": payload["nextCursor"], "limit": 2},
                headers={"X-API-Key": "reporting-key"},
            )
        assert response_next.status_code == 200
        payload_next = response_next.json()
        assert len(payload_next["metrics"]) == 1
        assert payload_next["metrics"][0]["slug"] == "gamma-pilot"
        assert payload_next["nextCursor"] is None
        assert payload_next.get("cursor") == payload["nextCursor"]
    finally:
        settings.checkout_api_key = previous_key

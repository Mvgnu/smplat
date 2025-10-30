from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from smplat_api.models.pricing_experiments import (
    PricingExperiment,
    PricingExperimentMetric,
    PricingExperimentStatus,
)
from smplat_api.services.catalog.pricing import PricingExperimentService


# meta: module: pricing-experiments-tests


@pytest.mark.asyncio
async def test_create_and_list_pricing_experiments(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]],
) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        service = PricingExperimentService(session)
        snapshot = await service.create_experiment(
            slug="launch-offer",
            name="Launch Offer",
            description="Temporary launch pricing",
            target_product_slug="pro-social-boost",
            target_segment="referral",
            feature_flag_key="pricing_launch_offer",
            assignment_strategy="random_weighted",
            variants=[
                {
                    "key": "control",
                    "name": "Control",
                    "description": "Standard pricing",
                    "weight": 50,
                    "is_control": True,
                    "adjustment_kind": "delta",
                    "price_delta_cents": 0,
                },
                {
                    "key": "discount",
                    "name": "Discount",
                    "description": "5% discount",
                    "weight": 50,
                    "is_control": False,
                    "adjustment_kind": "multiplier",
                    "price_multiplier": 0.95,
                },
            ],
        )
        assert snapshot.slug == "launch-offer"
        assert snapshot.status == PricingExperimentStatus.DRAFT
        assert len(snapshot.variants) == 2

        listings = await service.list_experiments()
        assert len(listings) == 1
        assert listings[0].slug == "launch-offer"

    async with session_factory() as session:
        result = await session.execute(select(PricingExperiment))
        stored = result.scalars().all()
        assert len(stored) == 1
        assert stored[0].target_segment == "referral"


@pytest.mark.asyncio
async def test_record_pricing_event_updates_metrics(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]],
) -> None:
    app, session_factory = app_with_db

    async with session_factory() as session:
        service = PricingExperimentService(session)
        await service.create_experiment(
            slug="spring-offer",
            name="Spring Offer",
            description=None,
            target_product_slug="pro-social-boost",
            target_segment=None,
            feature_flag_key=None,
            assignment_strategy="random_weighted",
            variants=[
                {
                    "key": "control",
                    "name": "Control",
                    "description": None,
                    "weight": 100,
                    "is_control": True,
                    "adjustment_kind": "delta",
                    "price_delta_cents": 0,
                }
            ],
        )

        snapshot = await service.record_event(
            "spring-offer",
            "control",
            exposures=3,
            conversions=1,
            revenue_cents=12900,
            window_start=date.today(),
        )
        assert snapshot.variants[0].metrics[0].exposures == 3
        assert snapshot.variants[0].metrics[0].conversions == 1

    async with session_factory() as session:
        metric_stmt = await session.execute(select(PricingExperimentMetric))
        metrics = metric_stmt.scalars().all()
        assert len(metrics) == 1
        assert metrics[0].revenue_cents == 12900


@pytest.mark.asyncio
async def test_pricing_experiment_http_flow(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]],
) -> None:
    app, session_factory = app_with_db

    async with AsyncClient(app=app, base_url="http://test") as client:
        create_payload = {
            "slug": "holiday-offer",
            "name": "Holiday Offer",
            "description": "Seasonal price adjustments",
            "target_product_slug": "winter-bundle",
            "target_segment": "holiday",
            "feature_flag_key": "pricing_holiday_offer",
            "assignment_strategy": "random_weighted",
            "variants": [
                {
                    "key": "control",
                    "name": "Control",
                    "description": "Baseline pricing",
                    "weight": 50,
                    "is_control": True,
                    "adjustment_kind": "delta",
                    "price_delta_cents": 0,
                },
                {
                    "key": "bonus",
                    "name": "Bonus",
                    "description": "Adds loyalty bonus",
                    "weight": 50,
                    "is_control": False,
                    "adjustment_kind": "multiplier",
                    "price_multiplier": 1.1,
                },
            ],
        }

        create_response = await client.post(
            "/api/v1/catalog/pricing-experiments",
            json=create_payload,
        )
        assert create_response.status_code == 201
        created = create_response.json()
        assert created["slug"] == "holiday-offer"
        assert created["status"] == PricingExperimentStatus.DRAFT.value
        assert len(created["variants"]) == 2

        list_response = await client.get("/api/v1/catalog/pricing-experiments")
        assert list_response.status_code == 200
        listings = list_response.json()
        assert any(item["slug"] == "holiday-offer" for item in listings)

        update_response = await client.put(
            "/api/v1/catalog/pricing-experiments/holiday-offer",
            json={"status": PricingExperimentStatus.RUNNING.value},
        )
        assert update_response.status_code == 200
        assert update_response.json()["status"] == PricingExperimentStatus.RUNNING.value

        event_response = await client.post(
            "/api/v1/catalog/pricing-experiments/holiday-offer/events",
            json={
                "variant_key": "control",
                "exposures": 7,
                "conversions": 3,
                "revenue_cents": 4200,
            },
        )
        assert event_response.status_code == 200
        event_payload = event_response.json()
        control_variant = next(
            variant for variant in event_payload["variants"] if variant["key"] == "control"
        )
        assert control_variant["metrics"][0]["exposures"] == 7
        assert control_variant["metrics"][0]["conversions"] == 3

    async with session_factory() as session:
        result = await session.execute(select(PricingExperiment))
        stored = result.scalars().all()
        assert any(experiment.slug == "holiday-offer" for experiment in stored)


@pytest.mark.asyncio
async def test_pricing_experiment_event_requires_valid_variant(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]],
) -> None:
    app, _session_factory = app_with_db

    async with AsyncClient(app=app, base_url="http://test") as client:
        await client.post(
            "/api/v1/catalog/pricing-experiments",
            json={
                "slug": "invalid-event",
                "name": "Invalid Event",
                "description": None,
                "target_product_slug": "winter-bundle",
                "target_segment": None,
                "feature_flag_key": None,
                "assignment_strategy": "random_weighted",
                "variants": [
                    {
                        "key": "control",
                        "name": "Control",
                        "description": None,
                        "weight": 100,
                        "is_control": True,
                        "adjustment_kind": "delta",
                        "price_delta_cents": 0,
                    }
                ],
            },
        )

        response = await client.post(
            "/api/v1/catalog/pricing-experiments/invalid-event/events",
            json={"variant_key": "missing", "exposures": 1},
        )
        assert response.status_code == 404
        assert "Variant missing not found" in response.json()["detail"]

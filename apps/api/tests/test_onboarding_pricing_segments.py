from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from sqlalchemy import select

from smplat_api.models.onboarding import OnboardingEvent
from smplat_api.models.order import Order, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.orders.onboarding import OnboardingJourneyFilters, OnboardingService


@pytest.mark.asyncio
async def test_pricing_experiment_segments_deduplicate_variants(session_factory):
    async with session_factory() as session:
        user = User(
            email="segments@example.com",
            display_name="Segment Tester",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order = Order(
            order_number="SM40001",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("500.00"),
            tax=Decimal("0.00"),
            total=Decimal("500.00"),
            currency=CurrencyEnum.USD,
        )
        session.add(order)
        await session.commit()

        service = OnboardingService(session)
        journey = await service.ensure_journey(order.id)
        await session.commit()

    await service.record_pricing_experiment_segment(
        order.id,
        experiments=[
                {
                    "slug": "spring-offer",
                    "variantKey": "control",
                    "variantName": "Control",
                    "isControl": True,
                    "assignmentStrategy": "sequential",
                },
                {
                    "slug": "spring-offer",
                    "variantKey": "control",
                    "variantName": "Control",
                    "isControl": True,
                    "assignmentStrategy": "sequential",
                },
                {
                    "slug": "spring-offer",
                    "variantKey": "variant-a",
                    "variantName": "Variant A",
                    "isControl": False,
                    "assignmentStrategy": "sequential",
                },
            ],
    )
    await session.commit()

    result = await session.execute(select(OnboardingEvent))
    events = result.scalars().all()
    assert len(events) >= 1

    refreshed = await service.fetch_journey_by_id(journey.id)
    assert any(
        (event.metadata_json or {}).get("experiments")
        for event in refreshed.events
        if (
            getattr(event.event_type, "value", event.event_type)
            == "pricing_experiment_segment"
        )
    )
    segments = service.build_pricing_experiment_segments(refreshed)
    assert len(segments) == 2
    slugs = {(segment["slug"], segment["variant_key"]) for segment in segments}
    assert ("spring-offer", "control") in slugs
    assert ("spring-offer", "variant-a") in slugs


@pytest.mark.asyncio
async def test_operator_journey_filters_by_pricing_experiment(session_factory):
    async with session_factory() as session:
        user = User(
            email="filters@example.com",
            display_name="Filter Tester",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order_a = Order(
            order_number="SM50001",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("1000.00"),
            tax=Decimal("0.00"),
            total=Decimal("1000.00"),
            currency=CurrencyEnum.USD,
        )
        order_b = Order(
            order_number="SM50002",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("1100.00"),
            tax=Decimal("0.00"),
            total=Decimal("1100.00"),
            currency=CurrencyEnum.USD,
        )
        session.add_all([order_a, order_b])
        await session.commit()

        service = OnboardingService(session)
        await service.ensure_journey(order_a.id)
        await service.ensure_journey(order_b.id)
        await session.commit()

        await service.record_pricing_experiment_segment(
            order_a.id,
            experiments=[
                {
                    "slug": "spring-offer",
                    "variantKey": "control",
                }
            ],
        )
        await service.record_pricing_experiment_segment(
            order_b.id,
            experiments=[
                {
                    "slug": "spring-offer",
                    "variantKey": "variant-a",
                }
            ],
        )
        await session.commit()

        all_summaries = await service.list_journey_summaries()
        assert len(all_summaries) >= 2
        assert any(summary.pricing_experiments for summary in all_summaries)

        slug_filtered = await service.list_journey_summaries(
            filters=OnboardingJourneyFilters(experiment_slug="spring-offer")
        )
        assert len(slug_filtered) == 2

        variant_filtered = await service.list_journey_summaries(
            filters=OnboardingJourneyFilters(
                experiment_slug="spring-offer",
                experiment_variant="control",
            )
        )
        assert len(variant_filtered) == 1
        assert variant_filtered[0].order_id == order_a.id

        variant_only = await service.list_journey_summaries(
            filters=OnboardingJourneyFilters(experiment_variant="variant-a")
        )
        assert len(variant_only) == 1
        assert variant_only[0].order_id == order_b.id


@pytest.mark.asyncio
async def test_export_pricing_experiment_events_flattens_rows(session_factory):
    async with session_factory() as session:
        user = User(
            email="streamer@example.com",
            display_name="Stream Tester",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.flush()

        order = Order(
            order_number="SM60001",
            user_id=user.id,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("900.00"),
            tax=Decimal("0.00"),
            total=Decimal("900.00"),
            currency=CurrencyEnum.USD,
        )
        session.add(order)
        await session.commit()

        service = OnboardingService(session)
        await service.ensure_journey(order.id)
        await session.commit()

        await service.record_pricing_experiment_segment(
            order.id,
            experiments=[
                {
                    "slug": "spring-offer",
                    "variantKey": "control",
                    "assignmentStrategy": "sequential",
                    "status": "running",
                    "featureFlagKey": "pricing_lab",
                }
            ],
        )
        await service.record_pricing_experiment_segment(
            order.id,
            experiments=[
                {"slug": "spring-offer", "variantKey": "variant-b", "status": "paused"},
                {"slug": "summer-offer", "variantKey": "test", "featureFlagKey": None},
            ],
        )
        await session.commit()

        rows = await service.export_pricing_experiment_events(limit=10)
        assert len(rows) == 3
        slugs = {(row.slug, row.variant_key) for row in rows}
        assert ("spring-offer", "control") in slugs
        assert ("spring-offer", "variant-b") in slugs
        assert ("summer-offer", "test") in slugs
        assert any(row.feature_flag_key == "pricing_lab" for row in rows)
        assert any((row.status or "").lower() == "paused" for row in rows)

        first_row = rows[0]
        older_rows = await service.export_pricing_experiment_events(
            limit=5, cursor=first_row.recorded_at
        )
        assert all(candidate.recorded_at <= first_row.recorded_at for candidate in older_rows)


@pytest.mark.asyncio
async def test_ingest_success_payload_tracks_platform_context(session_factory):
    async with session_factory() as session:
        order = Order(
            order_number="SM61001",
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
            subtotal=Decimal("750.00"),
            tax=Decimal("0.00"),
            total=Decimal("750.00"),
            currency=CurrencyEnum.USD,
        )
        session.add(order)
        await session.commit()

        service = OnboardingService(session)
        await service.ingest_success_payload(
            order.id,
            checkout_payload={
                "referralCode": "SMREF-123",
                "platformContexts": [
                    {
                        "id": "instagram::@brand",
                        "label": "Instagram @brand",
                        "handle": "@brand",
                        "platformType": "instagram",
                    }
                ],
                "support": {"channel": "slack"},
            },
        )
        await session.commit()

        journey = await service.fetch_journey(order.id)
        assert journey is not None
        assert journey.referral_code == "SMREF-123"
        assert isinstance(journey.context, dict)
        contexts = journey.context.get("platform_contexts")
        assert isinstance(contexts, list)
        assert contexts[0]["id"] == "instagram::@brand"
        assert contexts[0]["platformType"] == "instagram"

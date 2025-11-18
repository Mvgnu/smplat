from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from smplat_api.services.analytics.experiment_analytics import ExperimentAnalyticsService
from smplat_api.services.orders.onboarding import OnboardingPricingExperimentEventRow, OnboardingService


@pytest.mark.asyncio
async def test_conversion_snapshot_groups_rows(monkeypatch, session_factory):
    now = datetime.now(timezone.utc)
    order_a = uuid4()
    order_b = uuid4()
    journey_a = uuid4()
    journey_b = uuid4()

    rows = [
        OnboardingPricingExperimentEventRow(
            event_id=uuid4(),
            journey_id=journey_a,
            order_id=order_a,
            order_number="SM100",
            slug="spring-offer",
            variant_key="control",
            variant_name="Control",
            is_control=True,
            assignment_strategy="sequential",
            status="active",
            feature_flag_key=None,
            recorded_at=now - timedelta(days=2),
            order_total=Decimal("500.00"),
            order_currency="USD",
            loyalty_projection_points=900,
        ),
        OnboardingPricingExperimentEventRow(
            event_id=uuid4(),
            journey_id=journey_b,
            order_id=order_b,
            order_number="SM101",
            slug="spring-offer",
            variant_key="promo",
            variant_name="Promo",
            is_control=False,
            assignment_strategy="random",
            status="active",
            feature_flag_key=None,
            recorded_at=now - timedelta(days=1),
            order_total=Decimal("750.00"),
            order_currency="USD",
            loyalty_projection_points=300,
        ),
        # Duplicate order to confirm dedupe logic.
        OnboardingPricingExperimentEventRow(
            event_id=uuid4(),
            journey_id=journey_b,
            order_id=order_b,
            order_number="SM101",
            slug="spring-offer",
            variant_key="promo",
            variant_name="Promo",
            is_control=False,
            assignment_strategy="random",
            status="active",
            feature_flag_key=None,
            recorded_at=now,
            order_total=Decimal("0"),
            order_currency="USD",
            loyalty_projection_points=0,
        ),
        OnboardingPricingExperimentEventRow(
            event_id=uuid4(),
            journey_id=uuid4(),
            order_id=uuid4(),
            order_number="SM200",
            slug="fall-offer",
            variant_key="control",
            variant_name="Control",
            is_control=True,
            assignment_strategy="sequential",
            status="active",
            feature_flag_key=None,
            recorded_at=now - timedelta(days=3),
            order_total=Decimal("400.00"),
            order_currency="EUR",
            loyalty_projection_points=120,
        ),
    ]

    async def fake_export(self, *, limit=500, cursor=None):
        return rows[:limit]

    monkeypatch.setattr(OnboardingService, "export_pricing_experiment_events", fake_export)

    async with session_factory() as session:
        service = ExperimentAnalyticsService(session)
        snapshot = await service.fetch_conversion_snapshot(limit=None)

    assert len(snapshot.metrics) == 2
    assert snapshot.metrics[0].slug == "spring-offer"
    assert snapshot.metrics[0].order_total == 1250.0
    assert snapshot.metrics[0].order_currency == "USD"
    assert snapshot.metrics[0].order_count == 2
    assert snapshot.metrics[0].journey_count == 2
    assert snapshot.metrics[0].loyalty_points == 1200
    assert snapshot.metrics[0].last_activity == rows[2].recorded_at

    assert snapshot.metrics[1].slug == "fall-offer"
    assert snapshot.metrics[1].order_total == 400.0
    assert snapshot.metrics[1].order_currency == "EUR"

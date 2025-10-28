"""Regression coverage for fulfillment trust metrics service."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.metric_cache import FulfillmentMetricCache
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.fulfillment.metrics import (
    FulfillmentMetricsService,
    MetricRequest,
    _CACHE,
    _utcnow,
)


@pytest.fixture(autouse=True)
def _reset_metric_cache():
    """Ensure each test executes without inheriting cached metric snapshots."""

    _CACHE.clear()
    yield
    _CACHE.clear()


async def _seed_order_with_item(session) -> tuple[Order, OrderItem]:
    product = Product(
        slug="trust-suite",
        title="Trust Suite",
        description="Observability add-on",
        category="fulfillment",
        base_price=Decimal("250.00"),
        currency=CurrencyEnum.EUR,
        status=ProductStatusEnum.ACTIVE,
    )

    session.add(product)
    await session.flush()

    order = Order(
        order_number="SMTST001",
        subtotal=Decimal("250.00"),
        tax=Decimal("0"),
        total=Decimal("250.00"),
        currency=CurrencyEnum.EUR,
        status=OrderStatusEnum.PROCESSING,
        source=OrderSourceEnum.CHECKOUT,
        created_at=datetime.now(timezone.utc) - timedelta(hours=4),
    )

    item = OrderItem(
        product_id=product.id,
        product_title=product.title,
        quantity=1,
        unit_price=product.base_price,
        total_price=product.base_price,
    )

    order.items.append(item)

    session.add(order)
    await session.flush()

    return order, item


@pytest.mark.asyncio
async def test_on_time_percentage_counts_completed_within_schedule(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        # On-time task
        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Baseline analytics",
                scheduled_at=now + timedelta(minutes=15),
                completed_at=now,
            )
        )

        # Late task
        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Engagement boost",
                scheduled_at=now - timedelta(minutes=15),
                completed_at=now,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_sla_on_time_pct")]
        )

        assert resolved.metric_id == "fulfillment_sla_on_time_pct"
        assert resolved.value == pytest.approx(0.5)
        assert resolved.sample_size == 2
        assert resolved.metadata["source"] == "fulfillment"
        assert resolved.metadata["on_time_tasks"] == 1
        assert resolved.provenance.source == "fulfillment"
        assert resolved.provenance.cache_layer == "computed"
        assert resolved.provenance.cache_refreshed_at is not None
        assert resolved.provenance.cache_expires_at is not None
        assert resolved.provenance.cache_ttl_minutes == 1440


@pytest.mark.asyncio
async def test_first_response_minutes_returns_average_delta(session_factory):
    async with session_factory() as session:
        order, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.INSTAGRAM_SETUP,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Setup",
                started_at=order.created_at + timedelta(minutes=30),
                completed_at=now,
            )
        )

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Follower growth",
                started_at=order.created_at + timedelta(minutes=60),
                completed_at=now,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics(
            [MetricRequest(metric_id="first_response_minutes")]
        )

        assert resolved.metric_id == "first_response_minutes"
        assert resolved.sample_size == 2
        assert resolved.value == pytest.approx(45.0)
        assert resolved.formatted_value == "45m"
        assert resolved.provenance.source == "support"
        assert resolved.provenance.cache_layer == "computed"
        assert resolved.provenance.cache_ttl_minutes == 360


@pytest.mark.asyncio
async def test_nps_trailing_30d_ignores_non_numeric_scores(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        valid_result = {"nps_score": 10}
        invalid_result = {"nps_score": "not-a-number"}

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Campaign analysis",
                completed_at=now - timedelta(days=1),
                result=valid_result,
            )
        )

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Old survey",
                completed_at=now - timedelta(days=10),
                result=invalid_result,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics([MetricRequest(metric_id="nps_trailing_30d")])

        assert resolved.metric_id == "nps_trailing_30d"
        assert resolved.sample_size == 1
        assert resolved.value == pytest.approx(10.0)
        assert resolved.formatted_value == "10.0"
        assert resolved.provenance.source == "fulfillment"
        assert resolved.provenance.cache_layer == "computed"
        assert resolved.provenance.cache_ttl_minutes == 1440


@pytest.mark.asyncio
async def test_backlog_minutes_reports_overdue_work(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                status=FulfillmentTaskStatusEnum.PENDING,
                title="Prep backlog",
                scheduled_at=now - timedelta(hours=3),
            )
        )

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
                status=FulfillmentTaskStatusEnum.IN_PROGRESS,
                title="Execution",
                scheduled_at=now - timedelta(minutes=45),
            )
        )

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
                status=FulfillmentTaskStatusEnum.PENDING,
                title="Future task",
                scheduled_at=now + timedelta(hours=1),
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_backlog_minutes")]
        )

        assert resolved.metric_id == "fulfillment_backlog_minutes"
        assert resolved.sample_size == 3
        assert resolved.metadata["overdue_task_count"] == 2
        assert resolved.metadata["outstanding_task_count"] == 3
        assert resolved.metadata["total_backlog_minutes"] > 0
        assert resolved.value == pytest.approx(
            resolved.metadata["total_backlog_minutes"], abs=1.0
        )
        assert resolved.metadata["average_backlog_minutes"] == pytest.approx(
            resolved.metadata["total_backlog_minutes"] / 2, abs=1.0
        )
        assert resolved.provenance.cache_layer == "computed"


@pytest.mark.asyncio
async def test_staffing_coverage_measures_completed_vs_scheduled(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        for offset_minutes in (60, 180, 360, 600):
            session.add(
                FulfillmentTask(
                    order_item_id=item.id,
                    task_type=FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION,
                    status=FulfillmentTaskStatusEnum.PENDING,
                    title=f"Scheduled {offset_minutes}",
                    scheduled_at=now - timedelta(minutes=offset_minutes),
                )
            )

        for offset_minutes in (30, 90, 180):
            session.add(
                FulfillmentTask(
                    order_item_id=item.id,
                    task_type=FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION,
                    status=FulfillmentTaskStatusEnum.COMPLETED,
                    title=f"Completed {offset_minutes}",
                    scheduled_at=now - timedelta(minutes=offset_minutes),
                    completed_at=now - timedelta(minutes=offset_minutes // 2),
                )
            )

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Completed last week",
                scheduled_at=now - timedelta(days=10),
                completed_at=now - timedelta(days=7),
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_staffing_coverage_pct")]
        )

        assert resolved.metric_id == "fulfillment_staffing_coverage_pct"
        assert resolved.sample_size == 4
        assert resolved.metadata["scheduled_tasks"] == 4
        assert resolved.metadata["completed_tasks"] == 3
        assert resolved.metadata["lookback_hours"] == 24
        assert resolved.value == pytest.approx(0.75, abs=0.05)
        assert resolved.formatted_value == "75%"
        assert resolved.provenance.cache_layer == "computed"


@pytest.mark.asyncio
async def test_persistent_cache_hydrates_when_memory_empty(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Cache hydration baseline",
                scheduled_at=now,
                completed_at=now,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)

        [initial] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_sla_on_time_pct")]
        )

        assert initial.provenance.cache_layer == "computed"

        _CACHE.clear()

        [hydrated] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_sla_on_time_pct")]
        )

        assert hydrated.value == initial.value
        assert hydrated.provenance.cache_layer == "persistent"
        assert hydrated.provenance.cache_refreshed_at == initial.provenance.cache_refreshed_at


@pytest.mark.asyncio
async def test_persistent_cache_recomputes_when_expired(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Cache eviction baseline",
                scheduled_at=now,
                completed_at=now,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)

        [initial] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_sla_on_time_pct")]
        )

        cache_entry = await session.get(FulfillmentMetricCache, "fulfillment_sla_on_time_pct")
        assert cache_entry is not None

        stale_timestamp = _utcnow() - timedelta(days=2)
        cache_entry.computed_at = stale_timestamp
        cache_entry.expires_at = _utcnow() - timedelta(minutes=1)
        await session.flush()

        _CACHE.clear()

        [recomputed] = await service.resolve_metrics(
            [MetricRequest(metric_id="fulfillment_sla_on_time_pct")]
        )

        assert recomputed.provenance.cache_layer == "computed"
        assert recomputed.computed_at is not None
        assert recomputed.computed_at > stale_timestamp
        assert recomputed.provenance.cache_refreshed_at != initial.provenance.cache_refreshed_at


@pytest.mark.asyncio
async def test_purge_cache_clears_memory_and_persistent(session_factory):
    async with session_factory() as session:
        _, item = await _seed_order_with_item(session)
        now = datetime.now(timezone.utc)

        session.add(
            FulfillmentTask(
                order_item_id=item.id,
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                status=FulfillmentTaskStatusEnum.COMPLETED,
                title="Purge baseline",
                scheduled_at=now,
                completed_at=now,
            )
        )

        await session.commit()

        service = FulfillmentMetricsService(session)

        await service.resolve_metrics([MetricRequest(metric_id="fulfillment_sla_on_time_pct")])

        assert "fulfillment_sla_on_time_pct" in _CACHE

        purged = await service.purge_cache(metric_id="fulfillment_sla_on_time_pct")

        assert purged == ["fulfillment_sla_on_time_pct"]
        assert "fulfillment_sla_on_time_pct" not in _CACHE
        assert await session.get(FulfillmentMetricCache, "fulfillment_sla_on_time_pct") is None


@pytest.mark.asyncio
async def test_unsupported_metric_reports_diagnostics(session_factory):
    async with session_factory() as session:
        service = FulfillmentMetricsService(session)

        [resolved] = await service.resolve_metrics([MetricRequest(metric_id="unknown_metric")])

        assert resolved.verification_state == "unsupported"
        assert resolved.provenance.cache_layer == "none"
        assert resolved.provenance.unsupported_reason == "metric_not_registered"
        assert resolved.provenance.notes


@pytest.mark.asyncio
async def test_unsupported_metric_returns_guardrail_response(session_factory):
    async with session_factory() as session:
        service = FulfillmentMetricsService(session)
        [resolved] = await service.resolve_metrics(
            [MetricRequest(metric_id="unknown_metric", freshness_window_minutes=60)]
        )

        assert resolved.metric_id == "unknown_metric"
        assert resolved.verification_state == "unsupported"
        assert resolved.metadata == {"source": "unknown"}
        assert resolved.sample_size == 0
        assert resolved.computed_at is None

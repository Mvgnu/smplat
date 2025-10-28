import datetime as dt
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from smplat_api.app import create_app
from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.catalog import CatalogBundle, CatalogBundleAcceptanceMetric
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.catalog.recommendations import CatalogRecommendationService


async def _seed_products(session: AsyncSession) -> tuple[Product, Product]:
    primary = Product(
        id=uuid4(),
        slug="instagram-growth",
        title="Instagram Growth",
        description="",
        category="social",
        base_price=Decimal("499.00"),
        currency=CurrencyEnum.EUR,
        status=ProductStatusEnum.ACTIVE,
    )
    upsell = Product(
        id=uuid4(),
        slug="tiktok-ads",
        title="TikTok Ads",
        description="",
        category="social",
        base_price=Decimal("399.00"),
        currency=CurrencyEnum.EUR,
        status=ProductStatusEnum.ACTIVE,
    )
    session.add_all([primary, upsell])
    await session.commit()
    return primary, upsell


async def _seed_bundle(
    session: AsyncSession,
    primary_slug: str,
    bundle_slug: str,
    title: str,
    cms_priority: int,
    components: list[str],
    acceptance_rate: float | None,
    acceptance_count: int,
) -> None:
    bundle = CatalogBundle(
        id=uuid4(),
        primary_product_slug=primary_slug,
        bundle_slug=bundle_slug,
        title=title,
        description=f"Bundle for {title}",
        savings_copy="Save 10%",
        cms_priority=cms_priority,
        components=components,
    )
    session.add(bundle)
    await session.flush()

    if acceptance_rate is not None:
        metric = CatalogBundleAcceptanceMetric(
            id=uuid4(),
            bundle_slug=bundle_slug,
            lookback_days=30,
            acceptance_rate=acceptance_rate,
            acceptance_count=acceptance_count,
            sample_size=max(acceptance_count * 2, 10),
            computed_at=dt.datetime.now(dt.timezone.utc),
        )
        session.add(metric)

    await session.commit()


async def _seed_queue_depth(session: AsyncSession, product: Product, task_count: int) -> None:
    order = Order(
        id=uuid4(),
        order_number=f"ORDER-{uuid4()}",
        user_id=None,
        status=OrderStatusEnum.ACTIVE,
        source=OrderSourceEnum.CHECKOUT,
        subtotal=Decimal("0"),
        tax=Decimal("0"),
        total=Decimal("0"),
        currency=CurrencyEnum.EUR,
    )
    session.add(order)
    await session.flush()

    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        product_id=product.id,
        product_title=product.title,
        quantity=1,
        unit_price=product.base_price,
        total_price=product.base_price,
    )
    session.add(order_item)
    await session.flush()

    for index in range(task_count):
        task = FulfillmentTask(
            id=uuid4(),
            order_item_id=order_item.id,
            task_type=FulfillmentTaskTypeEnum.FOLLOWER_GROWTH,
            status=FulfillmentTaskStatusEnum.PENDING,
            title=f"Task {index}",
        )
        session.add(task)

    await session.commit()


@pytest_asyncio.fixture
async def session_factory(app_with_db: tuple[Any, async_sessionmaker[AsyncSession]]):
    _, factory = app_with_db
    return factory


@pytest_asyncio.fixture
async def client(session_factory: async_sessionmaker[AsyncSession]):
    app = create_app()

    async def override_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[require_checkout_api_key] = lambda: None

    async with AsyncClient(app=app, base_url="http://test") as async_client:
        yield async_client, session_factory

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_recommendation_scoring_prefers_acceptance(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await CatalogRecommendationService.reset_cache()
        primary, upsell = await _seed_products(session)
        await _seed_bundle(
            session,
            primary.slug,
            "bundle-a",
            "Bundle A",
            cms_priority=60,
            components=[upsell.slug],
            acceptance_rate=0.22,
            acceptance_count=18,
        )
        await _seed_bundle(
            session,
            primary.slug,
            "bundle-b",
            "Bundle B",
            cms_priority=110,
            components=[upsell.slug],
            acceptance_rate=0.05,
            acceptance_count=4,
        )
        await _seed_queue_depth(session, upsell, task_count=3)

        service = CatalogRecommendationService(session)
        snapshot = await service.resolve(primary.slug)

        assert snapshot.recommendations
        assert snapshot.recommendations[0].slug == "bundle-a"
        assert snapshot.recommendations[0].heuristics.acceptance_rate == pytest.approx(0.22)
        assert snapshot.recommendations[0].heuristics.queue_depth == 3
        assert snapshot.cache_layer == "computed"


@pytest.mark.asyncio
async def test_resolve_uses_persistent_cache(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await CatalogRecommendationService.reset_cache()
        primary, upsell = await _seed_products(session)
        await _seed_bundle(
            session,
            primary.slug,
            "bundle-cache",
            "Bundle Cache",
            cms_priority=80,
            components=[upsell.slug],
            acceptance_rate=0.15,
            acceptance_count=12,
        )

        service = CatalogRecommendationService(session)
        first_snapshot = await service.resolve(primary.slug)
        assert first_snapshot.cache_layer == "computed"

        await CatalogRecommendationService.reset_cache()
        second_snapshot = await service.resolve(primary.slug)
        assert second_snapshot.cache_layer in {"persistent", "memory"}
        assert second_snapshot.recommendations[0].slug == "bundle-cache"


@pytest.mark.asyncio
async def test_catalog_recommendation_endpoint(client):
    async_client, session_factory = client
    async with session_factory() as session:
        await CatalogRecommendationService.reset_cache()
        primary, upsell = await _seed_products(session)
        await _seed_bundle(
            session,
            primary.slug,
            "bundle-api",
            "Bundle API",
            cms_priority=40,
            components=[upsell.slug],
            acceptance_rate=0.2,
            acceptance_count=20,
        )

    response = await async_client.post(
        "/api/v1/catalog/recommendations",
        json={"product_slug": "instagram-growth", "freshness_minutes": 10},
        headers={"X-API-Key": "test"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["product_slug"] == "instagram-growth"
    assert payload["recommendations"]
    recommendation = payload["recommendations"][0]
    assert recommendation["slug"] == "bundle-api"
    assert recommendation["metrics"]["acceptance_rate"] == pytest.approx(0.2)

import datetime as dt
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from smplat_api.models.catalog import CatalogBundle, CatalogBundleAcceptanceMetric
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.orders.acceptance import (
    BundleAcceptanceAggregator,
    BundleAcceptanceService,
)


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
    components: list[str],
) -> None:
    bundle = CatalogBundle(
        id=uuid4(),
        primary_product_slug=primary_slug,
        bundle_slug=bundle_slug,
        title=title,
        description=f"Bundle for {title}",
        savings_copy="Save 10%",
        cms_priority=80,
        components=components,
    )
    session.add(bundle)
    await session.commit()


async def _create_order(
    session: AsyncSession,
    product: Product,
    component: Product | None,
    *,
    include_component: bool,
    created_at: dt.datetime,
) -> None:
    order = Order(
        id=uuid4(),
        order_number=f"SM{uuid4().hex[:8].upper()}",
        user_id=None,
        status=OrderStatusEnum.PENDING,
        source=OrderSourceEnum.CHECKOUT,
        subtotal=Decimal("0"),
        tax=Decimal("0"),
        total=Decimal("0"),
        currency=CurrencyEnum.EUR,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(order)
    await session.flush()

    session.add(
        OrderItem(
            id=uuid4(),
            order_id=order.id,
            product_id=product.id,
            product_title=product.title,
            quantity=1,
            unit_price=product.base_price,
            total_price=product.base_price,
        )
    )

    if include_component and component is not None:
        session.add(
            OrderItem(
                id=uuid4(),
                order_id=order.id,
                product_id=component.id,
                product_title=component.title,
                quantity=1,
                unit_price=component.base_price,
                total_price=component.base_price,
            )
        )

    await session.commit()


@pytest_asyncio.fixture
async def session_factory(app_with_db: tuple[object, async_sessionmaker[AsyncSession]]):
    _, factory = app_with_db
    return factory


@pytest.mark.asyncio
async def test_record_order_acceptance_updates_metrics(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        primary, upsell = await _seed_products(session)
        await _seed_bundle(
            session,
            primary_slug=primary.slug,
            bundle_slug="bundle-alpha",
            title="Bundle Alpha",
            components=[upsell.slug],
        )

        service = BundleAcceptanceService(session)
        await service.record_order_acceptance([primary.slug, upsell.slug])
        await session.commit()

        metric = (
            await session.execute(select(CatalogBundleAcceptanceMetric).where(
                CatalogBundleAcceptanceMetric.bundle_slug == "bundle-alpha"
            ))
        ).scalar_one()

        assert metric.sample_size == 1
        assert metric.acceptance_count == 1
        assert metric.acceptance_rate == Decimal("1.0000")
        assert metric.last_accepted_at is not None


@pytest.mark.asyncio
async def test_aggregator_recomputes_metrics(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        primary, upsell = await _seed_products(session)
        await _seed_bundle(
            session,
            primary_slug=primary.slug,
            bundle_slug="bundle-beta",
            title="Bundle Beta",
            components=[upsell.slug],
        )

        now = dt.datetime.now(dt.timezone.utc)
        await _create_order(session, primary, upsell, include_component=True, created_at=now - dt.timedelta(days=2))
        await _create_order(session, primary, upsell, include_component=False, created_at=now - dt.timedelta(days=1))

        aggregator = BundleAcceptanceAggregator(session)
        await aggregator.recompute()
        await session.commit()

        metric = (
            await session.execute(select(CatalogBundleAcceptanceMetric).where(
                CatalogBundleAcceptanceMetric.bundle_slug == "bundle-beta"
            ))
        ).scalar_one()

        assert metric.sample_size == 2
        assert metric.acceptance_count == 1
        assert metric.acceptance_rate == Decimal("0.5000")
        assert metric.last_accepted_at is not None

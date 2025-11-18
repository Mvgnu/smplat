from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.social_account import (
    CustomerSocialAccount,
    SocialAccountVerificationStatus,
    SocialPlatformEnum,
)


@pytest.mark.asyncio
async def test_create_order_happy_path(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "test-key"

    try:
        async with session_factory() as session:
            product = Product(
                slug="instagram-growth",
                title="Instagram Growth Campaign",
                description="Service",
                category="instagram",
                base_price=Decimal("299.00"),
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)

        payload = {
            "items": [
                {
                    "product_id": str(product.id),
                    "product_title": product.title,
                    "quantity": 1,
                    "unit_price": 299.0,
                    "total_price": 299.0,
                    "selected_options": {"tier": "pro"},
                    "attributes": {"campaign": "launch"},
                    "platform_context": {
                        "id": "instagram::@brand",
                        "label": "Instagram",
                        "handle": "@brand",
                        "platformType": "instagram",
                    },
                }
            ],
            "currency": "EUR",
            "source": "checkout",
            "notes": "Automated test order",
        }

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/orders/",
                json=payload,
                headers={"X-API-Key": "test-key"},
            )

        assert response.status_code == 201
        body = response.json()
        assert body["order_number"].startswith("SM0000")
        assert len(body["items"]) == 1
        assert body["currency"] == "EUR"
        assert body["items"][0]["platform_context"]["label"] == "Instagram"

        async with session_factory() as session:
            stored_orders = (
                await session.execute(select(Order).options(selectinload(Order.items)))
            ).scalars().all()
            assert len(stored_orders) == 1
            assert stored_orders[0].items[0].product_id == product.id
            assert stored_orders[0].items[0].platform_context["handle"] == "@brand"
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_create_order_requires_api_key(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "secret"

    try:
        async with session_factory() as session:
            product = Product(
                slug="tiktok-growth",
                title="TikTok Growth Sprint",
                category="tiktok",
                base_price=Decimal("199.00"),
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)

        payload = {
            "items": [
                {
                    "product_id": str(product.id),
                    "product_title": product.title,
                    "quantity": 1,
                    "unit_price": 199.0,
                    "total_price": 199.0,
                }
            ]
        }

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post("/api/v1/orders/", json=payload)

        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_create_order_missing_product_returns_404(app_with_db):
    app, _session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "test-key"

    try:
        payload = {
            "items": [
                {
                    "product_id": str(uuid4()),
                    "product_title": "Unknown Product",
                    "quantity": 1,
                    "unit_price": 50.0,
                    "total_price": 50.0,
                }
            ],
            "currency": "EUR",
        }

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/orders/",
                json=payload,
                headers={"X-API-Key": "test-key"},
            )

        assert response.status_code == 404
        assert response.json()["detail"].startswith("Product not found")
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_update_order_status(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "secret-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM900001",
                subtotal=Decimal("25.00"),
                tax=Decimal("0"),
                total=Decimal("25.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.PENDING,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            order_id = order.id

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.patch(
                f"/api/v1/orders/{order_id}/status",
                json={"status": "completed", "notes": "Delivered", "actorType": "admin"},
                headers={"X-API-Key": "secret-key"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "completed"
        assert body["notes"] == "Delivered"

        async with session_factory() as session:
            stored = await session.get(Order, order_id)
            assert stored.status == OrderStatusEnum.COMPLETED
            assert stored.notes == "Delivered"
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_order_state_events_endpoint(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "timeline-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM900099",
                subtotal=Decimal("45.00"),
                tax=Decimal("0"),
                total=Decimal("45.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.PENDING,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            order_id = order.id

        async with AsyncClient(app=app, base_url="http://test") as client:
            await client.patch(
                f"/api/v1/orders/{order_id}/status",
                json={"status": "processing", "notes": "Started", "actorType": "operator"},
                headers={"X-API-Key": "timeline-key"},
            )
            events_response = await client.get(
                f"/api/v1/orders/{order_id}/state-events",
                headers={"X-API-Key": "timeline-key"},
            )

        assert events_response.status_code == 200
        body = events_response.json()
        assert len(body) >= 1
        assert body[0]["eventType"] == "state_change"
        assert body[0]["fromStatus"] == "pending"
        assert body[0]["toStatus"] == "processing"
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_order_delivery_proof_endpoint(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "proof-key"

    try:
        async with session_factory() as session:
            account = CustomerSocialAccount(
                platform=SocialPlatformEnum.INSTAGRAM,
                handle="brand",
                verification_status=SocialAccountVerificationStatus.VERIFIED,
                baseline_metrics={"metrics": {"followerCount": 1200}, "source": "scraper"},
                delivery_snapshots={
                    "latest": {"metrics": {"followerCount": 1500}, "source": "scraper"},
                    "history": [
                        {"metrics": {"followerCount": 1300}, "source": "scraper"},
                    ],
                },
            )
            session.add(account)
            await session.flush()

            order = Order(
                order_number="SM900888",
                subtotal=Decimal("99.00"),
                tax=Decimal("0"),
                total=Decimal("99.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.PROCESSING,
                source=OrderSourceEnum.CHECKOUT,
            )
            session.add(order)
            await session.flush()
            order_item = OrderItem(
                order_id=order.id,
                product_title="Instagram Growth",
                quantity=1,
                unit_price=Decimal("99.00"),
                total_price=Decimal("99.00"),
                customer_social_account_id=account.id,
            )
            session.add(order_item)
            await session.commit()

        order_id = str(order.id)

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/orders/{order_id}/delivery-proof",
                headers={"X-API-Key": "proof-key"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["orderId"] == order_id
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["account"]["handle"] == "brand"
        assert item["latest"]["metrics"]["followerCount"] == 1500
        assert len(item["history"]) == 1
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_delivery_proof_metrics_endpoint(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "metrics-key"

    try:
        async with session_factory() as session:
            product = Product(
                slug="instagram-growth",
                title="Instagram Growth Campaign",
                description="Service",
                category="instagram",
                base_price=Decimal("299.00"),
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
            session.add(product)
            await session.flush()
            order = Order(
                order_number="SM700999",
                subtotal=Decimal("299.00"),
                tax=Decimal("0"),
                total=Decimal("299.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.COMPLETED,
                source=OrderSourceEnum.CHECKOUT,
            )
            item = OrderItem(
                order=order,
                product_id=product.id,
                product_title=product.title,
                quantity=1,
                unit_price=Decimal("299.00"),
                total_price=Decimal("299.00"),
                platform_context={"platform": "instagram"},
                baseline_metrics={"metrics": {"followerCount": 1200}},
                delivery_snapshots={
                    "latest": {
                        "metrics": {"followerCount": 1550},
                        "recordedAt": "2025-01-10T12:00:00Z",
                    }
                },
            )
            session.add_all([order, item])
            await session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/orders/delivery-proof/metrics",
                headers={"X-API-Key": "metrics-key"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["products"], "Expected aggregate payload"
        product_entry = body["products"][0]
        assert product_entry["productId"] == str(product.id)
        assert product_entry["sampleSize"] == 1
        assert product_entry["platforms"] == ["instagram"]
        metric = product_entry["metrics"][0]
        assert metric["metricKey"] == "followerCount"
        assert metric["deltaAverage"] == pytest.approx(350.0)
        assert metric["formattedDelta"].startswith("+")
    finally:
        settings.checkout_api_key = previous_key


async def _seed_orders(session_factory):
    async with session_factory() as session:
        statuses = [
            (OrderStatusEnum.PENDING, 'SM900010'),
            (OrderStatusEnum.PROCESSING, 'SM900011'),
            (OrderStatusEnum.COMPLETED, 'SM900012'),
        ]
        created = []
        for idx, (status, number) in enumerate(statuses):
            order = Order(
                order_number=number,
                subtotal=Decimal('10.00') * (idx + 1),
                tax=Decimal('0'),
                total=Decimal('10.00') * (idx + 1),
                currency=CurrencyEnum.EUR,
                status=status,
                source=OrderSourceEnum.CHECKOUT,
            )
            order.created_at = datetime.now(timezone.utc) + timedelta(minutes=idx)
            order_item = OrderItem(
                product_title=f'Service {idx}',
                quantity=1,
                unit_price=Decimal('10.00') * (idx + 1),
                total_price=Decimal('10.00') * (idx + 1),
            )
            order.items.append(order_item)
            session.add(order)
            created.append((order.id, number, status))
        await session.commit()
        return created


@pytest.mark.asyncio
async def test_list_orders_returns_latest_first(app_with_db):
    app, session_factory = app_with_db
    await _seed_orders(session_factory)

    async with AsyncClient(app=app, base_url='http://test') as client:
        response = await client.get('/api/v1/orders/')

    assert response.status_code == 200
    body = response.json()
    assert [order['order_number'] for order in body] == ['SM900012', 'SM900011', 'SM900010']


@pytest.mark.asyncio
async def test_list_orders_filters_by_status(app_with_db):
    app, session_factory = app_with_db
    await _seed_orders(session_factory)

    async with AsyncClient(app=app, base_url='http://test') as client:
        response = await client.get('/api/v1/orders/', params={'status_filter': 'processing'})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]['status'] == 'processing'


@pytest.mark.asyncio
async def test_list_orders_pagination(app_with_db):
    app, session_factory = app_with_db
    await _seed_orders(session_factory)

    async with AsyncClient(app=app, base_url='http://test') as client:
        response = await client.get('/api/v1/orders/', params={'skip': 1, 'limit': 1})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]['order_number'] == 'SM900011'


@pytest.mark.asyncio
async def test_list_orders_invalid_status_returns_400(app_with_db):
    app, session_factory = app_with_db
    await _seed_orders(session_factory)

    async with AsyncClient(app=app, base_url='http://test') as client:
        response = await client.get('/api/v1/orders/', params={'status_filter': 'unknown'})

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_order_progress_requires_key(app_with_db):
    app, session_factory = app_with_db

    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "progress-key"

    async with session_factory() as session:
        order = Order(
            order_number="SM910000",
            subtotal=Decimal("120.00"),
            tax=Decimal("0"),
            total=Decimal("120.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PROCESSING,
            source=OrderSourceEnum.CHECKOUT,
        )
        order_item = OrderItem(
            order=order,
            product_title="Service",
            quantity=1,
            unit_price=Decimal("120.00"),
            total_price=Decimal("120.00"),
        )
        task = FulfillmentTask(
            order_item=order_item,
            task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
            title="Promo",
            status=FulfillmentTaskStatusEnum.IN_PROGRESS,
        )
        session.add_all([order, order_item, task])
        await session.commit()
        order_id = order.id

    async with AsyncClient(app=app, base_url='http://test') as client:
        response = await client.get(f'/api/v1/orders/{order_id}/progress')

    try:
        assert response.status_code == 401
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_get_order_progress_returns_rollup(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "progress-key"

    try:
        async with session_factory() as session:
            order = Order(
                order_number="SM910001",
                subtotal=Decimal("220.00"),
                tax=Decimal("0"),
                total=Decimal("220.00"),
                currency=CurrencyEnum.EUR,
                status=OrderStatusEnum.PROCESSING,
                source=OrderSourceEnum.CHECKOUT,
            )
            order_item = OrderItem(
                order=order,
                product_title="Analytics package",
                quantity=1,
                unit_price=Decimal("220.00"),
                total_price=Decimal("220.00"),
            )
            tasks = [
                FulfillmentTask(
                    order_item=order_item,
                    task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                    title="Collect baseline",
                    status=FulfillmentTaskStatusEnum.COMPLETED,
                ),
                FulfillmentTask(
                    order_item=order_item,
                    task_type=FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST,
                    title="Boost engagement",
                    status=FulfillmentTaskStatusEnum.IN_PROGRESS,
                ),
            ]
            session.add_all([order, order_item, *tasks])
            await session.commit()
            order_id = order.id

        async with AsyncClient(app=app, base_url='http://test') as client:
            response = await client.get(
                f'/api/v1/orders/{order_id}/progress',
                headers={'X-API-Key': 'progress-key'},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload['order_id'] == str(order_id)
        assert payload['total_tasks'] == 2
        assert payload['completed_tasks'] == 1
        assert payload['in_progress_tasks'] == 1
        assert payload['failed_tasks'] == 0
    finally:
        settings.checkout_api_key = previous_key

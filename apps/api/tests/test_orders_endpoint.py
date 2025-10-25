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

        async with session_factory() as session:
            stored_orders = (
                await session.execute(select(Order).options(selectinload(Order.items)))
            ).scalars().all()
            assert len(stored_orders) == 1
            assert stored_orders[0].items[0].product_id == product.id
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
            json={"status": "completed", "notes": "Delivered"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["notes"] == "Delivered"

    async with session_factory() as session:
        stored = await session.get(Order, order_id)
        assert stored.status == OrderStatusEnum.COMPLETED
        assert stored.notes == "Delivered"


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

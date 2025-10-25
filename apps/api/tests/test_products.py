from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient

from smplat_api.app import create_app
from smplat_api.api.v1.endpoints.products import get_product_service
from smplat_api.schemas.product import ProductCreate, ProductResponse, ProductStatus, ProductUpdate
from smplat_api.services.products import ProductService


@dataclass
class ProductStub:
    id: UUID
    slug: str
    title: str
    description: str | None
    category: str
    base_price: float
    currency: str
    status: str
    created_at: dt.datetime
    updated_at: dt.datetime


class FakeProductService(ProductService):
    def __init__(self, fixtures: list[ProductStub]):
        self._fixtures = fixtures

    async def list_products(self):  # type: ignore[override]
        return self._fixtures

    async def get_product_by_slug(self, slug: str):  # type: ignore[override]
        return next((item for item in self._fixtures if item.slug == slug), None)

    async def get_product_by_id(self, product_id: UUID):  # type: ignore[override]
        return next((item for item in self._fixtures if item.id == product_id), None)

    async def create_product(self, data: ProductCreate):  # type: ignore[override]
        now = dt.datetime.now(dt.timezone.utc)
        product = ProductStub(
            id=uuid4(),
            slug=data.slug,
            title=data.title,
            description=data.description,
            category=data.category,
            base_price=data.base_price,
            currency=data.currency.value if hasattr(data.currency, "value") else str(data.currency),
            status=data.status.value if hasattr(data.status, "value") else str(data.status),
            created_at=now,
            updated_at=now,
        )
        self._fixtures.append(product)
        return product

    async def update_product(self, product: ProductStub, data: ProductUpdate):  # type: ignore[override]
        if data.title is not None:
            product.title = data.title
        if data.description is not None:
            product.description = data.description
        if data.base_price is not None:
            product.base_price = data.base_price
        if data.status is not None:
            product.status = data.status.value if hasattr(data.status, "value") else str(data.status)
        if data.currency is not None:
            product.currency = data.currency.value if hasattr(data.currency, "value") else str(data.currency)
        product.updated_at = dt.datetime.now(dt.timezone.utc)
        return product

    async def delete_product(self, product_id: UUID):  # type: ignore[override]
        self._fixtures = [item for item in self._fixtures if item.id != product_id]


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    app = create_app()

    now = dt.datetime.now(dt.timezone.utc)
    fixtures = [
        ProductStub(
            id=uuid4(),
            slug="instagram-growth",
            title="Instagram Growth Campaign",
            description="High-impact growth sprint",
            category="instagram",
            base_price=299.0,
            currency="EUR",
            status="active",
            created_at=now,
            updated_at=now,
        )
    ]

    async def override_service():
        return FakeProductService(fixtures)

    app.dependency_overrides[get_product_service] = override_service

    async with AsyncClient(app=app, base_url="http://test") as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_products(client: AsyncClient) -> None:
    response = await client.get("/api/v1/products/")
    assert response.status_code == 200
    payload = [ProductResponse.model_validate(item) for item in response.json()]
    assert payload[0].slug == "instagram-growth"


@pytest.mark.asyncio
async def test_get_product(client: AsyncClient) -> None:
    response = await client.get("/api/v1/products/instagram-growth")
    assert response.status_code == 200
    data = ProductResponse.model_validate(response.json())
    assert data.title == "Instagram Growth Campaign"


@pytest.mark.asyncio
async def test_create_product(client: AsyncClient) -> None:
    payload = {
        "slug": "tiktok-growth",
        "title": "TikTok Growth Sprint",
        "category": "tiktok",
        "basePrice": 199.0,
        "currency": "EUR",
        "status": ProductStatus.ACTIVE.value
    }
    response = await client.post("/api/v1/products/", json=payload)
    assert response.status_code == 201
    data = ProductResponse.model_validate(response.json())
    assert data.slug == "tiktok-growth"


@pytest.mark.asyncio
async def test_update_product(client: AsyncClient) -> None:
    payload = {
        "title": "Instagram Growth Campaign+",
        "basePrice": 349.0,
        "status": ProductStatus.PROCESSING.value if hasattr(ProductStatus, "PROCESSING") else ProductStatus.ACTIVE.value
    }
    response = await client.get("/api/v1/products/instagram-growth")
    assert response.status_code == 200
    product = ProductResponse.model_validate(response.json())

    update_response = await client.patch(f"/api/v1/products/{product.id}", json=payload)
    assert update_response.status_code == 200
    updated = ProductResponse.model_validate(update_response.json())
    assert updated.title == "Instagram Growth Campaign+"
    assert updated.base_price == 349.0


@pytest.mark.asyncio
async def test_delete_product(client: AsyncClient) -> None:
    response = await client.get("/api/v1/products/instagram-growth")
    assert response.status_code == 200
    product = ProductResponse.model_validate(response.json())

    delete_response = await client.delete(f"/api/v1/products/{product.id}")
    assert delete_response.status_code == 204

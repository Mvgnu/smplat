from __future__ import annotations

from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import ProductStatusEnum
from smplat_api.schemas.product import ProductCreate, ProductUpdate
from smplat_api.services.products import ProductService


@pytest.mark.asyncio
async def test_product_service_crud(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        created = await service.create_product(
            ProductCreate(
                slug="ugc-lab",
                title="UGC Lab",
                description="Creator content pipeline",
                category="ugc",
                basePrice=120.00,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
        )

        fetched = await service.get_product_by_slug("ugc-lab")
        assert fetched is not None
        assert fetched.id == created.id

        updated = await service.update_product(
            fetched,
            ProductUpdate(title="UGC Lab+", basePrice=140.00),
        )
        assert updated.title == "UGC Lab+"
        assert float(updated.base_price) == 140.0

        all_products = await service.list_products()
        assert len(list(all_products)) == 1

        await service.delete_product(created.id)
        remaining = await service.list_products()
        assert list(remaining) == []


@pytest.mark.asyncio
async def test_product_service_prevents_duplicate_slug(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        await service.create_product(
            ProductCreate(
                slug="duplicate-slug",
                title="Original",
                category="core",
                basePrice=50.00,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
        )

        with pytest.raises(ValueError):
            await service.create_product(
                ProductCreate(
                    slug="duplicate-slug",
                    title="Clone",
                    category="core",
                    basePrice=75.00,
                    currency=CurrencyEnum.EUR,
                    status=ProductStatusEnum.ACTIVE,
                )
            )

from __future__ import annotations

from decimal import Decimal
from typing import Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models import Product
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import ProductOptionGroup, ProductStatusEnum
from smplat_api.schemas.product import ProductCreate, ProductUpdate


class ProductService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_products(self) -> Iterable[Product]:
        result = await self._session.execute(select(Product))
        return result.scalars().all()

    async def get_product_by_id(self, product_id: UUID) -> Product | None:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.option_groups).selectinload(ProductOptionGroup.options),
                selectinload(Product.add_ons),
                selectinload(Product.custom_fields),
                selectinload(Product.subscription_plans),
            )
            .where(Product.id == product_id)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def get_product_by_slug(self, slug: str) -> Product | None:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.option_groups).selectinload(ProductOptionGroup.options),
                selectinload(Product.add_ons),
                selectinload(Product.custom_fields),
                selectinload(Product.subscription_plans),
            )
            .where(Product.slug == slug)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def create_product(self, data: ProductCreate) -> Product:
        existing = await self.get_product_by_slug(data.slug)
        if existing:
            raise ValueError("Product with this slug already exists")

        product = Product(
            id=uuid4(),
            slug=data.slug,
            title=data.title,
            description=data.description,
            category=data.category,
            base_price=Decimal(str(data.base_price)),
            currency=data.currency,
            status=ProductStatusEnum(data.status.value if hasattr(data.status, "value") else data.status),
        )

        self._session.add(product)
        await self._session.commit()
        await self._session.refresh(product)
        return product

    async def update_product(self, product: Product, data: ProductUpdate) -> Product:
        for field in ["title", "description", "category"]:
            value = getattr(data, field)
            if value is not None:
                setattr(product, field, value)

        if data.base_price is not None:
            product.base_price = Decimal(str(data.base_price))

        if data.currency is not None:
            product.currency = data.currency

        if data.status is not None:
            product.status = ProductStatusEnum(data.status.value if hasattr(data.status, "value") else data.status)

        await self._session.commit()
        await self._session.refresh(product)
        return product

    async def delete_product(self, product_id: UUID) -> None:
        product = await self._session.get(Product, product_id)
        if not product:
            raise ValueError("Product not found")
        await self._session.delete(product)
        await self._session.commit()

from __future__ import annotations

from decimal import Decimal
from typing import Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models import Product
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import (
    ProductAuditLog,
    ProductMediaAsset,
    ProductOptionGroup,
    ProductStatusEnum,
)
from smplat_api.schemas.product import ProductCreate, ProductUpdate


class ProductService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_products(self) -> Iterable[Product]:
        stmt = select(Product).options(selectinload(Product.media_assets))
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_product_by_id(self, product_id: UUID) -> Product | None:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.option_groups).selectinload(ProductOptionGroup.options),
                selectinload(Product.add_ons),
                selectinload(Product.custom_fields),
                selectinload(Product.subscription_plans),
                selectinload(Product.media_assets),
                selectinload(Product.audit_logs),
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
                selectinload(Product.media_assets),
                selectinload(Product.audit_logs),
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
            channel_eligibility=self._normalize_channels(data.channel_eligibility),
        )

        self._session.add(product)
        await self._session.commit()
        await self._session.refresh(product)
        await self._record_audit(product, action="created", before=None, after=self._serialize_snapshot(product))
        await self._session.commit()
        return product

    async def update_product(self, product: Product, data: ProductUpdate) -> Product:
        before_state = self._serialize_snapshot(product)
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

        if data.channel_eligibility is not None:
            product.channel_eligibility = self._normalize_channels(data.channel_eligibility)

        await self._session.commit()
        await self._session.refresh(product)
        await self._record_audit(
            product,
            action="updated",
            before=before_state,
            after=self._serialize_snapshot(product),
        )
        await self._session.commit()
        return product

    async def delete_product(self, product_id: UUID) -> None:
        product = await self._session.get(Product, product_id)
        if not product:
            raise ValueError("Product not found")
        before_state = self._serialize_snapshot(product)
        await self._record_audit(
            product,
            action="deleted",
            before=before_state,
            after=None,
        )
        await self._session.delete(product)
        await self._session.commit()

    async def list_audit_logs(self, product_id: UUID) -> list[ProductAuditLog]:
        stmt = (
            select(ProductAuditLog)
            .where(ProductAuditLog.product_id == product_id)
            .order_by(ProductAuditLog.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def restore_from_audit(self, log_id: UUID) -> Product | None:
        log = await self._session.get(ProductAuditLog, log_id)
        if not log or not log.before_snapshot:
            return None

        product = await self.get_product_by_id(log.product_id)
        if not product:
            return None

        snapshot = log.before_snapshot
        product.title = snapshot.get("title", product.title)
        product.description = snapshot.get("description")
        product.category = snapshot.get("category", product.category)
        if (base_price := snapshot.get("base_price")) is not None:
            product.base_price = Decimal(str(base_price))
        currency_value = snapshot.get("currency")
        if currency_value is not None:
            try:
                product.currency = CurrencyEnum(currency_value)
            except ValueError:
                if isinstance(currency_value, str) and currency_value in CurrencyEnum.__members__:
                    product.currency = CurrencyEnum[currency_value]
        status_value = snapshot.get("status")
        if status_value is not None:
            try:
                product.status = ProductStatusEnum(status_value)
            except ValueError:
                if isinstance(status_value, str) and status_value in ProductStatusEnum.__members__:
                    product.status = ProductStatusEnum[status_value]
        if isinstance(snapshot.get("channel_eligibility"), list):
            product.channel_eligibility = self._normalize_channels(snapshot.get("channel_eligibility") or [])

        previous_after_snapshot = None
        if log.after_snapshot is not None:
            if isinstance(log.after_snapshot, dict):
                previous_after_snapshot = dict(log.after_snapshot)
            else:
                previous_after_snapshot = log.after_snapshot

        await self._session.commit()
        await self._session.refresh(product)
        await self._record_audit(
            product,
            action="restored",
            before=previous_after_snapshot,
            after=self._serialize_snapshot(product),
        )
        await self._session.commit()
        return product

    async def attach_media_asset(
        self,
        product: Product,
        *,
        label: str | None,
        asset_url: str,
        storage_key: str | None,
        metadata: dict | None = None,
    ) -> ProductMediaAsset:
        asset = ProductMediaAsset(
            id=uuid4(),
            product_id=product.id,
            label=label,
            asset_url=asset_url,
            storage_key=storage_key,
            metadata_json=metadata or {},
        )
        self._session.add(asset)
        await self._session.commit()
        await self._session.refresh(asset)
        await self._session.refresh(product)
        await self._record_audit(
            product,
            action="updated",
            before=None,
            after={"media_asset_id": str(asset.id), "asset_url": asset.asset_url},
        )
        await self._session.commit()
        return asset

    async def remove_media_asset(self, asset_id: UUID) -> None:
        asset = await self._session.get(ProductMediaAsset, asset_id)
        if not asset:
            return
        product = await self.get_product_by_id(asset.product_id)
        before_state = {"media_asset_id": str(asset.id), "asset_url": asset.asset_url}
        await self._session.delete(asset)
        await self._session.commit()
        if product:
            await self._record_audit(
                product,
                action="updated",
                before=before_state,
                after=None,
            )
            await self._session.commit()

    def _normalize_channels(self, value: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        normalized: list[str] = []
        for entry in value:
            if not isinstance(entry, str):
                continue
            channel = entry.strip().lower()
            if not channel or channel in seen:
                continue
            seen.add(channel)
            normalized.append(channel)
        return normalized

    async def _record_audit(
        self,
        product: Product,
        *,
        action: str,
        before: dict | None,
        after: dict | None,
    ) -> None:
        if not getattr(product, "id", None):
            return
        log = ProductAuditLog(
            id=uuid4(),
            product_id=product.id,
            action=action,
            before_snapshot=before,
            after_snapshot=after,
        )
        self._session.add(log)
        await self._session.flush()

    def _serialize_snapshot(self, product: Product) -> dict:
        return {
            "title": product.title,
            "description": product.description,
            "category": product.category,
            "base_price": float(product.base_price) if product.base_price is not None else None,
            "currency": product.currency.value
            if isinstance(product.currency, CurrencyEnum)
            else str(product.currency),
            "status": product.status.value
            if isinstance(product.status, ProductStatusEnum)
            else str(product.status),
            "channel_eligibility": list(product.channel_eligibility or []),
        }

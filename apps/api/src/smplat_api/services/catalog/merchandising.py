from __future__ import annotations

from typing import Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models import CatalogBundle


class CatalogBundleService:
    """CRUD helpers for deterministic merchandising bundles."""

    # meta: service: catalog-bundle
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_bundles(self) -> list[CatalogBundle]:
        stmt = select(CatalogBundle).order_by(CatalogBundle.created_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def list_for_product(self, primary_slug: str) -> list[CatalogBundle]:
        stmt = (
            select(CatalogBundle)
            .where(CatalogBundle.primary_product_slug == primary_slug)
            .order_by(CatalogBundle.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_by_id(self, bundle_id: UUID) -> CatalogBundle | None:
        return await self._session.get(CatalogBundle, bundle_id)

    async def get_by_slug(self, bundle_slug: str) -> CatalogBundle | None:
        stmt = select(CatalogBundle).where(CatalogBundle.bundle_slug == bundle_slug)
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def create_bundle(
        self,
        *,
        primary_product_slug: str,
        bundle_slug: str,
        title: str,
        description: str | None,
        savings_copy: str | None,
        cms_priority: int,
        components: Iterable[dict],
        metadata: dict | None,
    ) -> CatalogBundle:
        existing = await self.get_by_slug(bundle_slug)
        if existing:
            raise ValueError("Bundle slug already exists")

        bundle = CatalogBundle(
            id=uuid4(),
            primary_product_slug=primary_product_slug,
            bundle_slug=bundle_slug,
            title=title,
            description=description,
            savings_copy=savings_copy,
            cms_priority=cms_priority,
            components=list(components),
            metadata_json=metadata or {},
        )
        self._session.add(bundle)
        await self._session.commit()
        await self._session.refresh(bundle)
        return bundle

    async def update_bundle(
        self,
        bundle: CatalogBundle,
        *,
        title: str | None,
        description: str | None,
        savings_copy: str | None,
        cms_priority: int | None,
        components: Iterable[dict] | None,
        metadata: dict | None,
    ) -> CatalogBundle:
        if title is not None:
            bundle.title = title
        if description is not None:
            bundle.description = description
        if savings_copy is not None:
            bundle.savings_copy = savings_copy
        if cms_priority is not None:
            bundle.cms_priority = cms_priority
        if components is not None:
            bundle.components = list(components)
        if metadata is not None:
            bundle.metadata_json = metadata

        await self._session.commit()
        await self._session.refresh(bundle)
        return bundle

    async def delete_bundle(self, bundle: CatalogBundle) -> None:
        await self._session.delete(bundle)
        await self._session.commit()

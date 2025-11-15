from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.domain.fulfillment import provider_registry
from smplat_api.models.fulfillment import (
    FulfillmentProvider,
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderStatusEnum,
    FulfillmentProviderBalance,
    FulfillmentService,
    FulfillmentServiceStatusEnum,
)


UNSET = object()


class ProviderCatalogService:
    """CRUD helpers for the persisted fulfillment provider catalog."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_providers(self) -> Sequence[FulfillmentProvider]:
        stmt = (
            select(FulfillmentProvider)
            .options(
                selectinload(FulfillmentProvider.services),
                selectinload(FulfillmentProvider.balance_snapshot),
            )
            .order_by(FulfillmentProvider.name.asc())
        )
        result = await self._session.execute(stmt)
        return result.scalars().unique().all()

    async def get_provider(self, provider_id: str) -> FulfillmentProvider | None:
        stmt = (
            select(FulfillmentProvider)
            .options(
                selectinload(FulfillmentProvider.services),
                selectinload(FulfillmentProvider.balance_snapshot),
            )
            .where(FulfillmentProvider.id == provider_id)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def create_provider(
        self,
        *,
        provider_id: str,
        name: str,
        description: str | None = None,
        base_url: str | None = None,
        allowed_regions: Iterable[str] | None = None,
        credentials: dict | None = None,
        metadata: dict | None = None,
        rate_limit_per_minute: int | None = None,
        status: FulfillmentProviderStatusEnum = FulfillmentProviderStatusEnum.ACTIVE,
        health_status: FulfillmentProviderHealthStatusEnum = FulfillmentProviderHealthStatusEnum.UNKNOWN,
    ) -> FulfillmentProvider:
        provider = FulfillmentProvider(
            id=provider_id,
            name=name,
            description=description,
            base_url=base_url,
            allowed_regions=list(allowed_regions or []),
            credentials=credentials,
            metadata_json=metadata,
            rate_limit_per_minute=rate_limit_per_minute,
            status=status,
            health_status=health_status,
        )
        self._session.add(provider)
        await self._session.commit()
        await provider_registry.refresh_catalog(self._session, force=True)
        return provider

    async def update_provider(
        self,
        provider: FulfillmentProvider,
        *,
        name: str | None | object = UNSET,
        description: str | None | object = UNSET,
        base_url: str | None | object = UNSET,
        allowed_regions: Iterable[str] | None | object = UNSET,
        credentials: dict | None | object = UNSET,
        metadata: dict | None | object = UNSET,
        rate_limit_per_minute: int | None | object = UNSET,
        status: FulfillmentProviderStatusEnum | None | object = UNSET,
        health_status: FulfillmentProviderHealthStatusEnum | None | object = UNSET,
        last_health_check_at: object = UNSET,
        health_payload: dict | None | object = UNSET,
    ) -> FulfillmentProvider:
        if name is not UNSET:
            provider.name = name
        if description is not UNSET:
            provider.description = description
        if base_url is not UNSET:
            provider.base_url = base_url
        if allowed_regions is not UNSET:
            provider.allowed_regions = list(allowed_regions or [])
        if credentials is not UNSET:
            provider.credentials = credentials
        if metadata is not UNSET:
            provider.metadata_json = metadata
        if rate_limit_per_minute is not UNSET:
            provider.rate_limit_per_minute = rate_limit_per_minute
        if status is not UNSET:
            provider.status = status
        if health_status is not UNSET:
            provider.health_status = health_status
        if last_health_check_at is not UNSET:
            provider.last_health_check_at = last_health_check_at
        if health_payload is not UNSET:
            provider.health_payload = health_payload

        await self._session.commit()
        await self._session.refresh(provider)
        await provider_registry.refresh_catalog(self._session, force=True)
        return provider

    async def delete_provider(self, provider: FulfillmentProvider) -> None:
        await self._session.delete(provider)
        await self._session.commit()
        await provider_registry.refresh_catalog(self._session, force=True)

    async def create_service(
        self,
        *,
        service_id: str,
        provider: FulfillmentProvider,
        name: str,
        action: str,
        category: str | None = None,
        default_currency: str | None = None,
        allowed_regions: Iterable[str] | None = None,
        credentials: dict | None = None,
        metadata: dict | None = None,
        rate_limit_per_minute: int | None = None,
        status: FulfillmentServiceStatusEnum = FulfillmentServiceStatusEnum.ACTIVE,
    ) -> FulfillmentService:
        service = FulfillmentService(
            id=service_id,
            provider_id=provider.id,
            name=name,
            action=action,
            category=category,
            default_currency=default_currency,
            allowed_regions=list(allowed_regions or []),
            credentials=credentials,
            metadata_json=metadata,
            rate_limit_per_minute=rate_limit_per_minute,
            status=status,
        )
        self._session.add(service)
        await self._session.commit()
        await provider_registry.refresh_catalog(self._session, force=True)
        return service

    async def record_health_snapshot(
        self,
        provider: FulfillmentProvider,
        *,
        provider_status: FulfillmentProviderHealthStatusEnum,
        provider_payload: Mapping[str, Any],
        service_statuses: Mapping[str, tuple[FulfillmentProviderHealthStatusEnum, Mapping[str, Any]]] | None,
        checked_at: datetime,
        refresh_registry: bool = True,
    ) -> None:
        provider.health_status = provider_status
        provider.last_health_check_at = checked_at
        provider.health_payload = dict(provider_payload)

        statuses = service_statuses or {}
        for service in provider.services:
            status, payload = statuses.get(
                service.id,
                (
                    provider_status,
                    {
                        "inherited": True,
                        "providerStatus": provider_status.value
                        if hasattr(provider_status, "value")
                        else str(provider_status),
                    },
                ),
            )
            service.health_status = status
            service.last_health_check_at = checked_at
            service.health_payload = dict(payload)

        await self._session.commit()
        if refresh_registry:
            await provider_registry.refresh_catalog(self._session, force=True)

    async def record_balance_snapshot(
        self,
        provider: FulfillmentProvider,
        *,
        amount: float | None,
        currency: str | None,
        payload: Mapping[str, Any] | None,
        retrieved_at: datetime,
    ) -> None:
        snapshot = provider.balance_snapshot
        if snapshot is None:
            snapshot = FulfillmentProviderBalance(
                provider_id=provider.id,
            )
            self._session.add(snapshot)
            provider.balance_snapshot = snapshot

        snapshot.balance_amount = amount
        snapshot.currency = currency.upper() if isinstance(currency, str) else None
        snapshot.payload = dict(payload) if payload else None
        snapshot.retrieved_at = retrieved_at

        await self._session.commit()
        await self._session.refresh(provider)

    async def update_service(
        self,
        service: FulfillmentService,
        *,
        name: str | None | object = UNSET,
        action: str | None | object = UNSET,
        category: str | None | object = UNSET,
        default_currency: str | None | object = UNSET,
        allowed_regions: Iterable[str] | None | object = UNSET,
        credentials: dict | None | object = UNSET,
        metadata: dict | None | object = UNSET,
        rate_limit_per_minute: int | None | object = UNSET,
        status: FulfillmentServiceStatusEnum | None | object = UNSET,
        health_status: FulfillmentProviderHealthStatusEnum | None | object = UNSET,
        last_health_check_at: object = UNSET,
        health_payload: dict | None | object = UNSET,
    ) -> FulfillmentService:
        if name is not UNSET:
            service.name = name
        if action is not UNSET:
            service.action = action
        if category is not UNSET:
            service.category = category
        if default_currency is not UNSET:
            service.default_currency = default_currency
        if allowed_regions is not UNSET:
            service.allowed_regions = list(allowed_regions or [])
        if credentials is not UNSET:
            service.credentials = credentials
        if metadata is not UNSET:
            service.metadata_json = metadata
        if rate_limit_per_minute is not UNSET:
            service.rate_limit_per_minute = rate_limit_per_minute
        if status is not UNSET:
            service.status = status
        if health_status is not UNSET:
            service.health_status = health_status
        if last_health_check_at is not UNSET:
            service.last_health_check_at = last_health_check_at
        if health_payload is not UNSET:
            service.health_payload = health_payload

        await self._session.commit()
        await self._session.refresh(service)
        await provider_registry.refresh_catalog(self._session, force=True)
        return service

    async def delete_service(self, service: FulfillmentService) -> None:
        await self._session.delete(service)
        await self._session.commit()
        await provider_registry.refresh_catalog(self._session, force=True)

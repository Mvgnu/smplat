"""Dynamic registry of fulfillment providers and services backed by persistence.

This module maintains an in-process cache of provider/service metadata sourced
from the database. Callers that mutate the catalog should trigger
``refresh_catalog`` to keep the cache current.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Mapping, Optional, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import (
    FulfillmentProvider,
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderStatusEnum,
    FulfillmentService,
    FulfillmentServiceStatusEnum,
)

_CACHE_TTL_SECONDS = 900  # 15 minutes


@dataclass(frozen=True, slots=True)
class FulfillmentProviderDescriptor:
    """Immutable descriptor for an external fulfillment provider."""

    id: str
    name: str
    region: str | None = None
    base_url: str | None = None
    description: str | None = None
    status: str = FulfillmentProviderStatusEnum.INACTIVE.value
    health_status: str = FulfillmentProviderHealthStatusEnum.UNKNOWN.value
    allowed_regions: Tuple[str, ...] = field(default_factory=tuple)
    rate_limit_per_minute: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    credentials: Mapping[str, Any] | None = None
    last_health_check_at: datetime | None = None
    health_payload: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class FulfillmentServiceDescriptor:
    """Immutable descriptor for a provider-specific service/action."""

    id: str
    provider_id: str
    name: str
    action: str
    category: str | None = None
    default_currency: str | None = None
    status: str = FulfillmentServiceStatusEnum.ACTIVE.value
    health_status: str = FulfillmentProviderHealthStatusEnum.UNKNOWN.value
    allowed_regions: Tuple[str, ...] = field(default_factory=tuple)
    rate_limit_per_minute: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    credentials: Mapping[str, Any] | None = None
    last_health_check_at: datetime | None = None
    health_payload: Mapping[str, Any] = field(default_factory=dict)

    def as_payload(self) -> Dict[str, Any]:
        """Return a serializable representation for downstream logging."""
        payload: Dict[str, Any] = {
            "id": self.id,
            "providerId": self.provider_id,
            "name": self.name,
            "action": self.action,
            "status": self.status,
            "healthStatus": self.health_status,
        }
        if self.category:
            payload["category"] = self.category
        if self.default_currency:
            payload["defaultCurrency"] = self.default_currency
        if self.allowed_regions:
            payload["allowedRegions"] = list(self.allowed_regions)
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        if self.rate_limit_per_minute is not None:
            payload["rateLimitPerMinute"] = self.rate_limit_per_minute
        if self.health_payload:
            payload["healthPayload"] = dict(self.health_payload)
        return payload


@dataclass(frozen=True, slots=True)
class _CatalogSnapshot:
    providers: Dict[str, FulfillmentProviderDescriptor]
    services: Dict[str, FulfillmentServiceDescriptor]
    loaded_at: datetime


_CATALOG: _CatalogSnapshot | None = None


def _enum_value(value: Any) -> str:
    if hasattr(value, "value"):
        return value.value  # type: ignore[return-value]
    if isinstance(value, str):
        return value
    return str(value)


def _normalize_regions(regions: Any) -> Tuple[str, ...]:
    if regions is None:
        return tuple()
    if isinstance(regions, (list, tuple, set)):
        return tuple(str(region) for region in regions if region is not None)
    return (str(regions),)


def _normalize_mapping(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, Mapping):
        return dict(payload)
    return {}


async def refresh_catalog(session: AsyncSession, *, force: bool = False) -> _CatalogSnapshot:
    """Refresh the in-memory catalog from persistence."""

    global _CATALOG
    now = datetime.now(timezone.utc)
    if (
        not force
        and _CATALOG is not None
        and now - _CATALOG.loaded_at < timedelta(seconds=_CACHE_TTL_SECONDS)
    ):
        return _CATALOG

    provider_result = await session.execute(select(FulfillmentProvider))
    providers = provider_result.scalars().all()

    service_result = await session.execute(select(FulfillmentService))
    services = service_result.scalars().all()

    provider_map: Dict[str, FulfillmentProviderDescriptor] = {}
    for provider in providers:
        allowed_regions = _normalize_regions(getattr(provider, "allowed_regions", None))
        metadata = _normalize_mapping(getattr(provider, "metadata_json", None))
        credentials = getattr(provider, "credentials", None)
        if isinstance(credentials, Mapping):
            credentials_payload: Mapping[str, Any] | None = dict(credentials)
        else:
            credentials_payload = None
        descriptor = FulfillmentProviderDescriptor(
            id=provider.id,
            name=provider.name,
            region=allowed_regions[0] if allowed_regions else None,
            base_url=getattr(provider, "base_url", None),
            description=getattr(provider, "description", None),
            status=_enum_value(getattr(provider, "status", FulfillmentProviderStatusEnum.INACTIVE)),
            health_status=_enum_value(
                getattr(provider, "health_status", FulfillmentProviderHealthStatusEnum.UNKNOWN)
            ),
            allowed_regions=allowed_regions,
            rate_limit_per_minute=getattr(provider, "rate_limit_per_minute", None),
            metadata=metadata,
            credentials=credentials_payload,
            last_health_check_at=getattr(provider, "last_health_check_at", None),
            health_payload=_normalize_mapping(getattr(provider, "health_payload", None)),
        )
        provider_map[descriptor.id] = descriptor

    service_map: Dict[str, FulfillmentServiceDescriptor] = {}
    for service in services:
        allowed_regions = _normalize_regions(getattr(service, "allowed_regions", None))
        metadata = _normalize_mapping(getattr(service, "metadata_json", None))
        credentials = getattr(service, "credentials", None)
        if isinstance(credentials, Mapping):
            credentials_payload: Mapping[str, Any] | None = dict(credentials)
        else:
            credentials_payload = None
        descriptor = FulfillmentServiceDescriptor(
            id=service.id,
            provider_id=service.provider_id,
            name=service.name,
            action=service.action,
            category=getattr(service, "category", None),
            default_currency=getattr(service, "default_currency", None),
            status=_enum_value(getattr(service, "status", FulfillmentServiceStatusEnum.ACTIVE)),
            health_status=_enum_value(
                getattr(service, "health_status", FulfillmentProviderHealthStatusEnum.UNKNOWN)
            ),
            allowed_regions=allowed_regions,
            rate_limit_per_minute=getattr(service, "rate_limit_per_minute", None),
            metadata=metadata,
            credentials=credentials_payload,
            last_health_check_at=getattr(service, "last_health_check_at", None),
            health_payload=_normalize_mapping(getattr(service, "health_payload", None)),
        )
        service_map[descriptor.id] = descriptor

    snapshot = _CatalogSnapshot(
        providers=provider_map,
        services=service_map,
        loaded_at=now,
    )
    _CATALOG = snapshot
    logger.debug(
        "Fulfillment provider catalog refreshed",
        provider_count=len(provider_map),
        service_count=len(service_map),
    )
    return snapshot


def clear_cache() -> None:
    """Clear the cached provider catalog."""

    global _CATALOG
    _CATALOG = None


def list_providers() -> Iterable[FulfillmentProviderDescriptor]:
    """Return all registered providers currently cached."""

    if _CATALOG is None:
        return tuple()
    return tuple(_CATALOG.providers.values())


def list_services() -> Iterable[FulfillmentServiceDescriptor]:
    """Return all registered services currently cached."""

    if _CATALOG is None:
        return tuple()
    return tuple(_CATALOG.services.values())


def get_provider(provider_id: str) -> Optional[FulfillmentProviderDescriptor]:
    """Return provider descriptor if registered."""

    if _CATALOG is None:
        return None
    return _CATALOG.providers.get(provider_id)


def get_service(service_id: str) -> Optional[FulfillmentServiceDescriptor]:
    """Return service descriptor if registered."""

    if _CATALOG is None:
        return None
    return _CATALOG.services.get(service_id)


def service_exists(service_id: str) -> bool:
    """Return True when a service id is registered."""

    if _CATALOG is None:
        return False
    return service_id in _CATALOG.services

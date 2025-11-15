"""Scheduled health monitoring for fulfillment providers."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Mapping, MutableMapping

import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.domain.fulfillment import provider_registry
from smplat_api.models.fulfillment import FulfillmentProviderHealthStatusEnum, FulfillmentProvider, FulfillmentService
from smplat_api.services.fulfillment import ProviderCatalogService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


@dataclass
class _HealthResult:
    status: FulfillmentProviderHealthStatusEnum
    payload: Dict[str, Any]


@dataclass
class _ProviderSnapshot:
    provider: FulfillmentProvider
    result: _HealthResult
    services: Dict[str, _HealthResult]


async def run_provider_health_snapshot(
    *,
    session_factory: SessionFactory,
    http_client: httpx.AsyncClient | None = None,
    timeout_seconds: float = 8.0,
    concurrency: int = 5,
) -> Dict[str, Any]:
    """Ping provider/service health endpoints and persist the snapshot."""

    maybe_session = session_factory()
    session: AsyncSession
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        catalog = ProviderCatalogService(managed_session)
        providers = await catalog.list_providers()
        if not providers:
            return {"providers_checked": 0, "healthy": 0, "degraded": 0, "offline": 0, "unknown": 0}

        client = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        owns_client = http_client is None
        semaphore = asyncio.Semaphore(max(concurrency, 1))
        checked_at = datetime.now(timezone.utc)

        try:
            snapshots = []
            for provider in providers:
                snapshot = await _evaluate_provider(provider, client, semaphore)
                snapshots.append(snapshot)

            summary = {"providers_checked": len(snapshots), "healthy": 0, "degraded": 0, "offline": 0, "unknown": 0}
            for snapshot in snapshots:
                status = snapshot.result.status
                summary_key = _summarize_status(status)
                summary[summary_key] += 1
                await catalog.record_health_snapshot(
                    snapshot.provider,
                    provider_status=status,
                    provider_payload=snapshot.result.payload,
                    service_statuses={svc_id: (svc_result.status, svc_result.payload) for svc_id, svc_result in snapshot.services.items()},
                    checked_at=checked_at,
                    refresh_registry=False,
                )

            await provider_registry.refresh_catalog(managed_session, force=True)
            logger.bind(summary=summary).info("Fulfillment provider health snapshot completed")
            return summary
        finally:
            if owns_client:
                await client.aclose()


def _summarize_status(status: FulfillmentProviderHealthStatusEnum) -> str:
    if status == FulfillmentProviderHealthStatusEnum.HEALTHY:
        return "healthy"
    if status == FulfillmentProviderHealthStatusEnum.DEGRADED:
        return "degraded"
    if status == FulfillmentProviderHealthStatusEnum.OFFLINE:
        return "offline"
    return "unknown"


async def _evaluate_provider(
    provider: FulfillmentProvider,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> _ProviderSnapshot:
    provider_result = await _evaluate_entity(provider, provider.base_url, client, semaphore)
    services: Dict[str, _HealthResult] = {}
    for service in getattr(provider, "services", []) or []:
        base_url = getattr(provider, "base_url", None)
        result = await _evaluate_entity(service, base_url, client, semaphore, default_endpoint=None)
        if result and result.payload.get("reason") == "no_health_endpoint":
            result = None
        if result is None:
            result = _HealthResult(
                status=provider_result.status,
                payload={
                    "inherited": True,
                    "providerStatus": provider_result.status.value if hasattr(provider_result.status, "value") else str(provider_result.status),
                },
            )
        services[service.id] = result

    return _ProviderSnapshot(provider=provider, result=provider_result, services=services)


async def _evaluate_entity(
    entity: FulfillmentProvider | FulfillmentService,
    base_url: str | None,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    *,
    default_endpoint: str | None = "/health",
) -> _HealthResult | None:
    metadata = _coerce_mapping(getattr(entity, "metadata_json", None))
    health_config = _coerce_mapping(metadata.get("health"))
    method = str(health_config.get("method", "GET")).upper()
    headers = _coerce_mapping(health_config.get("headers"))
    expected_statuses = health_config.get("expectedStatuses") or health_config.get("expectedStatus")
    if isinstance(expected_statuses, int):
        expected_statuses = [expected_statuses]
    elif not isinstance(expected_statuses, list):
        expected_statuses = None

    endpoint = (
        health_config.get("url")
        or health_config.get("endpoint")
        or health_config.get("path")
        or default_endpoint
    )
    url = _resolve_url(base_url, endpoint)
    if not url:
        return _HealthResult(
            status=FulfillmentProviderHealthStatusEnum.UNKNOWN,
            payload={"reason": "no_health_endpoint"},
        )

    async with semaphore:
        started = time.perf_counter()
        try:
            response = await client.request(method, url, headers=headers)
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            payload = {
                "status_code": response.status_code,
                "latency_ms": latency_ms,
                "url": url,
            }
            if response.headers.get("content-type", "").startswith("application/json"):
                try:
                    payload["body"] = response.json()
                except ValueError:
                    payload["body_preview"] = response.text[:256]
            status = _classify_status(response.status_code, expected_statuses)
            return _HealthResult(status=status, payload=payload)
        except httpx.TimeoutException as exc:
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return _HealthResult(
                status=FulfillmentProviderHealthStatusEnum.OFFLINE,
                payload={"error": "timeout", "details": str(exc), "latency_ms": latency_ms, "url": url},
            )
        except httpx.RequestError as exc:
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return _HealthResult(
                status=FulfillmentProviderHealthStatusEnum.OFFLINE,
                payload={"error": "request_error", "details": str(exc), "latency_ms": latency_ms, "url": url},
            )


def _resolve_url(base_url: str | None, endpoint: str | None) -> str | None:
    if not endpoint:
        return None
    endpoint = str(endpoint).strip()
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint
    if not base_url:
        return None
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    return f"{base_url.rstrip('/')}{endpoint}"


def _classify_status(
    status_code: int,
    expected_statuses: list[int] | None,
) -> FulfillmentProviderHealthStatusEnum:
    if expected_statuses and status_code in expected_statuses:
        return FulfillmentProviderHealthStatusEnum.HEALTHY
    if status_code < 400:
        return FulfillmentProviderHealthStatusEnum.HEALTHY
    if 400 <= status_code < 500:
        return FulfillmentProviderHealthStatusEnum.DEGRADED
    return FulfillmentProviderHealthStatusEnum.OFFLINE


def _coerce_mapping(value: Any) -> MutableMapping[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    return {}


__all__ = ["run_provider_health_snapshot"]

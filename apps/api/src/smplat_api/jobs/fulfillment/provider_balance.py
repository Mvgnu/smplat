"""Scheduled balance sync for fulfillment providers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Mapping

import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.services.fulfillment import ProviderCatalogService
from smplat_api.services.fulfillment.provider_endpoints import (
    ProviderEndpointError,
    build_metadata_context,
    extract_balance_from_payload,
    extract_endpoint,
    invoke_provider_endpoint,
)

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


@dataclass
class _BalanceResult:
    amount: float | None
    currency: str | None
    payload: Mapping[str, Any]


async def run_provider_balance_snapshot(
    *,
    session_factory: SessionFactory,
    http_client: httpx.AsyncClient | None = None,
    timeout_seconds: float = 8.0,
    concurrency: int = 5,
) -> Dict[str, Any]:
    """Fetch provider balances using configured automation endpoints."""

    maybe_session = session_factory()
    session: AsyncSession = maybe_session if isinstance(maybe_session, AsyncSession) else await maybe_session

    async with session as managed_session:
        catalog = ProviderCatalogService(managed_session)
        providers = await catalog.list_providers()
        if not providers:
            return {"providers_checked": 0, "snapshots": 0}

        client = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        owns_client = http_client is None
        semaphore = asyncio.Semaphore(max(concurrency, 1))
        checked_at = datetime.now(timezone.utc)
        snapshots = 0

        try:
            for provider in providers:
                endpoint = extract_endpoint(provider.metadata_json, "balance")
                if not endpoint:
                    continue
                result = await _fetch_balance(
                    endpoint,
                    provider.metadata_json,
                    client,
                    semaphore,
                    timeout_seconds,
                )
                if result is None:
                    continue
                await catalog.record_balance_snapshot(
                    provider,
                    amount=result.amount,
                    currency=result.currency,
                    payload=result.payload,
                    retrieved_at=checked_at,
                )
                snapshots += 1

            summary = {"providers_checked": len(providers), "snapshots": snapshots}
            logger.bind(summary=summary).info("Fulfillment provider balance snapshot completed")
            return summary
        finally:
            if owns_client:
                await client.aclose()


async def _fetch_balance(
    endpoint: Mapping[str, Any],
    metadata: Mapping[str, Any] | None,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    default_timeout: float,
) -> _BalanceResult | None:
    url_template = endpoint.get("url")
    if not isinstance(url_template, str) or not url_template.strip():
        return None
    context = build_metadata_context(metadata)
    timeout_seconds = endpoint.get("timeoutSeconds") or default_timeout

    async with semaphore:
        try:
            invocation = await invoke_provider_endpoint(
                endpoint,
                context=context,
                http_client=client,
                default_timeout=timeout_seconds,
            )
            payload = invocation.payload
            amount, currency = extract_balance_from_payload(payload, endpoint)
            return _BalanceResult(amount=amount, currency=currency, payload=payload)
        except ProviderEndpointError as exc:
            logger.warning("Provider balance request failed", url=exc.url, error=str(exc))
            return None


__all__ = ["run_provider_balance_snapshot"]

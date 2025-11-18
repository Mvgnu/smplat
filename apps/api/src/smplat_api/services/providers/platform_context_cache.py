from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from smplat_api.models.provider_platform_context import ProviderPlatformContextCache


@dataclass
class ProviderPlatformContextRecord:
    provider_id: str
    platform_id: str
    label: str
    handle: str | None
    platform_type: str | None
    context: Mapping[str, Any] | None


class ProviderPlatformContextCacheService:
    """Caches recent platform contexts observed for fulfillment providers."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record_context(self, provider_id: str, platform_context: Mapping[str, Any] | None) -> None:
        if not provider_id or not platform_context:
            return
        platform_id = _string_field(platform_context.get("id"))
        label = _string_field(platform_context.get("label"))
        if not platform_id or not label:
            return
        handle = _string_field(platform_context.get("handle"))
        platform_type = _string_field(platform_context.get("platformType"))
        stmt = (
            insert(ProviderPlatformContextCache)
            .values(
                provider_id=provider_id,
                platform_id=platform_id,
                label=label,
                handle=handle,
                platform_type=platform_type,
                context=dict(platform_context),
            )
            .on_conflict_do_update(
                index_elements=[ProviderPlatformContextCache.provider_id, ProviderPlatformContextCache.platform_id],
                set_={
                    "label": label,
                    "handle": handle,
                    "platform_type": platform_type,
                    "context": dict(platform_context),
                    "last_seen_at": func.now(),
                },
            )
        )
        await self._session.execute(stmt)

    async def fetch_contexts_for_providers(
        self,
        provider_ids: Sequence[str],
        *,
        limit_per_provider: int = 3,
    ) -> dict[str, list[ProviderPlatformContextRecord]]:
        if not provider_ids:
            return {}
        stmt = (
            select(ProviderPlatformContextCache)
            .where(ProviderPlatformContextCache.provider_id.in_(provider_ids))
            .order_by(
                ProviderPlatformContextCache.provider_id.asc(),
                ProviderPlatformContextCache.last_seen_at.desc(),
            )
        )
        result = await self._session.execute(stmt)
        rows = result.scalars().all()
        normalized: dict[str, list[ProviderPlatformContextRecord]] = {}
        for row in rows:
            bucket = normalized.setdefault(row.provider_id, [])
            if len(bucket) >= limit_per_provider:
                continue
            bucket.append(
                ProviderPlatformContextRecord(
                    provider_id=row.provider_id,
                    platform_id=row.platform_id,
                    label=row.label,
                    handle=row.handle,
                    platform_type=row.platform_type,
                    context=row.context or {},
                )
            )
        return normalized


def _string_field(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


__all__ = ["ProviderPlatformContextCacheService", "ProviderPlatformContextRecord"]

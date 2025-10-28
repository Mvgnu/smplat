"""Deterministic bundle recommendation heuristics for the storefront."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from loguru import logger
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.catalog import (
    CatalogBundle,
    CatalogBundleAcceptanceMetric,
    CatalogRecommendationCache,
)
from smplat_api.models.fulfillment import FulfillmentTask, FulfillmentTaskStatusEnum
from smplat_api.models.order import OrderItem
from smplat_api.models.product import Product


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class BundleHeuristics:
    """Scoring heuristics contributing to a recommendation."""

    acceptance_rate: float | None
    acceptance_count: int
    queue_depth: int
    lookback_days: int | None
    cms_priority: int
    notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BundleRecommendation:
    """Structured bundle recommendation payload."""

    slug: str
    title: str
    description: str | None
    savings_copy: str | None
    components: list[str]
    score: float
    heuristics: BundleHeuristics

    def as_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
            "savings_copy": self.savings_copy,
            "components": self.components,
            "score": self.score,
            "heuristics": {
                "acceptance_rate": self.heuristics.acceptance_rate,
                "acceptance_count": self.heuristics.acceptance_count,
                "queue_depth": self.heuristics.queue_depth,
                "lookback_days": self.heuristics.lookback_days,
                "cms_priority": self.heuristics.cms_priority,
                "notes": self.heuristics.notes,
            },
        }


@dataclass(slots=True)
class RecommendationSnapshot:
    """Cached snapshot of bundle recommendations for a product."""

    primary_slug: str
    computed_at: datetime
    expires_at: datetime
    recommendations: list[BundleRecommendation]
    metadata: dict[str, Any] = field(default_factory=dict)
    cache_layer: str = "computed"

    def as_dict(self) -> dict[str, Any]:
        return {
            "primary_slug": self.primary_slug,
            "computed_at": self.computed_at,
            "expires_at": self.expires_at,
            "cache_layer": self.cache_layer,
            "metadata": self.metadata,
            "recommendations": [bundle.as_dict() for bundle in self.recommendations],
        }

    def with_layer(self, layer: str) -> "RecommendationSnapshot":
        return RecommendationSnapshot(
            primary_slug=self.primary_slug,
            computed_at=self.computed_at,
            expires_at=self.expires_at,
            recommendations=self.recommendations,
            metadata=dict(self.metadata),
            cache_layer=layer,
        )


# meta: caching-strategy: timed-memory
_CACHE_TTL = timedelta(minutes=10)
_CACHE: dict[str, RecommendationSnapshot] = {}
_CACHE_LOCK = asyncio.Lock()


class CatalogRecommendationService:
    """Generate provenance-rich catalog bundle recommendations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @classmethod
    async def reset_cache(cls) -> None:
        """Reset in-memory cache (used for testing)."""

        async with _CACHE_LOCK:
            _CACHE.clear()

    async def resolve(
        self,
        product_slug: str,
        freshness_minutes: int | None = None,
    ) -> RecommendationSnapshot:
        """Return deterministic bundle recommendations for the given product slug."""

        ttl = _CACHE_TTL if freshness_minutes is None else timedelta(minutes=freshness_minutes)
        now = _utcnow()

        async with _CACHE_LOCK:
            cached = _CACHE.get(product_slug)
            if cached and cached.expires_at > now:
                return cached.with_layer("memory")

        persistent = await self._load_persistent_cache(product_slug, now)
        if persistent and persistent.expires_at > now:
            snapshot = persistent.with_layer("persistent")
            async with _CACHE_LOCK:
                _CACHE[product_slug] = snapshot
            return snapshot

        computed = await self._compute_snapshot(product_slug, ttl)
        await self._persist_snapshot(computed)
        snapshot = computed.with_layer("computed")
        async with _CACHE_LOCK:
            _CACHE[product_slug] = snapshot
        return snapshot

    async def _load_persistent_cache(
        self, product_slug: str, now: datetime
    ) -> RecommendationSnapshot | None:
        record = await self._session.get(CatalogRecommendationCache, product_slug)
        if not record:
            return None

        payload = record.as_dict()
        computed_at = payload.get("computed_at")
        expires_at = payload.get("expires_at")
        if isinstance(computed_at, datetime) and computed_at.tzinfo is None:
            computed_at = computed_at.replace(tzinfo=timezone.utc)
        if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not isinstance(computed_at, datetime) or not isinstance(expires_at, datetime):
            logger.warning("Invalid catalog cache timestamps", slug=product_slug)
            return None

        bundles: list[BundleRecommendation] = []
        for item in payload.get("payload", []):
            if not isinstance(item, dict):
                continue
            heuristics_raw = item.get("heuristics") if isinstance(item.get("heuristics"), dict) else {}
            component_values = item.get("components", [])
            components = [str(value) for value in component_values] if isinstance(component_values, list) else []
            bundles.append(
                BundleRecommendation(
                    slug=str(item.get("slug", "")),
                    title=str(item.get("title", "")),
                    description=item.get("description"),
                    savings_copy=item.get("savings_copy"),
                    components=components,
                    score=float(item.get("score", 0.0) or 0.0),
                    heuristics=BundleHeuristics(
                        acceptance_rate=heuristics_raw.get("acceptance_rate"),
                        acceptance_count=int(heuristics_raw.get("acceptance_count", 0) or 0),
                        queue_depth=int(heuristics_raw.get("queue_depth", 0) or 0),
                        lookback_days=(
                            int(heuristics_raw.get("lookback_days"))
                            if heuristics_raw.get("lookback_days") is not None
                            else None
                        ),
                        cms_priority=int(heuristics_raw.get("cms_priority", 0) or 0),
                        notes=list(heuristics_raw.get("notes", []))
                        if isinstance(heuristics_raw.get("notes"), list)
                        else [],
                    ),
                )
            )

        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        metadata.setdefault("cache_layer", "persistent")
        metadata.setdefault("source", "catalog_bundle_engine")
        return RecommendationSnapshot(
            primary_slug=product_slug,
            computed_at=computed_at,
            expires_at=expires_at,
            recommendations=bundles,
            metadata=metadata,
            cache_layer="persistent",
        )

    async def _persist_snapshot(self, snapshot: RecommendationSnapshot) -> None:
        record = await self._session.get(CatalogRecommendationCache, snapshot.primary_slug)
        payload = [bundle.as_dict() for bundle in snapshot.recommendations]
        metadata = dict(snapshot.metadata)
        metadata["cache_layer"] = "persistent"

        if record:
            record.payload = payload
            record.metadata_json = metadata
            record.computed_at = snapshot.computed_at
            record.expires_at = snapshot.expires_at
        else:
            record = CatalogRecommendationCache(
                primary_slug=snapshot.primary_slug,
                payload=payload,
                metadata_json=metadata,
                computed_at=snapshot.computed_at,
                expires_at=snapshot.expires_at,
            )
            self._session.add(record)

        try:
            await self._session.commit()
        except Exception as exc:  # pragma: no cover - defensive logging
            await self._session.rollback()
            logger.exception("Failed to persist recommendation cache", slug=snapshot.primary_slug, error=exc)

    async def _compute_snapshot(
        self,
        product_slug: str,
        ttl: timedelta,
    ) -> RecommendationSnapshot:
        now = _utcnow()
        expires_at = now + ttl

        bundles = await self._fetch_bundles(product_slug)
        if not bundles:
            metadata = {
                "cache_layer": "computed",
                "notes": ["no_bundles_configured"],
            }
            return RecommendationSnapshot(
                primary_slug=product_slug,
                computed_at=now,
                expires_at=expires_at,
                recommendations=[],
                metadata=metadata,
                cache_layer="computed",
            )

        bundle_metrics = await self._fetch_acceptance_metrics(bundles)
        queue_depths = await self._fetch_queue_depths(bundles)

        recommendations: list[BundleRecommendation] = []

        for bundle in bundles:
            metric = bundle_metrics.get(bundle.bundle_slug)
            acceptance_rate = metric.acceptance_rate_float() if metric else None
            lookback_days = metric.lookback_days if metric else None
            acceptance_count = metric.acceptance_count if metric else 0

            components = bundle.component_slugs()
            queue_depth = sum(queue_depths.get(slug, 0) for slug in components)

            score = self._score_bundle(
                cms_priority=bundle.cms_priority or 0,
                acceptance_rate=acceptance_rate or 0.0,
                queue_depth=queue_depth,
            )

            notes = []
            if acceptance_rate is None:
                notes.append("acceptance_missing")
            elif acceptance_rate < 0.05:
                notes.append("acceptance_low")
            elif acceptance_rate > 0.25:
                notes.append("acceptance_strong")

            if queue_depth > 15:
                notes.append("queue_constrained")
            elif queue_depth == 0:
                notes.append("queue_clear")

            heuristics = BundleHeuristics(
                acceptance_rate=acceptance_rate,
                acceptance_count=acceptance_count,
                queue_depth=queue_depth,
                lookback_days=lookback_days,
                cms_priority=bundle.cms_priority or 0,
                notes=notes,
            )

            recommendations.append(
                BundleRecommendation(
                    slug=bundle.bundle_slug,
                    title=bundle.title,
                    description=bundle.description,
                    savings_copy=bundle.savings_copy,
                    components=components,
                    score=score,
                    heuristics=heuristics,
                )
            )

        recommendations.sort(
            key=lambda rec: (
                -rec.score,
                rec.heuristics.cms_priority,
                rec.slug,
            )
        )

        ttl_minutes = max(1, int(ttl.total_seconds() // 60))
        metadata = {
            "cache_layer": "computed",
            "generated_at": now.isoformat(),
            "ttl_minutes": ttl_minutes,
            "source": "catalog_bundle_engine",
        }

        return RecommendationSnapshot(
            primary_slug=product_slug,
            computed_at=now,
            expires_at=expires_at,
            recommendations=recommendations,
            metadata=metadata,
            cache_layer="computed",
        )

    async def _fetch_bundles(self, product_slug: str) -> list[CatalogBundle]:
        stmt: Select[tuple[CatalogBundle]] = select(CatalogBundle).where(
            CatalogBundle.primary_product_slug == product_slug
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def _fetch_acceptance_metrics(
        self, bundles: Iterable[CatalogBundle]
    ) -> dict[str, CatalogBundleAcceptanceMetric]:
        bundle_slugs = [bundle.bundle_slug for bundle in bundles]
        if not bundle_slugs:
            return {}

        stmt: Select[tuple[CatalogBundleAcceptanceMetric]] = select(CatalogBundleAcceptanceMetric).where(
            CatalogBundleAcceptanceMetric.bundle_slug.in_(bundle_slugs)
        )
        result = await self._session.execute(stmt)
        metrics: dict[str, CatalogBundleAcceptanceMetric] = {}
        for metric in result.scalars():
            current = metrics.get(metric.bundle_slug)
            if current is None:
                metrics[metric.bundle_slug] = metric
                continue
            current_days = current.lookback_days if current.lookback_days is not None else 10_000
            metric_days = metric.lookback_days if metric.lookback_days is not None else 10_000
            if metric_days < current_days:
                metrics[metric.bundle_slug] = metric
                continue
            if metric.computed_at and current.computed_at and metric.computed_at > current.computed_at:
                metrics[metric.bundle_slug] = metric
        return metrics

    async def _fetch_queue_depths(self, bundles: Iterable[CatalogBundle]) -> dict[str, int]:
        component_slugs: set[str] = set()
        for bundle in bundles:
            component_slugs.update(bundle.component_slugs())

        if not component_slugs:
            return {}

        stmt = (
            select(Product.slug, func.count(FulfillmentTask.id))
            .join(OrderItem, OrderItem.id == FulfillmentTask.order_item_id)
            .join(Product, Product.id == OrderItem.product_id)
            .where(Product.slug.in_(component_slugs))
            .where(
                FulfillmentTask.status.in_(
                    [
                        FulfillmentTaskStatusEnum.PENDING,
                        FulfillmentTaskStatusEnum.IN_PROGRESS,
                    ]
                )
            )
            .group_by(Product.slug)
        )

        result = await self._session.execute(stmt)
        return {slug: int(count) for slug, count in result.all()}

    def _score_bundle(self, cms_priority: int, acceptance_rate: float, queue_depth: int) -> float:
        """Compute a deterministic score balancing CMS intent and operational readiness."""

        normalized_priority = max(0, 150 - min(cms_priority, 150))
        acceptance_bonus = acceptance_rate * 100
        queue_penalty = min(queue_depth * 1.5, 50)
        score = normalized_priority + acceptance_bonus - queue_penalty
        return round(score, 4)


__all__ = ["CatalogRecommendationService", "RecommendationSnapshot", "BundleRecommendation"]

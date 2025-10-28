"""Fulfillment-derived metric computations for trust surfaces."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from loguru import logger
from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
)
from smplat_api.models.order import Order, OrderItem
from smplat_api.models.metric_cache import FulfillmentMetricCache

# meta: caching-strategy: timed-memory
_CACHE_LOCK = asyncio.Lock()
_CACHE_TTL = timedelta(minutes=15)
_CACHE: dict[str, "MetricSnapshot"] = {}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class MetricSnapshot:
    """Raw metric output computed from fulfillment datasets."""

    metric_id: str
    value: float | None
    formatted_value: str | None
    computed_at: datetime
    sample_size: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class MetricRequest:
    """Metric resolution request from clients."""

    metric_id: str
    freshness_window_minutes: int | None = None


@dataclass(slots=True)
class ResolvedMetric:
    """Metric decorated with freshness metadata for API consumers."""

    metric_id: str
    value: float | None
    formatted_value: str | None
    computed_at: datetime | None
    sample_size: int
    freshness_window_minutes: int | None
    verification_state: str
    metadata: dict[str, Any]
    provenance: "MetricProvenance"


@dataclass(slots=True)
class MetricProvenance:
    """Context for how a metric snapshot was sourced."""

    # meta: provenance: fulfillment
    source: str | None
    cache_layer: str
    cache_refreshed_at: datetime | None
    cache_expires_at: datetime | None
    cache_ttl_minutes: int | None
    notes: list[str]
    unsupported_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "cache_layer": self.cache_layer,
            "cache_refreshed_at": self.cache_refreshed_at,
            "cache_expires_at": self.cache_expires_at,
            "cache_ttl_minutes": self.cache_ttl_minutes,
            "notes": self.notes,
            "unsupported_reason": self.unsupported_reason,
        }


MetricComputer = Callable[["FulfillmentMetricsService"], Awaitable[MetricSnapshot]]


@dataclass(frozen=True)
class MetricDefinition:
    """Catalog entry describing a permissible metric."""

    metric_id: str
    default_freshness_minutes: int | None
    source: str
    computer: MetricComputer


class FulfillmentMetricsService:
    """Aggregates deterministic trust metrics from fulfillment data."""

    # meta: trust-metric-catalog: fulfillment
    _definitions: dict[str, MetricDefinition]

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._definitions = {
            "fulfillment_sla_on_time_pct": MetricDefinition(
                metric_id="fulfillment_sla_on_time_pct",
                default_freshness_minutes=1440,
                source="fulfillment",
                computer=FulfillmentMetricsService._compute_on_time_percentage,
            ),
            "first_response_minutes": MetricDefinition(
                metric_id="first_response_minutes",
                default_freshness_minutes=360,
                source="support",
                computer=FulfillmentMetricsService._compute_first_response_minutes,
            ),
            "nps_trailing_30d": MetricDefinition(
                metric_id="nps_trailing_30d",
                default_freshness_minutes=1440,
                source="fulfillment",
                computer=FulfillmentMetricsService._compute_nps_trailing_30d,
            ),
            "fulfillment_backlog_minutes": MetricDefinition(
                metric_id="fulfillment_backlog_minutes",
                default_freshness_minutes=120,
                source="fulfillment",
                computer=FulfillmentMetricsService._compute_backlog_minutes,
            ),
            "fulfillment_staffing_coverage_pct": MetricDefinition(
                metric_id="fulfillment_staffing_coverage_pct",
                default_freshness_minutes=180,
                source="fulfillment",
                computer=FulfillmentMetricsService._compute_staffing_coverage,
            ),
        }

    async def resolve_metrics(self, requests: list[MetricRequest]) -> list[ResolvedMetric]:
        """Resolve metrics with freshness metadata for downstream consumers."""

        resolved: list[ResolvedMetric] = []

        for request in requests:
            definition = self._definitions.get(request.metric_id)
            if not definition:
                logger.warning("Unsupported metric requested", metric_id=request.metric_id)
                provenance = MetricProvenance(
                    source=None,
                    cache_layer="none",
                    cache_refreshed_at=None,
                    cache_expires_at=None,
                    cache_ttl_minutes=None,
                    notes=["Metric not registered in fulfillment catalog."],
                    unsupported_reason="metric_not_registered",
                )
                resolved.append(
                    ResolvedMetric(
                        metric_id=request.metric_id,
                        value=None,
                        formatted_value=None,
                        computed_at=None,
                        sample_size=0,
                        freshness_window_minutes=request.freshness_window_minutes,
                        verification_state="unsupported",
                        metadata={"source": "unknown"},
                        provenance=provenance,
                    )
                )
                continue

            snapshot, cache_metadata = await self._get_snapshot(definition)
            freshness_window = request.freshness_window_minutes or definition.default_freshness_minutes
            verification_state = self._derive_verification_state(snapshot, freshness_window)
            provenance = self._build_provenance(definition, cache_metadata)

            resolved.append(
                ResolvedMetric(
                    metric_id=snapshot.metric_id,
                    value=snapshot.value,
                    formatted_value=snapshot.formatted_value,
                    computed_at=snapshot.computed_at,
                    sample_size=snapshot.sample_size,
                    freshness_window_minutes=freshness_window,
                    verification_state=verification_state,
                    metadata={"source": definition.source, **snapshot.metadata},
                    provenance=provenance,
                )
            )

        return resolved

    async def _get_snapshot(self, definition: MetricDefinition) -> tuple[MetricSnapshot, dict[str, Any]]:
        now = _utcnow()
        persistent_ttl = self._persistent_ttl(definition)

        async with _CACHE_LOCK:
            cached = _CACHE.get(definition.metric_id)
            if cached and (now - cached.computed_at) <= _CACHE_TTL:
                logger.debug(
                    "Fulfillment metric served from in-memory cache",
                    metric_id=definition.metric_id,
                    cache_layer="memory",
                )
                return cached, self._build_cache_metadata("memory", cached, persistent_ttl)

        persistent = await self._load_persistent_snapshot(definition.metric_id, now)
        if persistent:
            logger.debug(
                "Fulfillment metric hydrated from persistent cache",
                metric_id=definition.metric_id,
                cache_layer="persistent",
            )
            async with _CACHE_LOCK:
                _CACHE[definition.metric_id] = persistent
            return persistent, self._build_cache_metadata("persistent", persistent, persistent_ttl)

        snapshot = await definition.computer(self)
        logger.debug(
            "Fulfillment metric recomputed",
            metric_id=definition.metric_id,
            cache_layer="computed",
        )
        await self._store_persistent_snapshot(snapshot, persistent_ttl)

        async with _CACHE_LOCK:
            _CACHE[definition.metric_id] = snapshot

        return snapshot, self._build_cache_metadata("computed", snapshot, persistent_ttl)

    async def purge_cache(self, metric_id: str | None = None) -> list[str]:
        """Invalidate both memory and persistent caches for selected metrics."""

        if metric_id:
            target_ids = [metric_id]
        else:
            async with _CACHE_LOCK:
                target_ids = list(_CACHE.keys())

        stmt = select(FulfillmentMetricCache.metric_id)
        if metric_id:
            stmt = stmt.where(FulfillmentMetricCache.metric_id == metric_id)
        db_result = await self._session.execute(stmt)
        db_ids = list(db_result.scalars())

        if metric_id:
            target_ids.extend(db_ids)
        else:
            target_ids.extend(db_ids)

        unique_ids = sorted({metric for metric in target_ids if metric})

        async with _CACHE_LOCK:
            if metric_id:
                _CACHE.pop(metric_id, None)
            else:
                _CACHE.clear()

        delete_stmt = delete(FulfillmentMetricCache)
        if metric_id:
            delete_stmt = delete_stmt.where(FulfillmentMetricCache.metric_id == metric_id)
        await self._session.execute(delete_stmt)
        await self._session.flush()

        logger.info("Fulfillment metric cache purged", metric_ids=unique_ids or [metric_id or "all"])

        return unique_ids

    def _persistent_ttl(self, definition: MetricDefinition) -> timedelta:
        minutes = definition.default_freshness_minutes or int(_CACHE_TTL.total_seconds() // 60)
        minimum_minutes = max(minutes, int(_CACHE_TTL.total_seconds() // 60))
        return timedelta(minutes=minimum_minutes)

    async def _load_persistent_snapshot(self, metric_id: str, now: datetime) -> MetricSnapshot | None:
        record = await self._session.get(FulfillmentMetricCache, metric_id)
        if not record:
            return None

        expires_at = record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at <= now:
            await self._evict_persistent_metric(metric_id)
            return None

        return record.to_snapshot()

    async def _store_persistent_snapshot(self, snapshot: MetricSnapshot, ttl: timedelta) -> None:
        expires_at = snapshot.computed_at + ttl
        record = await self._session.get(FulfillmentMetricCache, snapshot.metric_id)

        if record:
            record.value = snapshot.value
            record.formatted_value = snapshot.formatted_value
            record.sample_size = snapshot.sample_size
            record.computed_at = snapshot.computed_at
            record.expires_at = expires_at
            record.metadata_json = snapshot.metadata
        else:
            self._session.add(FulfillmentMetricCache.from_snapshot(snapshot, expires_at))

        await self._session.flush()

    async def _evict_persistent_metric(self, metric_id: str) -> None:
        await self._session.execute(
            delete(FulfillmentMetricCache).where(FulfillmentMetricCache.metric_id == metric_id)
        )
        await self._session.flush()

    def _build_cache_metadata(
        self,
        layer: str,
        snapshot: MetricSnapshot,
        ttl: timedelta,
    ) -> dict[str, Any]:
        expires_at = snapshot.computed_at + ttl
        ttl_minutes = int(ttl.total_seconds() // 60)
        notes_lookup = {
            "memory": ["Served from in-memory cache."],
            "persistent": ["Hydrated from persistent cache store."],
            "computed": ["Snapshot recomputed from fulfillment sources."],
        }
        notes = notes_lookup.get(layer, [])

        return {
            "layer": layer,
            "refreshed_at": snapshot.computed_at,
            "expires_at": expires_at,
            "ttl_minutes": ttl_minutes,
            "notes": notes,
        }

    def _build_provenance(
        self,
        definition: MetricDefinition,
        cache_metadata: dict[str, Any],
    ) -> MetricProvenance:
        return MetricProvenance(
            source=definition.source,
            cache_layer=cache_metadata.get("layer", "unknown"),
            cache_refreshed_at=cache_metadata.get("refreshed_at"),
            cache_expires_at=cache_metadata.get("expires_at"),
            cache_ttl_minutes=cache_metadata.get("ttl_minutes"),
            notes=list(cache_metadata.get("notes", [])),
        )

    @staticmethod
    def _derive_verification_state(snapshot: MetricSnapshot, freshness_window: int | None) -> str:
        if snapshot.value is None or snapshot.sample_size == 0:
            return "missing"

        if freshness_window is None:
            return "fresh"

        deadline = snapshot.computed_at + timedelta(minutes=freshness_window)
        return "fresh" if _utcnow() <= deadline else "stale"

    async def _compute_on_time_percentage(self) -> MetricSnapshot:
        stmt: Select = (
            select(
                func.count().label("total"),
                func.sum(
                    case(
                        (FulfillmentTask.completed_at <= FulfillmentTask.scheduled_at, 1),
                        else_=0,
                    )
                ).label("on_time"),
            )
            .where(FulfillmentTask.completed_at.isnot(None))
            .where(FulfillmentTask.scheduled_at.isnot(None))
        )

        result = await self._session.execute(stmt)
        total, on_time = result.one()

        total_int = int(total or 0)
        on_time_int = int(on_time or 0)

        value = (on_time_int / total_int) if total_int > 0 else None
        formatted = f"{value * 100:.0f}%" if value is not None else None

        snapshot = MetricSnapshot(
            metric_id="fulfillment_sla_on_time_pct",
            value=value,
            formatted_value=formatted,
            computed_at=_utcnow(),
            sample_size=total_int,
            metadata={"on_time_tasks": on_time_int},
        )

        return snapshot

    async def _compute_first_response_minutes(self) -> MetricSnapshot:
        stmt: Select = (
            select(FulfillmentTask.started_at, Order.created_at)
            .join(OrderItem, FulfillmentTask.order_item_id == OrderItem.id)
            .join(Order, OrderItem.order_id == Order.id)
            .where(FulfillmentTask.started_at.isnot(None))
        )

        result = await self._session.execute(stmt)
        rows = result.all()

        deltas: list[float] = []
        for started_at, order_created in rows:
            if started_at is None or order_created is None:
                continue

            delta_minutes = (started_at - order_created).total_seconds() / 60
            if delta_minutes >= 0:
                deltas.append(delta_minutes)

        value = sum(deltas) / len(deltas) if deltas else None
        formatted = f"{value:.0f}m" if value is not None else None

        snapshot = MetricSnapshot(
            metric_id="first_response_minutes",
            value=value,
            formatted_value=formatted,
            computed_at=_utcnow(),
            sample_size=len(deltas),
        )

        return snapshot

    async def _compute_backlog_minutes(self) -> MetricSnapshot:
        """Aggregate overdue backlog minutes for active fulfillment tasks."""

        now = _utcnow()
        stmt: Select = (
            select(FulfillmentTask.scheduled_at, FulfillmentTask.created_at)
            .where(
                FulfillmentTask.status.in_(
                    [
                        FulfillmentTaskStatusEnum.PENDING,
                        FulfillmentTaskStatusEnum.IN_PROGRESS,
                    ]
                )
            )
        )

        result = await self._session.execute(stmt)
        rows = result.all()

        backlog_minutes: list[float] = []
        for scheduled_at, created_at in rows:
            anchor = scheduled_at or created_at
            if anchor is None:
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=timezone.utc)
            delta_minutes = (now - anchor).total_seconds() / 60
            if delta_minutes > 0:
                backlog_minutes.append(delta_minutes)

        overdue_tasks = len(backlog_minutes)
        outstanding_tasks = len(rows)
        total_minutes = sum(backlog_minutes)
        average_minutes = (total_minutes / overdue_tasks) if overdue_tasks else None

        formatted = None
        value = None
        if overdue_tasks:
            value = total_minutes
            if total_minutes >= 60:
                hours = total_minutes / 60
                formatted = f"{hours:.1f}h"
            else:
                formatted = f"{total_minutes:.0f}m"

        snapshot = MetricSnapshot(
            metric_id="fulfillment_backlog_minutes",
            value=value,
            formatted_value=formatted,
            computed_at=now,
            sample_size=outstanding_tasks,
            metadata={
                "source": "fulfillment",
                "overdue_task_count": overdue_tasks,
                "outstanding_task_count": outstanding_tasks,
                "average_backlog_minutes": average_minutes,
                "total_backlog_minutes": total_minutes,
            },
        )

        return snapshot

    async def _compute_staffing_coverage(self) -> MetricSnapshot:
        """Estimate staffing coverage by comparing completed vs. scheduled tasks."""

        now = _utcnow()
        lookback = now - timedelta(hours=24)

        scheduled_stmt: Select = (
            select(func.count())
            .where(FulfillmentTask.scheduled_at.isnot(None))
            .where(FulfillmentTask.scheduled_at >= lookback)
            .where(FulfillmentTask.scheduled_at <= now)
            .where(
                FulfillmentTask.status.in_(
                    [
                        FulfillmentTaskStatusEnum.PENDING,
                        FulfillmentTaskStatusEnum.IN_PROGRESS,
                    ]
                )
            )
        )

        completed_stmt: Select = (
            select(func.count())
            .where(FulfillmentTask.completed_at.isnot(None))
            .where(FulfillmentTask.completed_at >= lookback)
            .where(FulfillmentTask.completed_at <= now)
            .where(FulfillmentTask.status == FulfillmentTaskStatusEnum.COMPLETED)
        )

        scheduled_count = int((await self._session.execute(scheduled_stmt)).scalar_one() or 0)
        completed_count = int((await self._session.execute(completed_stmt)).scalar_one() or 0)

        coverage = None
        formatted = None
        if scheduled_count:
            coverage = completed_count / scheduled_count
        elif completed_count:
            coverage = 1.0

        if coverage is not None:
            formatted = f"{coverage * 100:.0f}%"

        snapshot = MetricSnapshot(
            metric_id="fulfillment_staffing_coverage_pct",
            value=coverage,
            formatted_value=formatted,
            computed_at=now,
            sample_size=scheduled_count,
            metadata={
                "source": "fulfillment",
                "lookback_hours": 24,
                "scheduled_tasks": scheduled_count,
                "completed_tasks": completed_count,
            },
        )

        return snapshot

    async def _compute_nps_trailing_30d(self) -> MetricSnapshot:
        cutoff = _utcnow() - timedelta(days=30)
        stmt: Select = (
            select(FulfillmentTask.result)
            .where(FulfillmentTask.completed_at.isnot(None))
            .where(FulfillmentTask.completed_at >= cutoff)
        )

        result = await self._session.execute(stmt)
        rows = result.all()

        scores: list[float] = []
        for (payload,) in rows:
            if not isinstance(payload, dict):
                continue
            score = payload.get("nps_score")
            if isinstance(score, (int, float)):
                scores.append(float(score))

        value = sum(scores) / len(scores) if scores else None
        formatted = f"{value:.1f}" if value is not None else None

        snapshot = MetricSnapshot(
            metric_id="nps_trailing_30d",
            value=value,
            formatted_value=formatted,
            computed_at=_utcnow(),
            sample_size=len(scores),
        )

        return snapshot


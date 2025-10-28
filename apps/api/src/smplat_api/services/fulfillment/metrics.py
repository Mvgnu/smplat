"""Fulfillment-derived metric computations for trust surfaces."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from loguru import logger
from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import (
    FulfillmentStaffingShift,
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
)
from smplat_api.models.order import Order, OrderItem
from smplat_api.models.metric_cache import FulfillmentMetricCache
from smplat_api.models.product import Product

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
    forecast: dict[str, Any] | None = None


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
    forecast: dict[str, Any] | None


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
            "fulfillment_delivery_sla_forecast": MetricDefinition(
                metric_id="fulfillment_delivery_sla_forecast",
                default_freshness_minutes=60,
                source="fulfillment",
                computer=FulfillmentMetricsService._compute_delivery_sla_forecast,
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
                        forecast=None,
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
                    forecast=snapshot.forecast,
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
            record.forecast_json = snapshot.forecast
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
    def _normalize_sku(slug: str | None, title: str | None) -> str:
        if slug and slug.strip():
            return slug.strip().lower()
        if title and title.strip():
            sanitized = title.strip().lower().replace(" ", "-")
            return sanitized
        return "unknown-sku"

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        if len(ordered) == 1:
            return ordered[0]
        rank = (percentile / 100) * (len(ordered) - 1)
        lower_index = int(rank)
        upper_index = min(lower_index + 1, len(ordered) - 1)
        lower_value = ordered[lower_index]
        upper_value = ordered[upper_index]
        fraction = rank - lower_index
        return lower_value + (upper_value - lower_value) * fraction

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

    async def _compute_delivery_sla_forecast(self) -> MetricSnapshot:
        """Project delivery SLAs by blending backlog, throughput, and staffing windows."""

        now = _utcnow()
        lookback = now - timedelta(days=30)
        horizon = now + timedelta(hours=36)

        backlog_stmt: Select = (
            select(
                Product.slug,
                OrderItem.product_title,
                FulfillmentTask.scheduled_at,
                FulfillmentTask.created_at,
            )
            .select_from(FulfillmentTask)
            .join(OrderItem, FulfillmentTask.order_item_id == OrderItem.id)
            .join(Product, OrderItem.product_id == Product.id, isouter=True)
            .where(
                FulfillmentTask.status.in_(
                    [
                        FulfillmentTaskStatusEnum.PENDING,
                        FulfillmentTaskStatusEnum.IN_PROGRESS,
                    ]
                )
            )
        )

        backlog_rows = (await self._session.execute(backlog_stmt)).all()

        backlog_by_sku: dict[str, list[datetime]] = defaultdict(list)
        for slug, title, scheduled_at, created_at in backlog_rows:
            sku = self._normalize_sku(slug, title)
            anchor = scheduled_at or created_at
            if anchor is None:
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=timezone.utc)
            backlog_by_sku[sku].append(anchor)

        duration_stmt: Select = (
            select(
                Product.slug,
                OrderItem.product_title,
                FulfillmentTask.started_at,
                FulfillmentTask.completed_at,
                FulfillmentTask.scheduled_at,
            )
            .select_from(FulfillmentTask)
            .join(OrderItem, FulfillmentTask.order_item_id == OrderItem.id)
            .join(Product, OrderItem.product_id == Product.id, isouter=True)
            .where(FulfillmentTask.status == FulfillmentTaskStatusEnum.COMPLETED)
            .where(FulfillmentTask.completed_at.isnot(None))
            .where(FulfillmentTask.completed_at >= lookback)
        )

        duration_rows = (await self._session.execute(duration_stmt)).all()

        durations_by_sku: dict[str, list[float]] = defaultdict(list)
        for slug, title, started_at, completed_at, scheduled_at in duration_rows:
            if completed_at is None:
                continue
            if completed_at.tzinfo is None:
                completed_at = completed_at.replace(tzinfo=timezone.utc)

            start = started_at or scheduled_at
            if start is None:
                continue
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)

            delta_minutes = (completed_at - start).total_seconds() / 60
            if delta_minutes < 0:
                continue

            sku = self._normalize_sku(slug, title)
            durations_by_sku[sku].append(delta_minutes)

        shift_stmt: Select = (
            select(
                FulfillmentStaffingShift.sku,
                FulfillmentStaffingShift.starts_at,
                FulfillmentStaffingShift.ends_at,
                FulfillmentStaffingShift.hourly_capacity,
            )
            .where(FulfillmentStaffingShift.ends_at >= now)
            .where(FulfillmentStaffingShift.starts_at <= horizon)
        )

        shift_rows = (await self._session.execute(shift_stmt)).all()
        shifts_by_sku: dict[str, list[tuple[datetime, datetime, int]]] = defaultdict(list)
        for sku, starts_at, ends_at, hourly_capacity in shift_rows:
            normalized_sku = self._normalize_sku(sku, sku)
            starts = starts_at
            ends = ends_at
            if starts.tzinfo is None:
                starts = starts.replace(tzinfo=timezone.utc)
            if ends.tzinfo is None:
                ends = ends.replace(tzinfo=timezone.utc)
            shifts_by_sku[normalized_sku].append((starts, ends, int(hourly_capacity or 0)))

        all_skus = sorted({*backlog_by_sku.keys(), *durations_by_sku.keys(), *shifts_by_sku.keys()})

        overall_durations = [value for values in durations_by_sku.values() for value in values]
        overall_percentiles = {
            "p50": self._percentile(overall_durations, 50),
            "p90": self._percentile(overall_durations, 90),
        }

        max_clear_minutes: float | None = None
        sku_forecasts: list[dict[str, Any]] = []
        sku_metadata: dict[str, Any] = {}

        for sku in all_skus:
            backlog_entries = sorted(backlog_by_sku.get(sku, []))
            backlog_count = len(backlog_entries)
            durations = durations_by_sku.get(sku, [])
            average_minutes = sum(durations) / len(durations) if durations else None
            percentile_bands = {
                "p50": self._percentile(durations, 50),
                "p90": self._percentile(durations, 90),
            }

            sorted_shifts = sorted(shifts_by_sku.get(sku, []))
            remaining = backlog_count
            backlog_after = backlog_count
            windows: list[dict[str, Any]] = []
            clear_time: datetime | None = None
            total_capacity = 0
            total_shift_hours = 0.0

            for starts, ends, hourly_capacity in sorted_shifts:
                duration_hours = max((ends - starts).total_seconds() / 3600, 0.0)
                capacity_tasks = int(round(hourly_capacity * duration_hours)) if hourly_capacity else 0
                total_capacity += capacity_tasks
                total_shift_hours += duration_hours

                backlog_before = remaining
                projected = min(remaining, capacity_tasks) if capacity_tasks > 0 else 0
                backlog_after = max(0, backlog_before - projected)

                if projected > 0 and clear_time is None and hourly_capacity:
                    if backlog_before == projected:
                        hours_needed = backlog_before / hourly_capacity
                        clear_time = starts + timedelta(hours=hours_needed)

                windows.append(
                    {
                        "start": starts.isoformat(),
                        "end": ends.isoformat(),
                        "hourly_capacity": hourly_capacity,
                        "capacity_tasks": capacity_tasks,
                        "backlog_at_start": backlog_before,
                        "projected_tasks_completed": projected,
                        "backlog_after": backlog_after,
                    }
                )

                remaining = backlog_after

            estimated_clear_minutes = None
            if clear_time is not None:
                estimated_clear_minutes = max((clear_time - now).total_seconds() / 60, 0)
            elif backlog_count and total_capacity > 0 and average_minutes is not None:
                # Approximate by distributing remaining work across aggregate capacity rate.
                capacity_rate = total_capacity / max(total_shift_hours, 1e-6)
                if capacity_rate > 0:
                    estimated_clear_minutes = (backlog_count / capacity_rate) * 60
            elif backlog_count == 0:
                estimated_clear_minutes = 0

            if estimated_clear_minutes is not None:
                max_clear_minutes = (
                    estimated_clear_minutes
                    if max_clear_minutes is None
                    else max(max_clear_minutes, estimated_clear_minutes)
                )

            unsupported_reason = None
            if backlog_count and total_capacity == 0:
                unsupported_reason = "no_staffing_capacity"
            elif backlog_count and average_minutes is None:
                unsupported_reason = "insufficient_history"

            sku_metadata[sku] = {
                "backlog_tasks": backlog_count,
                "average_minutes": average_minutes,
                "percentile_bands": percentile_bands,
                "windows": windows,
                "unsupported_reason": unsupported_reason,
                "estimated_clear_minutes": estimated_clear_minutes,
                "sample_size": len(durations),
            }

            sku_forecasts.append(
                {
                    "sku": sku,
                    "backlog_tasks": backlog_count,
                    "completed_sample_size": len(durations),
                    "average_minutes": average_minutes,
                    "percentile_bands": percentile_bands,
                    "windows": windows,
                    "estimated_clear_minutes": estimated_clear_minutes,
                    "unsupported_reason": unsupported_reason,
                }
            )

        value = max_clear_minutes
        formatted = None
        if value is not None:
            if value >= 60:
                formatted = f"{value / 60:.1f}h"
            else:
                formatted = f"{value:.0f}m"

        overall_alerts: list[str] = []

        if value is None:
            overall_alerts.append("forecast_unavailable")
        elif value >= 240:
            overall_alerts.append("sla_breach_risk")
        elif value >= 120:
            overall_alerts.append("sla_watch")

        if len(overall_durations) < 5:
            overall_alerts.append("limited_history")

        unsupported_codes = [
            details.get("unsupported_reason")
            for details in sku_metadata.values()
            if isinstance(details, dict)
        ]

        if unsupported_codes and all(code == "no_staffing_capacity" for code in unsupported_codes if code):
            overall_alerts.append("no_staffing_capacity")
        elif unsupported_codes and any(code for code in unsupported_codes):
            overall_alerts.append("partial_support")

        normalized_alerts = list(dict.fromkeys(code for code in overall_alerts if code))

        fallback_copy = None
        if "no_staffing_capacity" in normalized_alerts:
            fallback_copy = "Operators are restaffing pods – backlog forecast temporarily unavailable."
        elif "limited_history" in normalized_alerts:
            fallback_copy = "Forecast calibrating from recent completions – showing guarantee copy."
        elif "sla_breach_risk" in normalized_alerts:
            fallback_copy = "Projected clearance exceeds SLA guardrail – reinforcing backlog messaging."
        elif "sla_watch" in normalized_alerts:
            fallback_copy = "Elevated backlog detected – concierge is monitoring delivery commitments."
        elif "forecast_unavailable" in normalized_alerts:
            fallback_copy = "No recent completions available – displaying fallback assurance copy."

        snapshot = MetricSnapshot(
            metric_id="fulfillment_delivery_sla_forecast",
            value=value,
            formatted_value=formatted,
            computed_at=now,
            sample_size=len(overall_durations),
            metadata={
                "source": "fulfillment",
                "overall_percentile_bands": overall_percentiles,
                "sku_breakdown": sku_metadata,
                "observed_tasks": len(overall_durations),
                "observed_window_days": 30,
                "forecast_alerts": normalized_alerts,
                "fallback_copy": fallback_copy,
            },
            forecast={
                "generated_at": now.isoformat(),
                "horizon_hours": 36,
                "skus": sku_forecasts,
            },
        )

        return snapshot


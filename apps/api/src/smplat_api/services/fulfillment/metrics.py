"""Fulfillment-derived metric computations for trust surfaces."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from loguru import logger
from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import FulfillmentTask
from smplat_api.models.order import Order, OrderItem

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
        }

    async def resolve_metrics(self, requests: list[MetricRequest]) -> list[ResolvedMetric]:
        """Resolve metrics with freshness metadata for downstream consumers."""

        resolved: list[ResolvedMetric] = []

        for request in requests:
            definition = self._definitions.get(request.metric_id)
            if not definition:
                logger.warning("Unsupported metric requested", metric_id=request.metric_id)
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
                    )
                )
                continue

            snapshot = await self._get_snapshot(definition)
            freshness_window = request.freshness_window_minutes or definition.default_freshness_minutes
            verification_state = self._derive_verification_state(snapshot, freshness_window)

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
                )
            )

        return resolved

    async def _get_snapshot(self, definition: MetricDefinition) -> MetricSnapshot:
        async with _CACHE_LOCK:
            cached = _CACHE.get(definition.metric_id)
            if cached and (_utcnow() - cached.computed_at) <= _CACHE_TTL:
                return cached

        snapshot = await definition.computer(self)

        async with _CACHE_LOCK:
            _CACHE[definition.metric_id] = snapshot

        return snapshot

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


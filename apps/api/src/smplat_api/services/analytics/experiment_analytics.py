"""Helpers for aggregating experiment analytics data."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.services.orders.onboarding import (
    OnboardingPricingExperimentEventRow,
    OnboardingService,
)


@dataclass(slots=True)
class ExperimentConversionDigest:
    """Summarized conversion metrics for an experiment slug."""

    slug: str
    order_currency: str | None
    order_total: float
    order_count: int
    journey_count: int
    loyalty_points: int
    last_activity: datetime | None


@dataclass(slots=True)
class ExperimentConversionSnapshot:
    """Paged snapshot of conversion metrics along with cursor metadata."""

    metrics: list[ExperimentConversionDigest]
    cursor: str | None
    next_cursor: str | None


class ExperimentAnalyticsService:
    """Aggregate onboarding experiment telemetry for downstream consumers."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def fetch_conversion_snapshot(
        self,
        *,
        limit: int | None = 3,
        cursor: str | None = None,
        sample_size: int = 500,
    ) -> ExperimentConversionSnapshot:
        """Return the top experiment conversions ordered by revenue then orders."""

        service = OnboardingService(self._session)
        rows = await service.export_pricing_experiment_events(limit=sample_size)
        digests = self._build_conversion_snapshot(rows, limit=None)
        if not digests:
            return ExperimentConversionSnapshot(metrics=[], cursor=cursor, next_cursor=None)

        start_index = 0
        if cursor:
            for index, entry in enumerate(digests):
                if entry.slug == cursor:
                    start_index = index + 1
                    break

        sliced = digests[start_index:]
        if limit is not None:
            sliced = sliced[:limit]
        next_cursor = None
        if limit is not None and start_index + len(sliced) < len(digests) and sliced:
            next_cursor = sliced[-1].slug

        return ExperimentConversionSnapshot(metrics=sliced, cursor=cursor, next_cursor=next_cursor)

    @staticmethod
    def _build_conversion_snapshot(
        rows: Sequence[OnboardingPricingExperimentEventRow],
        *,
        limit: int | None,
    ) -> list[ExperimentConversionDigest]:
        buckets: dict[str, dict[str, Any]] = {}
        for row in rows:
            slug = row.slug
            if not slug:
                continue

            bucket = buckets.setdefault(
                slug,
                {
                    "orders": set(),
                    "journeys": set(),
                    "totals": defaultdict(lambda: Decimal("0")),
                    "loyalty": 0,
                    "last_activity": None,
                },
            )
            if row.order_id:
                bucket["orders"].add(str(row.order_id))
            if row.journey_id:
                bucket["journeys"].add(str(row.journey_id))

            if row.order_total is not None and row.order_total > Decimal("0"):
                currency_key = row.order_currency or "USD"
                bucket["totals"][currency_key] += row.order_total

            if row.loyalty_projection_points:
                bucket["loyalty"] += row.loyalty_projection_points

            if row.recorded_at:
                last_seen = bucket["last_activity"]
                if last_seen is None or row.recorded_at > last_seen:
                    bucket["last_activity"] = row.recorded_at

        digests: list[ExperimentConversionDigest] = []
        for slug, payload in buckets.items():
            totals = payload["totals"]
            if totals:
                currency, amount = max(totals.items(), key=lambda entry: entry[1])
            else:
                currency, amount = (None, Decimal("0"))

            order_count = len(payload["orders"])
            journey_count = len(payload["journeys"])
            if order_count == 0 and journey_count == 0 and amount <= 0:
                continue

            digests.append(
                ExperimentConversionDigest(
                    slug=slug,
                    order_currency=currency,
                    order_total=float(amount),
                    order_count=order_count,
                    journey_count=journey_count,
                    loyalty_points=payload["loyalty"],
                    last_activity=payload["last_activity"],
                )
            )

        digests.sort(key=lambda entry: (entry.order_total, entry.order_count), reverse=True)
        if limit is not None:
            return digests[:limit]
        return digests


__all__ = ["ExperimentAnalyticsService", "ExperimentConversionDigest", "ExperimentConversionSnapshot"]

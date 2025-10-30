from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.pricing_experiments import (
    PricingAdjustmentKind,
    PricingExperiment,
    PricingExperimentMetric,
    PricingExperimentStatus,
    PricingExperimentVariant,
)


@dataclass(slots=True)
class PricingMetricSnapshot:
    """Aggregated telemetry for a pricing experiment variant."""

    window_start: date
    exposures: int
    conversions: int
    revenue_cents: int


@dataclass(slots=True)
class PricingVariantSnapshot:
    """Variant snapshot with price adjustments and telemetry."""

    key: str
    name: str
    description: str | None
    weight: int
    is_control: bool
    adjustment_kind: PricingAdjustmentKind
    price_delta_cents: int
    price_multiplier: float | None
    metrics: list[PricingMetricSnapshot] = field(default_factory=list)


@dataclass(slots=True)
class PricingExperimentSnapshot:
    """Experiment snapshot including variants and aggregated metrics."""

    slug: str
    name: str
    description: str | None
    status: PricingExperimentStatus
    target_product_slug: str
    target_segment: str | None
    feature_flag_key: str | None
    assignment_strategy: str
    variants: list[PricingVariantSnapshot] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)


class PricingExperimentService:
    """Manage pricing experiments, variants, and telemetry."""

    # meta: provenance: pricing-experiments

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_experiments(self) -> list[PricingExperimentSnapshot]:
        stmt = (
            select(PricingExperiment)
            .options(
                selectinload(PricingExperiment.variants).selectinload(
                    PricingExperimentVariant.metrics
                )
            )
            .order_by(PricingExperiment.created_at.desc())
        )
        result = await self._session.execute(stmt)
        experiments = result.scalars().unique().all()
        return [self._snapshot_from_model(experiment) for experiment in experiments]

    async def get_experiment(self, slug: str) -> PricingExperimentSnapshot:
        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Pricing experiment {slug} not found")
        return self._snapshot_from_model(record)

    async def create_experiment(
        self,
        *,
        slug: str,
        name: str,
        description: str | None,
        target_product_slug: str,
        target_segment: str | None,
        feature_flag_key: str | None,
        assignment_strategy: str,
        variants: Sequence[dict[str, Any]],
    ) -> PricingExperimentSnapshot:
        record = PricingExperiment(
            slug=slug,
            name=name,
            description=description,
            target_product_slug=target_product_slug,
            target_segment=target_segment,
            feature_flag_key=feature_flag_key,
            assignment_strategy=assignment_strategy,
            status=PricingExperimentStatus.DRAFT,
        )
        for payload in variants:
            record.variants.append(
                PricingExperimentVariant(
                    key=str(payload.get("key")),
                    name=str(payload.get("name")),
                    description=payload.get("description"),
                    weight=int(payload.get("weight") or 0),
                    is_control=bool(payload.get("is_control")),
                    adjustment_kind=PricingAdjustmentKind(payload.get("adjustment_kind", "delta")),
                    price_delta_cents=int(payload.get("price_delta_cents") or 0),
                    price_multiplier=self._coerce_multiplier(payload.get("price_multiplier")),
                )
            )
        self._session.add(record)
        await self._session.commit()
        return await self.get_experiment(slug)

    async def update_experiment(
        self,
        slug: str,
        *,
        status: PricingExperimentStatus | None = None,
        target_segment: str | None = None,
        feature_flag_key: str | None = None,
        assignment_strategy: str | None = None,
    ) -> PricingExperimentSnapshot:
        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Pricing experiment {slug} not found")

        if status is not None:
            record.status = status
        if target_segment is not None:
            record.target_segment = target_segment
        if feature_flag_key is not None:
            record.feature_flag_key = feature_flag_key
        if assignment_strategy is not None:
            record.assignment_strategy = assignment_strategy

        await self._session.commit()
        return await self.get_experiment(slug)

    async def record_event(
        self,
        slug: str,
        variant_key: str,
        *,
        exposures: int = 0,
        conversions: int = 0,
        revenue_cents: int = 0,
        window_start: date | None = None,
    ) -> PricingExperimentSnapshot:
        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Pricing experiment {slug} not found")

        variant = next((variant for variant in record.variants if variant.key == variant_key), None)
        if variant is None:
            raise ValueError(f"Variant {variant_key} not found for experiment {slug}")

        effective_window = window_start or date.today()
        metric = next((m for m in variant.metrics if m.window_start == effective_window), None)
        if metric is None:
            metric = PricingExperimentMetric(
                experiment_id=record.id,
                variant_id=variant.id,
                window_start=effective_window,
            )
            self._session.add(metric)
            variant.metrics.append(metric)

        metric.exposures = (metric.exposures or 0) + max(0, exposures)
        metric.conversions = (metric.conversions or 0) + max(0, conversions)
        metric.revenue_cents = (metric.revenue_cents or 0) + max(0, revenue_cents)

        await self._session.commit()
        return await self.get_experiment(slug)

    async def _load_experiment(self, slug: str) -> PricingExperiment | None:
        stmt = (
            select(PricingExperiment)
            .options(
                selectinload(PricingExperiment.variants).selectinload(
                    PricingExperimentVariant.metrics
                )
            )
            .where(PricingExperiment.slug == slug)
        )
        result = await self._session.execute(stmt)
        return result.scalars().unique().one_or_none()

    def _snapshot_from_model(self, experiment: PricingExperiment) -> PricingExperimentSnapshot:
        variants: list[PricingVariantSnapshot] = []
        for variant in experiment.variants:
            metrics = [
                PricingMetricSnapshot(
                    window_start=metric.window_start,
                    exposures=metric.exposures or 0,
                    conversions=metric.conversions or 0,
                    revenue_cents=metric.revenue_cents or 0,
                )
                for metric in sorted(variant.metrics, key=lambda entry: entry.window_start, reverse=True)
            ]
            price_multiplier = (
                float(variant.price_multiplier)
                if isinstance(variant.price_multiplier, (float, int, Decimal))
                else None
            )
            variants.append(
                PricingVariantSnapshot(
                    key=variant.key,
                    name=variant.name,
                    description=variant.description,
                    weight=variant.weight or 0,
                    is_control=bool(variant.is_control),
                    adjustment_kind=variant.adjustment_kind,
                    price_delta_cents=variant.price_delta_cents or 0,
                    price_multiplier=price_multiplier,
                    metrics=metrics,
                )
            )
        provenance = {
            "source": "pricing-experiment-service",
            "computed_at": datetime.now(timezone.utc),
        }
        return PricingExperimentSnapshot(
            slug=experiment.slug,
            name=experiment.name,
            description=experiment.description,
            status=experiment.status,
            target_product_slug=experiment.target_product_slug,
            target_segment=experiment.target_segment,
            feature_flag_key=experiment.feature_flag_key,
            assignment_strategy=experiment.assignment_strategy,
            variants=variants,
            provenance=provenance,
        )

    def _coerce_multiplier(self, value: Any) -> Decimal | None:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except (ValueError, TypeError):  # pragma: no cover - invalid multiplier
            return None


__all__ = [
    "PricingExperimentService",
    "PricingExperimentSnapshot",
    "PricingVariantSnapshot",
    "PricingMetricSnapshot",
]

"""Catalog experimentation service layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.catalog_experiments import (
    CatalogBundleExperiment,
    CatalogBundleExperimentMetric,
    CatalogBundleExperimentStatus,
    CatalogBundleExperimentVariant,
)


@dataclass(slots=True)
class ExperimentMetricSnapshot:
    """Aggregated telemetry for an experiment variant."""

    window_start: date
    lookback_days: int
    acceptance_rate: float
    acceptance_count: int
    sample_size: int
    lift_vs_control: float | None
    guardrail_breached: bool
    computed_at: datetime


@dataclass(slots=True)
class ExperimentVariantSnapshot:
    """Variant snapshot with override metadata and telemetry."""

    key: str
    name: str
    weight: int
    is_control: bool
    bundle_slug: str | None
    override_payload: dict[str, Any]
    metrics: list[ExperimentMetricSnapshot] = field(default_factory=list)


@dataclass(slots=True)
class ExperimentSnapshot:
    """Experiment definition enriched with variants and telemetry."""

    slug: str
    name: str
    description: str | None
    status: CatalogBundleExperimentStatus
    guardrail_config: dict[str, Any]
    sample_size_guardrail: int
    variants: list[ExperimentVariantSnapshot] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)


class CatalogExperimentService:
    """Provide experiment CRUD, telemetry, and guardrail helpers."""

    # meta: provenance: bundle-experiments

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_experiments(self) -> list[ExperimentSnapshot]:
        """Return experiment snapshots ordered by creation time."""

        stmt = (
            select(CatalogBundleExperiment)
            .options(
                selectinload(CatalogBundleExperiment.variants).selectinload(
                    CatalogBundleExperimentVariant.metrics
                )
            )
            .order_by(CatalogBundleExperiment.created_at.desc())
        )
        result = await self._session.execute(stmt)
        experiments = result.scalars().unique().all()
        snapshots: list[ExperimentSnapshot] = []
        for experiment in experiments:
            variants = [
                ExperimentVariantSnapshot(
                    key=variant.key,
                    name=variant.name,
                    weight=variant.weight or 0,
                    is_control=bool(variant.is_control),
                    bundle_slug=variant.bundle_slug,
                    override_payload=
                        variant.override_payload if isinstance(variant.override_payload, dict) else {},
                    metrics=[
                        ExperimentMetricSnapshot(
                            window_start=metric.window_start,
                            lookback_days=metric.lookback_days,
                            acceptance_rate=float(metric.acceptance_rate or 0),
                            acceptance_count=metric.acceptance_count or 0,
                            sample_size=metric.sample_size or 0,
                            lift_vs_control=metric.lift_float(),
                            guardrail_breached=bool(metric.guardrail_breached),
                            computed_at=metric.computed_at,
                        )
                        for metric in sorted(
                            variant.metrics,
                            key=lambda entry: (entry.window_start, entry.computed_at),
                            reverse=True,
                        )
                    ],
                )
                for variant in experiment.variants
            ]
            provenance = {
                "source": "catalog-experiment-service",
                "computed_at": datetime.now(timezone.utc),
            }
            snapshots.append(
                ExperimentSnapshot(
                    slug=experiment.slug,
                    name=experiment.name,
                    description=experiment.description,
                    status=experiment.status,
                    guardrail_config=
                        experiment.guardrail_config if isinstance(experiment.guardrail_config, dict) else {},
                    sample_size_guardrail=experiment.sample_size_guardrail or 0,
                    variants=variants,
                    provenance=provenance,
                )
            )
        return snapshots

    async def create_experiment(
        self,
        *,
        slug: str,
        name: str,
        description: str | None,
        guardrail_config: dict[str, Any],
        sample_size_guardrail: int,
        variants: Sequence[dict[str, Any]],
    ) -> ExperimentSnapshot:
        """Create a new catalog bundle experiment with variants."""

        record = CatalogBundleExperiment(
            slug=slug,
            name=name,
            description=description,
            status=CatalogBundleExperimentStatus.DRAFT,
            guardrail_config=guardrail_config,
            sample_size_guardrail=sample_size_guardrail,
        )
        for payload in variants:
            record.variants.append(
                CatalogBundleExperimentVariant(
                    key=str(payload.get("key")),
                    name=str(payload.get("name")),
                    weight=int(payload.get("weight") or 0),
                    is_control=bool(payload.get("is_control")),
                    bundle_slug=payload.get("bundle_slug"),
                    override_payload=
                        payload.get("override_payload")
                        if isinstance(payload.get("override_payload"), dict)
                        else {},
                )
            )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return (await self._snapshot_for(record.slug))

    async def update_experiment(
        self,
        slug: str,
        *,
        status: CatalogBundleExperimentStatus | None = None,
        guardrail_config: dict[str, Any] | None = None,
        sample_size_guardrail: int | None = None,
    ) -> ExperimentSnapshot:
        """Update experiment metadata and return the latest snapshot."""

        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Experiment {slug} not found")

        if status is not None:
            record.status = status
        if guardrail_config is not None:
            record.guardrail_config = guardrail_config
        if sample_size_guardrail is not None:
            record.sample_size_guardrail = sample_size_guardrail

        await self._session.commit()
        await self._session.refresh(record)
        return (await self._snapshot_for(slug))

    async def evaluate_guardrails(self, slug: str) -> dict[str, Any]:
        """Evaluate guardrail breaches using latest metrics."""

        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Experiment {slug} not found")

        guardrail_config = record.guardrail_config if isinstance(record.guardrail_config, dict) else {}
        min_sample_size = record.sample_size_guardrail or guardrail_config.get("min_sample_size") or 0
        min_acceptance_rate = guardrail_config.get("min_acceptance_rate")
        max_acceptance_rate = guardrail_config.get("max_acceptance_rate")

        variant_results: list[dict[str, Any]] = []
        for variant in record.variants:
            latest_metric = self._latest_metric(variant.metrics)
            breaches: list[str] = []
            sample_size = latest_metric.sample_size if latest_metric else 0
            acceptance_rate = latest_metric.acceptance_rate if latest_metric else 0.0
            if min_sample_size and sample_size < int(min_sample_size):
                breaches.append("sample_size")
            if isinstance(min_acceptance_rate, (int, float)) and acceptance_rate < float(min_acceptance_rate):
                breaches.append("min_acceptance_rate")
            if isinstance(max_acceptance_rate, (int, float)) and acceptance_rate > float(max_acceptance_rate):
                breaches.append("max_acceptance_rate")
            variant_results.append(
                {
                    "variant_key": variant.key,
                    "bundle_slug": variant.bundle_slug,
                    "breaches": breaches,
                    "latest_metric": latest_metric.__dict__ if latest_metric else None,
                }
            )

        return {
            "experiment": slug,
            "breaches": variant_results,
            "evaluated_at": datetime.now(timezone.utc),
        }

    async def publish_overrides(self, slug: str) -> ExperimentSnapshot:
        """Mark experiment as running and return snapshot for storefront syncing."""

        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Experiment {slug} not found")

        record.status = CatalogBundleExperimentStatus.RUNNING
        await self._session.commit()
        await self._session.refresh(record)
        snapshot = await self._snapshot_for(slug)
        snapshot.provenance["published_at"] = datetime.now(timezone.utc)
        return snapshot

    async def _snapshot_for(self, slug: str) -> ExperimentSnapshot:
        record = await self._load_experiment(slug)
        if record is None:
            raise ValueError(f"Experiment {slug} not found")
        snapshots = await self.list_experiments()
        for snapshot in snapshots:
            if snapshot.slug == slug:
                return snapshot
        raise ValueError(f"Snapshot for {slug} not found")

    async def _load_experiment(self, slug: str) -> CatalogBundleExperiment | None:
        stmt = (
            select(CatalogBundleExperiment)
            .options(
                selectinload(CatalogBundleExperiment.variants).selectinload(
                    CatalogBundleExperimentVariant.metrics
                )
            )
            .where(CatalogBundleExperiment.slug == slug)
        )
        result = await self._session.execute(stmt)
        return result.scalars().unique().one_or_none()

    @staticmethod
    def _latest_metric(metrics: Iterable[CatalogBundleExperimentMetric]) -> ExperimentMetricSnapshot | None:
        latest: CatalogBundleExperimentMetric | None = None
        for metric in metrics:
            if latest is None:
                latest = metric
                continue
            if metric.computed_at > latest.computed_at:
                latest = metric
        if latest is None:
            return None
        return ExperimentMetricSnapshot(
            window_start=latest.window_start,
            lookback_days=latest.lookback_days,
            acceptance_rate=float(latest.acceptance_rate or 0),
            acceptance_count=latest.acceptance_count or 0,
            sample_size=latest.sample_size or 0,
            lift_vs_control=latest.lift_float(),
            guardrail_breached=bool(latest.guardrail_breached),
            computed_at=latest.computed_at,
        )


__all__ = [
    "CatalogExperimentService",
    "ExperimentSnapshot",
    "ExperimentVariantSnapshot",
    "ExperimentMetricSnapshot",
]

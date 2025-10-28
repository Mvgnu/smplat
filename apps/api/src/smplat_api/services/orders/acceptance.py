"""Bundle acceptance instrumentation for orders."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.catalog import CatalogBundle, CatalogBundleAcceptanceMetric
from smplat_api.models.catalog_experiments import (
    CatalogBundleExperiment,
    CatalogBundleExperimentMetric,
    CatalogBundleExperimentStatus,
    CatalogBundleExperimentVariant,
)
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum
from smplat_api.models.product import Product

DEFAULT_LOOKBACK_DAYS = 30


class BundleAcceptanceService:
    """Record bundle acceptance events derived from checkout orders."""

    # meta: provenance: bundle-analytics

    def __init__(self, session: AsyncSession, *, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> None:
        self._session = session
        self._lookback_days = lookback_days

    async def record_order_acceptance(self, product_slugs: Iterable[str]) -> None:
        """Persist acceptance counters for bundles touched by the order."""

        order_slugs = [slug for slug in product_slugs if slug]
        if not order_slugs:
            return

        bundles_stmt: Select[tuple[CatalogBundle]] = select(CatalogBundle).where(
            CatalogBundle.primary_product_slug.in_(order_slugs)
        )
        bundle_result = await self._session.execute(bundles_stmt)
        bundles = list(bundle_result.scalars())
        if not bundles:
            return

        slug_set = set(order_slugs)
        now = dt.datetime.now(dt.timezone.utc)

        for bundle in bundles:
            components = set(bundle.component_slugs())
            if not components:
                continue

            accepted = components.issubset(slug_set)
            await self._update_metric(bundle.bundle_slug, accepted=accepted, occurred_at=now)

    async def _update_metric(self, bundle_slug: str, *, accepted: bool, occurred_at: dt.datetime) -> None:
        metric_stmt: Select[tuple[CatalogBundleAcceptanceMetric]] = select(CatalogBundleAcceptanceMetric).where(
            CatalogBundleAcceptanceMetric.bundle_slug == bundle_slug,
            CatalogBundleAcceptanceMetric.lookback_days == self._lookback_days,
        )
        metric_result = await self._session.execute(metric_stmt)
        metric = metric_result.scalar_one_or_none()

        sample_size = 1
        acceptance_count = 1 if accepted else 0

        if metric is None:
            metric = CatalogBundleAcceptanceMetric(
                bundle_slug=bundle_slug,
                lookback_days=self._lookback_days,
                acceptance_count=acceptance_count,
                sample_size=sample_size,
                acceptance_rate=self._compute_rate(acceptance_count, sample_size),
                last_accepted_at=occurred_at if accepted else None,
                computed_at=occurred_at,
            )
            self._session.add(metric)
            return

        metric.sample_size = (metric.sample_size or 0) + sample_size
        if accepted:
            metric.acceptance_count = (metric.acceptance_count or 0) + 1
            metric.last_accepted_at = occurred_at
        metric.acceptance_rate = self._compute_rate(metric.acceptance_count or 0, metric.sample_size or 0)
        metric.computed_at = occurred_at

    @staticmethod
    def _compute_rate(acceptance_count: int, sample_size: int) -> Decimal:
        if sample_size <= 0:
            return Decimal("0")
        return (Decimal(acceptance_count) / Decimal(sample_size)).quantize(Decimal("0.0001"))


class BundleAcceptanceAggregator:
    """Recompute bundle acceptance metrics over a configurable lookback."""

    # meta: provenance: bundle-analytics

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def recompute(self, *, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> None:
        """Recompute acceptance metrics using checkout orders within the lookback window."""

        now = dt.datetime.now(dt.timezone.utc)
        cutoff = now - dt.timedelta(days=lookback_days)

        order_stmt: Select[tuple[UUID, dt.datetime, str]] = (
            select(Order.id, Order.created_at, Product.slug)
            .join(OrderItem, OrderItem.order_id == Order.id)
            .join(Product, Product.id == OrderItem.product_id)
            .where(Order.source == OrderSourceEnum.CHECKOUT)
            .where(Order.created_at >= cutoff)
        )
        order_result = await self._session.execute(order_stmt)

        orders: dict[UUID, dict[str, set[str] | dt.datetime]] = {}
        for order_id, created_at, slug in order_result.all():
            if not slug:
                continue
            payload = orders.setdefault(order_id, {"created_at": created_at, "slugs": set()})
            payload["slugs"].add(slug)

        if not orders:
            return

        bundle_stmt: Select[tuple[CatalogBundle]] = select(CatalogBundle)
        bundle_result = await self._session.execute(bundle_stmt)
        bundles = list(bundle_result.scalars())

        bundle_payloads: dict[str, dict[str, Decimal | int | dt.datetime | None]] = {}
        for bundle in bundles:
            components = set(bundle.component_slugs())
            if not components:
                continue

            sample_size = 0
            acceptance_count = 0
            last_accepted_at: dt.datetime | None = None

            for order_payload in orders.values():
                slugs = order_payload["slugs"]
                if bundle.primary_product_slug not in slugs:
                    continue
                sample_size += 1
                if components.issubset(slugs):
                    acceptance_count += 1
                    if (
                        last_accepted_at is None
                        or order_payload["created_at"] > last_accepted_at
                    ):
                        last_accepted_at = order_payload["created_at"]

            payload = {
                "sample_size": sample_size,
                "acceptance_count": acceptance_count,
                "acceptance_rate": self._compute_rate(acceptance_count, sample_size),
                "last_accepted_at": last_accepted_at,
            }

            await self._persist_bundle_metric(bundle.bundle_slug, lookback_days, now, payload)
            bundle_payloads[bundle.bundle_slug] = payload

        await self._update_experiment_metrics(bundle_payloads, lookback_days, now)

    @staticmethod
    def _compute_rate(acceptance_count: int, sample_size: int) -> Decimal:
        if sample_size <= 0:
            return Decimal("0")
        return (Decimal(acceptance_count) / Decimal(sample_size)).quantize(Decimal("0.0001"))

    async def _persist_bundle_metric(
        self,
        bundle_slug: str,
        lookback_days: int,
        computed_at: dt.datetime,
        payload: dict[str, Decimal | int | dt.datetime | None],
    ) -> None:
        metric_stmt = select(CatalogBundleAcceptanceMetric).where(
            CatalogBundleAcceptanceMetric.bundle_slug == bundle_slug,
            CatalogBundleAcceptanceMetric.lookback_days == lookback_days,
        )
        metric_result = await self._session.execute(metric_stmt)
        metric = metric_result.scalar_one_or_none()

        sample_size = int(payload.get("sample_size") or 0)
        acceptance_count = int(payload.get("acceptance_count") or 0)
        acceptance_rate = payload.get("acceptance_rate")
        last_accepted_at = payload.get("last_accepted_at")

        if sample_size == 0:
            if metric is None:
                return
            metric.sample_size = 0
            metric.acceptance_count = 0
            metric.acceptance_rate = Decimal("0")
            metric.last_accepted_at = None
            metric.computed_at = computed_at
            return

        if metric is None:
            metric = CatalogBundleAcceptanceMetric(
                bundle_slug=bundle_slug,
                lookback_days=lookback_days,
                acceptance_count=acceptance_count,
                sample_size=sample_size,
                acceptance_rate=Decimal(acceptance_rate or Decimal("0")),
                last_accepted_at=last_accepted_at,
                computed_at=computed_at,
            )
            self._session.add(metric)
        else:
            metric.sample_size = sample_size
            metric.acceptance_count = acceptance_count
            metric.acceptance_rate = Decimal(acceptance_rate or Decimal("0"))
            metric.last_accepted_at = last_accepted_at
            metric.computed_at = computed_at

    async def _update_experiment_metrics(
        self,
        bundle_payloads: dict[str, dict[str, Decimal | int | dt.datetime | None]],
        lookback_days: int,
        computed_at: dt.datetime,
    ) -> None:
        if not bundle_payloads:
            return

        experiment_stmt = (
            select(CatalogBundleExperiment, CatalogBundleExperimentVariant)
            .join(CatalogBundleExperimentVariant)
            .where(
                CatalogBundleExperiment.status.in_(
                    [
                        CatalogBundleExperimentStatus.RUNNING,
                        CatalogBundleExperimentStatus.PAUSED,
                    ]
                )
            )
        )
        result = await self._session.execute(experiment_stmt)
        records = result.all()
        if not records:
            return

        experiments: dict[UUID, CatalogBundleExperiment] = {}
        variants_by_experiment: dict[UUID, list[CatalogBundleExperimentVariant]] = defaultdict(list)
        for experiment, variant in records:
            experiments[experiment.id] = experiment
            variants_by_experiment[experiment.id].append(variant)

        for experiment_id, variants in variants_by_experiment.items():
            experiment = experiments[experiment_id]
            guardrail_config = experiment.guardrail_config if isinstance(experiment.guardrail_config, dict) else {}
            min_sample_size = experiment.sample_size_guardrail or guardrail_config.get("min_sample_size") or 0
            min_acceptance_rate = guardrail_config.get("min_acceptance_rate")
            max_acceptance_rate = guardrail_config.get("max_acceptance_rate")

            control_rate: Decimal | None = None

            variant_payloads: dict[UUID, dict[str, Decimal | int | dt.datetime | None]] = {}
            for variant in variants:
                variant_payloads[variant.id] = bundle_payloads.get(variant.bundle_slug or "", {})
                if variant.is_control:
                    payload = variant_payloads[variant.id]
                    rate = payload.get("acceptance_rate")
                    if isinstance(rate, Decimal):
                        control_rate = rate

            for variant in variants:
                payload = variant_payloads.get(variant.id, {})
                sample_size = int(payload.get("sample_size") or 0)
                acceptance_count = int(payload.get("acceptance_count") or 0)
                acceptance_rate = payload.get("acceptance_rate")
                if not isinstance(acceptance_rate, Decimal):
                    acceptance_rate = Decimal("0")

                lift_vs_control: Decimal | None = None
                if (
                    control_rate is not None
                    and isinstance(control_rate, Decimal)
                    and variant.is_control is False
                    and control_rate > Decimal("0")
                ):
                    lift_vs_control = (acceptance_rate - control_rate) / control_rate
                    lift_vs_control = lift_vs_control.quantize(Decimal("0.0001"))

                guardrail_breached = False
                if min_sample_size and sample_size < int(min_sample_size):
                    guardrail_breached = True
                if isinstance(min_acceptance_rate, (int, float, Decimal)) and acceptance_rate < Decimal(str(min_acceptance_rate)):
                    guardrail_breached = True
                if isinstance(max_acceptance_rate, (int, float, Decimal)) and acceptance_rate > Decimal(str(max_acceptance_rate)):
                    guardrail_breached = True

                metric_stmt = select(CatalogBundleExperimentMetric).where(
                    CatalogBundleExperimentMetric.variant_id == variant.id,
                    CatalogBundleExperimentMetric.window_start == computed_at.date(),
                    CatalogBundleExperimentMetric.lookback_days == lookback_days,
                )
                metric_result = await self._session.execute(metric_stmt)
                metric = metric_result.scalar_one_or_none()

                if metric is None:
                    metric = CatalogBundleExperimentMetric(
                        experiment_id=experiment_id,
                        variant_id=variant.id,
                        window_start=computed_at.date(),
                        lookback_days=lookback_days,
                        acceptance_rate=acceptance_rate,
                        acceptance_count=acceptance_count,
                        sample_size=sample_size,
                        lift_vs_control=lift_vs_control,
                        guardrail_breached=guardrail_breached,
                        computed_at=computed_at,
                    )
                    self._session.add(metric)
                else:
                    metric.acceptance_rate = acceptance_rate
                    metric.acceptance_count = acceptance_count
                    metric.sample_size = sample_size
                    metric.lift_vs_control = lift_vs_control
                    metric.guardrail_breached = guardrail_breached
                    metric.computed_at = computed_at


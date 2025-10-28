"""Seed deterministic bundle experiments for QA environments."""

# meta: script: bundle-experiments-seed

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import sys
from decimal import Decimal
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed bundle experimentation fixtures")
    parser.add_argument("--slug", default="qa-bundle-experiment", help="Experiment slug to create/update.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Execute inside a transaction and roll back changes for verification.",
    )
    return parser.parse_args()


async def _seed(slug: str, dry_run: bool) -> dict[str, str]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from sqlalchemy import delete, select  # type: ignore import-position

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.models.catalog import (  # type: ignore import-position
        CatalogBundle,
        CatalogBundleAcceptanceMetric,
    )
    from smplat_api.models.catalog_experiments import (  # type: ignore import-position
        CatalogBundleExperiment,
        CatalogBundleExperimentMetric,
        CatalogBundleExperimentStatus,
        CatalogBundleExperimentVariant,
    )

    control_bundle_slug = f"{slug}-control"
    variant_bundle_slug = f"{slug}-variant"
    now = dt.datetime.now(dt.timezone.utc)

    async with async_session() as session:
        existing = (
            await session.execute(
                select(CatalogBundleExperiment).where(CatalogBundleExperiment.slug == slug)
            )
        ).scalar_one_or_none()
        if existing:
            logger.info("Replacing existing experiment", slug=slug)
            await session.execute(
                delete(CatalogBundleExperiment).where(CatalogBundleExperiment.id == existing.id)
            )
            await session.flush()

        for bundle_slug, title, savings in [
            (control_bundle_slug, "QA Control Bundle", "Save 5%"),
            (variant_bundle_slug, "QA Variant Bundle", "Save 12%"),
        ]:
            record = (
                await session.execute(
                    select(CatalogBundle).where(CatalogBundle.bundle_slug == bundle_slug)
                )
            ).scalar_one_or_none()
            if record is None:
                record = CatalogBundle(
                    primary_product_slug="qa-primary-product",
                    bundle_slug=bundle_slug,
                    title=title,
                    description=f"Seeded fixture for {slug}",
                    savings_copy=savings,
                    cms_priority=80,
                    components=["qa-add-on"],
                    metadata_json={"seeded": True},
                )
                session.add(record)
        await session.flush()

        experiment = CatalogBundleExperiment(
            slug=slug,
            name="QA Bundle Experiment",
            description="Seeded experiment for QA validation",
            status=CatalogBundleExperimentStatus.RUNNING,
            guardrail_config={"min_acceptance_rate": 0.1},
            sample_size_guardrail=50,
            metadata_json={"seeded": True},
        )
        control_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="control",
            name="Control",
            weight=50,
            is_control=True,
            bundle_slug=control_bundle_slug,
            override_payload={"headline": "Baseline"},
            metadata_json={"seeded": True},
        )
        test_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="variant",
            name="Variant",
            weight=50,
            is_control=False,
            bundle_slug=variant_bundle_slug,
            override_payload={"headline": "Variant"},
            metadata_json={"seeded": True},
        )
        session.add_all([experiment, control_variant, test_variant])
        await session.flush()

        # Seed acceptance metrics for storefront + guardrail evaluation
        for bundle_slug, acceptance_rate, acceptance_count in [
            (control_bundle_slug, Decimal("0.1800"), 180),
            (variant_bundle_slug, Decimal("0.0950"), 95),
        ]:
            metric = (
                await session.execute(
                    select(CatalogBundleAcceptanceMetric).where(
                        CatalogBundleAcceptanceMetric.bundle_slug == bundle_slug,
                        CatalogBundleAcceptanceMetric.lookback_days == 30,
                    )
                )
            ).scalar_one_or_none()
            if metric is None:
                metric = CatalogBundleAcceptanceMetric(
                    bundle_slug=bundle_slug,
                    lookback_days=30,
                    acceptance_rate=acceptance_rate,
                    acceptance_count=acceptance_count,
                    sample_size=1000,
                    computed_at=now,
                    metadata_json={"seeded": True},
                )
                session.add(metric)
            else:
                metric.acceptance_rate = acceptance_rate
                metric.acceptance_count = acceptance_count
                metric.sample_size = 1000
                metric.computed_at = now
                metric.metadata_json = {"seeded": True}
        await session.flush()

        session.add_all(
            [
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=control_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.1800"),
                    acceptance_count=180,
                    sample_size=1000,
                    lift_vs_control=Decimal("0"),
                    guardrail_breached=False,
                    computed_at=now,
                    metadata_json={"seeded": True},
                ),
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=test_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.0950"),
                    acceptance_count=95,
                    sample_size=1000,
                    lift_vs_control=Decimal("-0.4722"),
                    guardrail_breached=True,
                    computed_at=now,
                    metadata_json={"seeded": True},
                ),
            ]
        )
        await session.flush()

        summary = {
            "experiment": slug,
            "control_bundle": control_bundle_slug,
            "variant_bundle": variant_bundle_slug,
        }

        if dry_run:
            await session.rollback()
        else:
            await session.commit()
        return summary


def main() -> int:
    args = parse_args()
    summary = asyncio.run(_seed(args.slug, args.dry_run))
    logger.success("Bundle experiment seed complete", **summary, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Backfill bundle experiment telemetry for QA or production readiness.

Intended usage: run manually or via job runner when enabling experiments on
staging/production. The script reuses the bundle acceptance aggregator to
recompute bundle + experiment metrics for the provided lookback window.

Example::
    python tooling/scripts/backfill_bundle_experiments.py --lookback-days 90

Use ``--dry-run`` to exercise the aggregation logic without mutating the
database. Transactions are rolled back automatically when dry run mode is
enabled.
"""

# meta: script: bundle-experiments-backfill

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import sys
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill bundle experiment metrics")
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=30,
        help="Number of days to consider when rebuilding acceptance metrics.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run aggregation inside a transaction and roll back changes.",
    )
    return parser.parse_args()


async def _run(lookback_days: int, dry_run: bool) -> dict[str, int]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from sqlalchemy import select  # type: ignore import-position

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.models.catalog_experiments import (  # type: ignore import-position
        CatalogBundleExperimentMetric,
    )
    from smplat_api.services.orders.acceptance import (  # type: ignore import-position
        BundleAcceptanceAggregator,
    )

    async with async_session() as session:
        aggregator = BundleAcceptanceAggregator(session)
        await aggregator.recompute(lookback_days=lookback_days)

        if dry_run:
            await session.rollback()
        else:
            await session.commit()

        cutoff = dt.date.today() - dt.timedelta(days=lookback_days)
        metric_stmt = select(CatalogBundleExperimentMetric).where(
            CatalogBundleExperimentMetric.window_start >= cutoff
        )
        result = await session.execute(metric_stmt)
        metrics = result.scalars().all()
        return {"metrics": len(metrics)}


def main() -> int:
    args = parse_args()
    if args.lookback_days <= 0:
        logger.error("Lookback days must be positive", lookback_days=args.lookback_days)
        return 1

    summary = asyncio.run(_run(args.lookback_days, args.dry_run))
    logger.success(
        "Bundle experiment backfill completed",
        lookback_days=args.lookback_days,
        dry_run=args.dry_run,
        metrics_processed=summary.get("metrics", 0),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

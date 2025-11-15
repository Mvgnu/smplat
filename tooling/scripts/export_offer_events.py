"""Export checkout offer analytics events from the FastAPI-managed database.

This script provides a lightweight reporting utility for data and product
teams now that Prisma has been retired from the web workspace. It queries the
`checkout_offer_events` table via the FastAPI SQLAlchemy models and emits the
results as CSV or JSON for downstream analysis.

Example::
    python tooling/scripts/export_offer_events.py --lookback-days 14 --format csv --output offer-events.csv
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export checkout offer analytics events")
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=7,
        help="Number of days to include in the export (defaults to 7).",
    )
    parser.add_argument(
        "--format",
        choices=("csv", "json"),
        default="csv",
        help="Output format for the export.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file path. Defaults to checkout-offer-events.<format> in the current directory.",
    )
    return parser.parse_args()


async def _fetch_events(lookback_days: int) -> list[dict[str, Any]]:
    if lookback_days <= 0:
        raise ValueError("lookback_days must be positive")

    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from sqlalchemy import Select, select  # type: ignore import-position

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.models.analytics import CheckoutOfferEvent  # type: ignore import-position

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)

    stmt: Select[CheckoutOfferEvent] = (
        select(CheckoutOfferEvent)
        .where(CheckoutOfferEvent.created_at >= cutoff)
        .order_by(CheckoutOfferEvent.created_at.desc())
    )

    async with async_session() as session:
        result = await session.execute(stmt)
        events = result.scalars().all()

    serialized: list[dict[str, Any]] = []
    for event in events:
        serialized.append(
            {
                "id": str(event.id),
                "created_at": event.created_at.isoformat(),
                "offer_slug": event.offer_slug,
                "target_slug": event.target_slug,
                "event_type": event.event_type,
                "action": event.action,
                "cart_total": str(event.cart_total) if event.cart_total is not None else None,
                "currency": event.currency,
                "order_reference": event.order_reference,
                "metadata": event.metadata_json,
            }
        )
    return serialized


def _write_csv(output_path: Path, events: list[dict[str, Any]]) -> None:
    fieldnames = [
        "id",
        "created_at",
        "offer_slug",
        "target_slug",
        "event_type",
        "action",
        "cart_total",
        "currency",
        "order_reference",
        "metadata",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for event in events:
            row = event.copy()
            if row["metadata"] is not None:
                row["metadata"] = json.dumps(row["metadata"], ensure_ascii=False)
            writer.writerow(row)


def _write_json(output_path: Path, events: list[dict[str, Any]]) -> None:
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(events, handle, ensure_ascii=False, indent=2)


async def _run() -> int:
    args = parse_args()
    try:
        events = await _fetch_events(args.lookback_days)
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        logger.exception("Failed to fetch checkout offer events", error=str(exc))
        return 1

    if not events:
        logger.warning("No checkout offer events found for lookback window", lookback_days=args.lookback_days)

    output_path = args.output or Path(f"checkout-offer-events.{args.format}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.format == "csv":
        _write_csv(output_path, events)
    else:
        _write_json(output_path, events)

    logger.success(
        "Exported checkout offer analytics",
        output=str(output_path),
        format=args.format,
        lookback_days=args.lookback_days,
        events=len(events),
    )
    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())

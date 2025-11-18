"""Export onboarding pricing experiment segments for analytics/data-lake sinks.

Usage examples:

    # Print the latest 250 rows as JSON to stdout
    python tooling/scripts/export_onboarding_pricing_segments.py --limit 250

    # Stream to a webhook sink defined via env or flag
    python tooling/scripts/export_onboarding_pricing_segments.py --sink webhook --webhook-url https://analytics.internal/events

    # Resume from a previous cursor (exclusive) and write to a file
    python tooling/scripts/export_onboarding_pricing_segments.py --cursor "2024-12-01T00:00:00Z" --sink file --file-path /tmp/onboarding_segments.ndjson
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Flatten onboarding pricing experiment events for analytics sinks",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=250,
        help="Maximum number of experiment rows to stream in this invocation.",
    )
    parser.add_argument(
        "--cursor",
        type=str,
        default=None,
        help="Only export events recorded before this ISO8601 timestamp.",
    )
    parser.add_argument(
        "--sink",
        choices=("stdout", "file", "webhook"),
        default="stdout",
        help="Destination for the flattened rows.",
    )
    parser.add_argument(
        "--file-path",
        type=str,
        default=None,
        help="Path for --sink file writes. Defaults to ./onboarding_pricing_segments.ndjson",
    )
    parser.add_argument(
        "--webhook-url",
        type=str,
        default=None,
        help="Override analytics webhook URL (falls back to ANALYTICS_SEGMENTS_WEBHOOK).",
    )
    parser.add_argument(
        "--cursor-store",
        choices=("none", "file"),
        default="none",
        help="Optional persistence backend for pagination cursors. Use with --cursor-store-path.",
    )
    parser.add_argument(
        "--cursor-store-path",
        type=str,
        default="onboarding_export_cursor.json",
        help="Filesystem path for storing pagination metadata when --cursor-store=file.",
    )
    return parser.parse_args()


def _parse_iso_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Invalid cursor timestamp provided; ignoring", value=value)
        return None


def _load_cursor_from_store(store: str, path: str) -> datetime | None:
    if store != "file":
        return None
    target = Path(path)
    if not target.exists():
        return None
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return _parse_iso_timestamp(raw.get("cursor"))
        if isinstance(raw, str):
            return _parse_iso_timestamp(raw)
    except json.JSONDecodeError:
        return _parse_iso_timestamp(target.read_text(encoding="utf-8").strip())
    return None


def _persist_cursor(store: str, path: str, *, cursor: str, rows: int) -> None:
    if store != "file":
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "cursor": cursor,
        "rows": rows,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Persisted onboarding export cursor", store=store, path=str(target), cursor=cursor, rows=rows)


async def _stream_rows(
    *,
    limit: int,
    cursor: datetime | None,
    sink: str,
    file_path: str | None,
    webhook_url: str | None,
) -> list[dict[str, Any]]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.services.orders.onboarding import (  # type: ignore import-position
        OnboardingService,
    )

    async with async_session() as session:
        service = OnboardingService(session)
        rows = await service.export_pricing_experiment_events(limit=limit, cursor=cursor)

    payloads: list[dict[str, Any]] = [
        {
            "eventId": str(row.event_id),
            "journeyId": str(row.journey_id),
            "orderId": str(row.order_id),
            "orderNumber": row.order_number,
            "orderTotal": float(row.order_total) if row.order_total is not None else None,
            "orderCurrency": row.order_currency,
            "loyaltyProjectionPoints": row.loyalty_projection_points,
            "slug": row.slug,
            "variantKey": row.variant_key,
            "variantName": row.variant_name,
            "isControl": row.is_control,
            "assignmentStrategy": row.assignment_strategy,
            "status": row.status,
            "featureFlagKey": row.feature_flag_key,
            "recordedAt": row.recorded_at.isoformat(),
        }
        for row in rows
    ]

    if sink == "stdout":
        for entry in payloads:
            print(json.dumps(entry))
    elif sink == "file":
        target = Path(file_path or "onboarding_pricing_segments.ndjson")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as handle:
            for entry in payloads:
                handle.write(json.dumps(entry))
                handle.write("\n")
        logger.info("Wrote onboarding pricing segments", path=str(target), rows=len(payloads))
    elif sink == "webhook":
        destination = webhook_url or os.environ.get("ANALYTICS_SEGMENTS_WEBHOOK")
        if not destination:
            raise ValueError("Missing webhook URL for analytics export")
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(destination, json={"events": payloads})
            response.raise_for_status()
        logger.info("Published onboarding pricing segments to webhook", url=destination, rows=len(payloads))

    if payloads:
        logger.info(
            "Exported pricing experiment rows",
            rows=len(payloads),
            newest=payloads[0]["recordedAt"],
            oldest=payloads[-1]["recordedAt"],
        )
    else:
        logger.warning("No pricing experiment rows returned for the provided cursor/limit")

    return payloads


def main() -> int:
    args = parse_args()
    cursor = _parse_iso_timestamp(args.cursor)
    if cursor is None and args.cursor_store != "none":
        cursor = _load_cursor_from_store(args.cursor_store, args.cursor_store_path)

    payloads = asyncio.run(
        _stream_rows(
            limit=args.limit,
            cursor=cursor,
            sink=args.sink,
            file_path=args.file_path,
            webhook_url=args.webhook_url,
        )
    )
    if payloads and args.cursor_store != "none":
        next_cursor = payloads[-1]["recordedAt"]
        _persist_cursor(args.cursor_store, args.cursor_store_path, cursor=next_cursor, rows=len(payloads))

    logger.success("Onboarding pricing experiment export complete", rows=len(payloads), sink=args.sink)
    return 0


if __name__ == "__main__":
    sys.exit(main())

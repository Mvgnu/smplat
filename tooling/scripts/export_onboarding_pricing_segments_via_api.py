"\"\"\"Call the public reporting endpoint to export onboarding experiment events.

This wrapper mirrors `tooling/scripts/export_onboarding_pricing_segments.py` but fetches data
via HTTP (using `/api/v1/reporting/onboarding/experiment-events`) so it can run from any
environment with API access + checkout API key.
"\"\""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export onboarding pricing experiment events via HTTP")
    parser.add_argument("--limit", type=int, default=250, help="Maximum rows per request.")
    parser.add_argument(
        "--cursor",
        type=str,
        default=None,
        help="Return events recorded before this ISO8601 timestamp (matches nextCursor semantics).",
    )
    parser.add_argument(
        "--cursor-store",
        choices=("none", "file"),
        default="none",
        help="Persist pagination cursors locally (combine with --cursor-store-path).",
    )
    parser.add_argument(
        "--cursor-store-path",
        type=str,
        default="onboarding_export_cursor.json",
        help="Filesystem path for cursor metadata when --cursor-store=file.",
    )
    parser.add_argument(
        "--sink",
        choices=("stdout", "file", "webhook"),
        default="stdout",
        help="Destination for flattened rows.",
    )
    parser.add_argument(
        "--file-path",
        type=str,
        default=None,
        help="Output path for --sink file (default ./onboarding_pricing_segments.ndjson).",
    )
    parser.add_argument(
        "--webhook-url",
        type=str,
        default=None,
        help="Webhook destination for --sink webhook. Falls back to ANALYTICS_SEGMENTS_WEBHOOK.",
    )
    parser.add_argument(
        "--api-base-url",
        type=str,
        default=None,
        help="Override API base URL. Defaults to $API_BASE_URL or http://localhost:8000.",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=None,
        help="Checkout API key passed via X-API-Key header. Defaults to $CHECKOUT_API_KEY.",
    )
    return parser.parse_args()


def _load_cursor_from_file(path: str) -> str | None:
    target = Path(path)
    if not target.exists():
        return None
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            cursor = payload.get("cursor")
            if isinstance(cursor, str):
                return cursor
        if isinstance(payload, str):
            return payload
    except json.JSONDecodeError:
        return target.read_text(encoding="utf-8").strip()
    return None


def _persist_cursor_to_file(path: str, cursor: str, rows: int) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "cursor": cursor,
                "rows": rows,
                "updatedAt": datetime.utcnow().isoformat() + "Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Persisted API export cursor", path=str(target), cursor=cursor, rows=rows)


async def _fetch_events(
    *,
    limit: int,
    cursor: str | None,
    api_base_url: str,
    api_key: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    params = {"limit": str(limit)}
    if cursor:
        params["cursor"] = cursor

    headers: dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key

    endpoint = f"{api_base_url.rstrip('/')}/api/v1/reporting/onboarding/experiment-events"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
    payload = response.json()
    events = payload.get("events", []) if isinstance(payload, dict) else []
    next_cursor = payload.get("nextCursor") if isinstance(payload, dict) else None
    return events, next_cursor


def _emit_rows(payloads: list[dict[str, Any]], *, sink: str, file_path: str | None, webhook_url: str | None) -> None:
    if sink == "stdout":
        for entry in payloads:
            print(json.dumps(entry))
        return
    if sink == "file":
        target = Path(file_path or "onboarding_pricing_segments.ndjson")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as handle:
            for entry in payloads:
                handle.write(json.dumps(entry))
                handle.write("\n")
        logger.info("Wrote onboarding experiment rows to file", path=str(target), rows=len(payloads))
        return
    if sink == "webhook":
        destination = webhook_url or os.environ.get("ANALYTICS_SEGMENTS_WEBHOOK")
        if not destination:
            raise ValueError("Missing webhook URL for analytics export")
        response = httpx.post(destination, json={"events": payloads}, timeout=30)
        response.raise_for_status()
        logger.info("Published onboarding experiment rows to webhook", url=destination, rows=len(payloads))


async def _run() -> int:
    args = parse_args()
    cursor_str = args.cursor
    if not cursor_str and args.cursor_store == "file":
        cursor_str = _load_cursor_from_file(args.cursor_store_path)

    api_base_url = args.api_base_url or os.environ.get("API_BASE_URL") or "http://localhost:8000"
    api_key = args.api_key or os.environ.get("CHECKOUT_API_KEY")

    payloads, next_cursor = await _fetch_events(
        limit=args.limit,
        cursor=cursor_str,
        api_base_url=api_base_url,
        api_key=api_key,
    )
    _emit_rows(payloads, sink=args.sink, file_path=args.file_path, webhook_url=args.webhook_url)

    if payloads:
        logger.info(
            "Exported onboarding experiment rows via API",
            rows=len(payloads),
            newest=payloads[0].get("recordedAt"),
            oldest=payloads[-1].get("recordedAt"),
        )
    else:
        logger.warning("No onboarding experiment rows returned for the provided cursor/limit (API)")

    if next_cursor and args.cursor_store == "file":
        _persist_cursor_to_file(args.cursor_store_path, next_cursor, len(payloads))

    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())

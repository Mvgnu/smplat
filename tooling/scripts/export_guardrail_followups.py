"""Export guardrail follow-up entries for Snowflake / analytics sinks.

Examples:

    # Dump the 200 most recent entries to stdout
    python tooling/scripts/export_guardrail_followups.py --limit 200

    # Stream entries older than the stored cursor to a webhook destination
    python tooling/scripts/export_guardrail_followups.py --sink webhook --cursor-store file --webhook-url https://analytics.example/hooks

    # Only export follow-ups for a single provider and write to NDJSON
    python tooling/scripts/export_guardrail_followups.py --provider-id provider-123 --sink file --file-path /tmp/guardrail.ndjson
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export provider guardrail follow-up entries for analytics sinks.")
    parser.add_argument("--limit", type=int, default=250, help="Maximum number of rows to export.")
    parser.add_argument(
        "--cursor",
        type=str,
        default=None,
        help="Only export entries created before this ISO8601 timestamp.",
    )
    parser.add_argument(
        "--provider-id",
        type=str,
        default=None,
        help="Optional provider filter. When omitted, exports guardrail follow-ups for every provider.",
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
        help="Target path for --sink file writes. Defaults to ./guardrail_followups.ndjson",
    )
    parser.add_argument(
        "--webhook-url",
        type=str,
        default=None,
        help="Override analytics webhook URL (falls back to ANALYTICS_GUARDRAIL_WEBHOOK).",
    )
    parser.add_argument(
        "--cursor-store",
        choices=("none", "file"),
        default="none",
        help="Persist pagination cursors between runs (use --cursor-store-path).",
    )
    parser.add_argument(
        "--cursor-store-path",
        type=str,
        default="guardrail_followups_cursor.json",
        help="Filesystem path for storing pagination metadata when --cursor-store=file.",
    )
    return parser.parse_args()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Invalid ISO8601 timestamp provided; ignoring cursor", value=value)
        return None


def _load_cursor_from_store(store: str, path: str) -> datetime | None:
    if store != "file":
        return None
    target = Path(path)
    if not target.exists():
        return None
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return _parse_iso(payload.get("cursor"))
        if isinstance(payload, str):
            return _parse_iso(payload)
    except json.JSONDecodeError:
        return _parse_iso(target.read_text(encoding="utf-8").strip())
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
    logger.info("Persisted guardrail follow-up cursor", path=str(target), cursor=cursor, rows=rows)


@dataclass
class GuardrailFollowUpRow:
    followUpId: str
    providerId: str
    providerName: str | None
    action: str
    notes: str | None
    platformContext: dict[str, Any] | None
    conversionCursor: str | None
    conversionHref: str | None
    createdAt: str


async def _fetch_rows(
    *,
    limit: int,
    cursor: datetime | None,
    provider_id: str | None,
) -> list[GuardrailFollowUpRow]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from sqlalchemy import select  # type: ignore import-position

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.models.provider_guardrail_followup import (  # type: ignore import-position
        ProviderGuardrailFollowUp,
    )

    async with async_session() as session:
        stmt = (
            select(ProviderGuardrailFollowUp)
            .order_by(ProviderGuardrailFollowUp.created_at.desc())
            .limit(limit)
        )
        if provider_id:
            stmt = stmt.where(ProviderGuardrailFollowUp.provider_id == provider_id)
        if cursor:
            stmt = stmt.where(ProviderGuardrailFollowUp.created_at < cursor)

        result = await session.execute(stmt)
        rows: list[ProviderGuardrailFollowUp] = list(result.scalars())

    return [
        GuardrailFollowUpRow(
            followUpId=str(entry.id),
            providerId=entry.provider_id,
            providerName=entry.provider_name,
            action=entry.action,
            notes=entry.notes,
            platformContext=entry.platform_context,
            conversionCursor=entry.conversion_cursor,
            conversionHref=entry.conversion_href,
            createdAt=entry.created_at.isoformat(),
        )
        for entry in rows
    ]


def _emit_rows(payloads: list[GuardrailFollowUpRow], *, sink: str, file_path: str | None, webhook_url: str | None) -> None:
    flattened = [asdict(entry) for entry in payloads]
    if sink == "stdout":
        for entry in flattened:
            print(json.dumps(entry))
        return
    if sink == "file":
        target = Path(file_path or "guardrail_followups.ndjson")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as handle:
            for entry in flattened:
                handle.write(json.dumps(entry))
                handle.write("\n")
        logger.info("Wrote guardrail follow-ups to file", path=str(target), rows=len(flattened))
        return
    if sink == "webhook":
        destination = webhook_url or os.environ.get("ANALYTICS_GUARDRAIL_WEBHOOK")
        if not destination:
            raise ValueError("Missing webhook URL for guardrail export")
        response = httpx.post(destination, json={"followUps": flattened}, timeout=30)
        response.raise_for_status()
        logger.info("Published guardrail follow-ups to webhook", url=destination, rows=len(flattened))


async def _run() -> int:
    args = parse_args()
    cursor = _parse_iso(args.cursor)
    if cursor is None:
        cursor = _load_cursor_from_store(args.cursor_store, args.cursor_store_path)

    rows = await _fetch_rows(limit=args.limit, cursor=cursor, provider_id=args.provider_id)
    _emit_rows(rows, sink=args.sink, file_path=args.file_path, webhook_url=args.webhook_url)

    if rows:
        newest = rows[0].createdAt
        oldest = rows[-1].createdAt
        logger.info(
            "Exported guardrail follow-up entries",
            rows=len(rows),
            providerFilter=args.provider_id,
            newest=newest,
            oldest=oldest,
        )
        next_cursor = rows[-1].createdAt
        if args.cursor_store == "file":
            _persist_cursor(args.cursor_store, args.cursor_store_path, cursor=next_cursor, rows=len(rows))
    else:
        logger.warning("No guardrail follow-ups found for the provided filters")

    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())

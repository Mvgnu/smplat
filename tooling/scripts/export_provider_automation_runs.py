#!/usr/bin/env python3
"""Export provider automation run history for BI/reporting pipelines."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx


def parse_args() -> argparse.Namespace:
    default_base_url = os.getenv("SMPLAT_API_BASE_URL", "http://localhost:8000")
    parser = argparse.ArgumentParser(description="Export provider automation run history snapshots.")
    parser.add_argument(
        "--base-url",
        default=default_base_url,
        help=(
            "Base URL of the SMPLAT API service "
            "(defaults to SMPLAT_API_BASE_URL or http://localhost:8000)."
        ),
    )
    parser.add_argument(
        "--auth-token",
        help="Optional bearer token used for Authorization header (or SMPLAT_AUTOMATION_AUTH_TOKEN).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Number of runs per category (replay/alerts) to fetch (default: 50).",
    )
    parser.add_argument(
        "--format",
        choices=("json", "csv"),
        default="json",
        help="Export format (json or csv).",
    )
    parser.add_argument("--output", type=Path, help="Optional file path to write the export.")
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="HTTP request timeout in seconds (default: 15).",
    )
    return parser.parse_args()


def _flatten_runs(history: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for category, entries in history.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            summary = entry.get("summary") or {}
            if not isinstance(summary, dict):
                summary = {}
            rows.append(
                {
                    "category": category,
                    "ran_at": entry.get("ranAt"),
                    "scheduled_backlog": summary.get("scheduledBacklog"),
                    "next_scheduled_at": summary.get("nextScheduledAt"),
                    "processed": summary.get("processed"),
                    "succeeded": summary.get("succeeded"),
                    "failed": summary.get("failed"),
                    "alerts_sent": summary.get("alertsSent"),
                    "alerts_digest": summary.get("alertsDigest"),
                    "load_alerts_digest": summary.get("loadAlertsDigest"),
                    "summary": summary,
                }
            )
    return rows


def _write_json(rows: List[Dict[str, Any]], path: Path | None) -> None:
    payload = {"runs": rows}
    content = json.dumps(payload, indent=2)
    if path:
        path.write_text(content)
        print(f"[export-provider-automation-runs] ✅ wrote {len(rows)} rows to {path}")
    else:
        print(content)


def _write_csv(rows: List[Dict[str, Any]], path: Path | None) -> None:
    fieldnames = [
        "category",
        "ran_at",
        "scheduled_backlog",
        "next_scheduled_at",
        "processed",
        "succeeded",
        "failed",
        "alerts_sent",
        "alerts_digest",
        "load_alerts_digest",
        "summary_json",
    ]
    output = path.open("w", newline="", encoding="utf-8") if path else sys.stdout
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                "category": row["category"],
                "ran_at": row["ran_at"],
                "scheduled_backlog": row.get("scheduled_backlog"),
                "next_scheduled_at": row.get("next_scheduled_at"),
                "processed": row.get("processed"),
                "succeeded": row.get("succeeded"),
                "failed": row.get("failed"),
                "alerts_sent": row.get("alerts_sent"),
                "alerts_digest": json.dumps(row.get("alerts_digest", [])),
                "load_alerts_digest": json.dumps(row.get("load_alerts_digest", [])),
                "summary_json": json.dumps(row.get("summary", {})),
            }
        )
    if path:
        output.close()
        print(f"[export-provider-automation-runs] ✅ wrote {len(rows)} rows to {path}")


def _resolve_output_path(args: argparse.Namespace) -> Path | None:
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        return args.output

    export_dir = os.getenv("SMPLAT_AUTOMATION_EXPORT_DIR")
    if not export_dir:
        return None

    output_dir = Path(export_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    extension = "json" if args.format == "json" else "csv"
    return output_dir / f"provider_automation_runs_{timestamp}.{extension}"


def main() -> None:
    args = parse_args()
    headers: Dict[str, str] = {}
    auth_token = args.auth_token or os.getenv("SMPLAT_AUTOMATION_AUTH_TOKEN")
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    url = f"{args.base_url}/api/v1/fulfillment/providers/automation/status/history?limit={args.limit}"
    with httpx.Client(timeout=args.timeout) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        history = response.json()

    rows = _flatten_runs(history)
    if not rows:
        print("[export-provider-automation-runs] ⚠️ no runs returned from API")

    output_path = _resolve_output_path(args)

    if args.format == "json":
        _write_json(rows, output_path)
    else:
        _write_csv(rows, output_path)


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as exc:  # pragma: no cover - thin CLI
        print(
            f"[export-provider-automation-runs] ❌ HTTP {exc.response.status_code} while calling {exc.request.url}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as exc:  # pragma: no cover
        print(f"[export-provider-automation-runs] ❌ Unexpected error: {exc}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""CLI helper to hit the MetricSourcer validation endpoint."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

import httpx


def _parse_manual_metrics(entries: list[str]) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    for entry in entries:
        if "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        if value.isdigit():
            metrics[key] = int(value)
            continue

        try:
            metrics[key] = float(value)
            continue
        except ValueError:
            pass

        metrics[key] = value
    return metrics


async def _run(args: argparse.Namespace) -> int:
    base_url = args.api or os.getenv("API_BASE_URL", "http://localhost:8000")
    api_key = args.api_key or os.getenv("CHECKOUT_API_KEY")

    url = f"{base_url.rstrip('/')}/api/v1/metrics/accounts/validate"
    payload: dict[str, Any] = {
        "platform": args.platform,
        "handle": args.handle,
    }
    if args.customer_profile_id:
        payload["customerProfileId"] = args.customer_profile_id
    if args.metadata:
        payload["metadata"] = json.loads(args.metadata)

    if args.manual:
        payload["manualMetrics"] = _parse_manual_metrics(args.manual)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, json=payload, headers=headers)

    if response.status_code >= 400:
        print(f"Request failed ({response.status_code}): {response.text}", file=sys.stderr)
        return 1

    body = response.json()
    snapshot = body["snapshot"]
    account = body["account"]
    print("Snapshot:")
    print(json.dumps(snapshot, indent=2))
    print("\nPersisted account:")
    print(json.dumps(account, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a social account via MetricSourcer.")
    parser.add_argument("platform", choices=["instagram", "tiktok", "youtube"], help="Platform slug for the account.")
    parser.add_argument("handle", help="Handle to validate (accepts leading @).")
    parser.add_argument("--api", dest="api", help="Override API base URL (defaults to API_BASE_URL env).")
    parser.add_argument("--api-key", dest="api_key", help="Override checkout API key (defaults to CHECKOUT_API_KEY env).")
    parser.add_argument("--customer-profile-id", dest="customer_profile_id", help="Optional customer profile UUID.")
    parser.add_argument(
        "--metadata",
        help='JSON string persisted alongside the account (e.g. \'{"note":"manual test"}\').',
    )
    parser.add_argument(
        "--manual",
        nargs="*",
        help="Comma separated key=value overrides for manual metrics (e.g. followers=5000 avgLikes=200).",
    )

    args = parser.parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())

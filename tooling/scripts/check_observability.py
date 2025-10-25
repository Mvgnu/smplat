#!/usr/bin/env python3
"""Quick health check for SMPLAT observability endpoints.

Usage:
    python tooling/scripts/check_observability.py \
        --base-url https://staging-api.example.com \
        --api-key "$CHECKOUT_API_KEY"

The script validates:
  * Fulfillment observability: dead-lettered/failed counts are within thresholds.
  * Payments observability: checkout/webhook failures have not exceeded limits.
  * Catalog search telemetry (optional, requires checkout API key) is reachable.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any, Dict, Optional

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SMPLAT observability checker")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the SMPLAT API service.",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Checkout API key (required for payments + catalog observability endpoints).",
    )
    parser.add_argument(
        "--max-fulfillment-dead-lettered",
        type=int,
        default=0,
        help="Maximum allowed dead-lettered tasks before failing (default: 0).",
    )
    parser.add_argument(
        "--max-fulfillment-failed",
        type=int,
        default=0,
        help="Maximum allowed failed fulfillment tasks before failing (default: 0).",
    )
    parser.add_argument(
        "--max-payment-checkout-failures",
        type=int,
        default=0,
        help="Maximum allowed checkout session failures before failing (default: 0).",
    )
    parser.add_argument(
        "--max-payment-webhook-failures",
        type=int,
        default=0,
        help="Maximum allowed webhook failures before failing (default: 0).",
    )
    parser.add_argument(
        "--skip-catalog",
        action="store_true",
        help="Skip catalog telemetry validation (useful if catalog is not instrumented yet).",
    )
    parser.add_argument(
        "--max-catalog-zero-results-rate",
        type=float,
        default=0.2,
        help="Maximum allowed ratio (0-1) of catalog searches that return zero results before failing (default: 0.2).",
    )
    parser.add_argument(
        "--catalog-min-sample-size",
        type=int,
        default=10,
        help="Minimum number of catalog searches required before enforcing the zero-results SLO (default: 10).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="HTTP request timeout in seconds.",
    )
    return parser.parse_args()


async def _get_json(
    client: httpx.AsyncClient,
    path: str,
    *,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    response = await client.get(path, headers=headers)
    response.raise_for_status()
    return response.json()


def _fail(message: str) -> None:
    print(f"[check-observability] ❌ {message}")
    sys.exit(1)


def _log_ok(message: str) -> None:
    print(f"[check-observability] ✅ {message}")


async def validate_fulfillment(
    client: httpx.AsyncClient,
    max_dead_lettered: int,
    max_failed: int,
) -> None:
    payload = await _get_json(client, "/api/v1/fulfillment/observability")
    totals = payload.get("totals", {})
    dead_lettered = int(totals.get("dead_lettered", 0))
    failed = int(totals.get("failed", 0))

    if dead_lettered > max_dead_lettered:
        _fail(
            f"Fulfillment dead-lettered tasks {dead_lettered} exceed threshold {max_dead_lettered}"
        )
    if failed > max_failed:
        _fail(f"Fulfillment failures {failed} exceed threshold {max_failed}")

    _log_ok(
        f"Fulfillment observability OK (processed={totals.get('processed', 0)}, "
        f"failed={failed}, dead_lettered={dead_lettered})"
    )


async def validate_payments(
    client: httpx.AsyncClient,
    api_key: Optional[str],
    max_checkout_failures: int,
    max_webhook_failures: int,
) -> None:
    if not api_key:
        _log_ok("Skipping payments observability (no API key provided)")
        return

    payload = await _get_json(
        client,
        "/api/v1/payments/observability",
        headers={"X-API-Key": api_key},
    )
    checkout_totals = payload.get("checkout", {}).get("totals", {})
    webhook_totals = payload.get("webhooks", {}).get("totals", {})

    checkout_failures = int(checkout_totals.get("failed", 0))
    webhook_failures_map = webhook_totals.get("failed", {}) or {}
    webhook_failures = sum(int(value) for value in webhook_failures_map.values())

    if checkout_failures > max_checkout_failures:
        _fail(
            f"Checkout failures {checkout_failures} exceed threshold {max_checkout_failures}"
        )
    if webhook_failures > max_webhook_failures:
        _fail(
            f"Webhook failures {webhook_failures} exceed threshold {max_webhook_failures}"
        )

    _log_ok(
        f"Payments observability OK (checkout failures={checkout_failures}, "
        f"webhook failures={webhook_failures})"
    )


async def validate_catalog(
    client: httpx.AsyncClient,
    api_key: Optional[str],
    skip_catalog: bool,
    max_zero_results_rate: float,
    min_sample_size: int,
) -> None:
    if skip_catalog:
        _log_ok("Skipping catalog search observability per flag")
        return

    if not api_key:
        _log_ok("Skipping catalog search observability (no API key provided)")
        return

    payload = await _get_json(
        client,
        "/api/v1/observability/catalog-search",
        headers={"X-API-Key": api_key},
    )

    totals = payload.get("totals", {})
    metrics = payload.get("metrics", {}) or {}
    queries = payload.get("queries", {}) or {}

    total_searches = int(totals.get("searches", 0))
    zero_results = int(totals.get("zero_results", 0))
    zero_results_rate = float(metrics.get("zero_results_rate", 0.0))

    if total_searches >= min_sample_size:
        if zero_results_rate > max_zero_results_rate:
            _fail(
                (
                    "Catalog zero-result rate {:.1%} exceeds threshold {:.1%} "
                    "(zero_results={}, searches={})"
                ).format(zero_results_rate, max_zero_results_rate, zero_results, total_searches)
            )
    else:
        _log_ok(
            f"Catalog search sample size below threshold ({total_searches}/{min_sample_size}); "
            "skipping zero-result SLO check"
        )
        return

    top_query = "n/a"
    if queries:
        top_query = max(queries.items(), key=lambda item: item[1])[0]

    _log_ok(
        "Catalog observability OK "
        f"(searches={total_searches}, zero_results={zero_results}, "
        f"zero_results_rate={zero_results_rate:.1%}, top_query={top_query})"
    )


async def main() -> None:
    args = parse_args()

    async with httpx.AsyncClient(base_url=args.base_url, timeout=args.timeout) as client:
        await validate_fulfillment(
            client,
            max_dead_lettered=args.max_fulfillment_dead_lettered,
            max_failed=args.max_fulfillment_failed,
        )
        await validate_payments(
            client,
            api_key=args.api_key,
            max_checkout_failures=args.max_payment_checkout_failures,
            max_webhook_failures=args.max_payment_webhook_failures,
        )
        await validate_catalog(
            client,
            api_key=args.api_key,
            skip_catalog=args.skip_catalog,
            max_zero_results_rate=args.max_catalog_zero_results_rate,
            min_sample_size=args.catalog_min_sample_size,
        )

    _log_ok("Observability checks completed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except httpx.HTTPStatusError as exc:
        _fail(f"HTTP {exc.response.status_code} while calling {exc.request.url}")
    except Exception as exc:  # pragma: no cover - best-effort logging
        _fail(f"Unexpected error: {exc}")

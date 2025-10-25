#!/usr/bin/env python3
"""Lightweight smoke test for the fulfillment worker endpoints.

Usage (HTTP):
    python tooling/scripts/smoke_fulfillment.py --base-url http://localhost:8000

Usage (in-process, no network sockets required):
    python tooling/scripts/smoke_fulfillment.py --in-process

The script checks:
1. API health (`/healthz`)
2. Fulfillment metrics endpoint (`/api/v1/fulfillment/metrics`)
3. Fulfillment health endpoint (`/api/v1/fulfillment/health`)
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import httpx
from httpx import ASGITransport, Response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SMPLAT fulfillment smoke test")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the FastAPI service (ignored with --in-process)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="Request timeout in seconds",
    )
    parser.add_argument(
        "--in-process",
        action="store_true",
        help="Run requests directly against the ASGI app without binding network sockets.",
    )
    return parser.parse_args()


async def _get_json(client: httpx.AsyncClient, path: str) -> dict:
    response: Response = await client.get(path)
    response.raise_for_status()
    return response.json()


async def _check_endpoints(client: httpx.AsyncClient) -> None:
    body = await _get_json(client, "/healthz")
    if body.get("status") != "ok":
        raise RuntimeError(f"Unexpected health status: {body}")

    metrics_payload = await _get_json(client, "/api/v1/fulfillment/metrics")
    if not {"tasks_processed", "tasks_failed"}.issubset(metrics_payload.keys()):
        raise RuntimeError(f"Metrics data incomplete: {metrics_payload}")

    health_payload = await _get_json(client, "/api/v1/fulfillment/health")
    expected_keys = {"running", "poll_interval_seconds", "batch_size", "metrics"}
    if not expected_keys.issubset(health_payload.keys()):
        raise RuntimeError(f"Health payload missing keys: {health_payload}")
    metrics_section = health_payload.get("metrics")
    if not isinstance(metrics_section, dict) or not {"tasks_processed", "tasks_failed"}.issubset(metrics_section.keys()):
        raise RuntimeError(f"Health metrics data incomplete: {health_payload}")

    observability_payload = await _get_json(client, "/api/v1/fulfillment/observability")
    expected_observability_keys = {"totals", "per_task_type", "events"}
    if not expected_observability_keys.issubset(observability_payload.keys()):
        raise RuntimeError(f"Fulfillment observability payload missing keys: {observability_payload}")
    for key in ("processed", "failed", "retried", "dead_lettered"):
        if key not in observability_payload["totals"]:
            raise RuntimeError(f"Fulfillment observability totals missing '{key}': {observability_payload}")


async def run_http(base_url: str, timeout: float) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=timeout) as client:
        await _check_endpoints(client)


async def run_in_process(timeout: float) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.app import create_app  # type: ignore import-position

    app = create_app()
    lifespan = app.router.lifespan_context(app)
    await lifespan.__aenter__()
    try:
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=timeout) as client:
            await _check_endpoints(client)
    finally:
        await lifespan.__aexit__(None, None, None)


def main() -> int:
    args = parse_args()
    if args.in_process:
        asyncio.run(run_in_process(args.timeout))
    else:
        asyncio.run(run_http(args.base_url, args.timeout))
    print("Fulfillment smoke test passed ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())

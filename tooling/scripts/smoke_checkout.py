#!/usr/bin/env python3
"""Smoke test for checkout → order API flow.

Usage (HTTP):
    python tooling/scripts/smoke_checkout.py --base-url http://localhost:8000 --api-key <CHECKOUT_API_KEY>

Usage (in-process, no network sockets required):
    python tooling/scripts/smoke_checkout.py --in-process --api-key test-key

The script checks:
1. API health (`/healthz`)
2. Product catalogue listing (`/api/v1/products`)
3. Product detail fetch (`/api/v1/products/{slug}`)
4. Order creation (`POST /api/v1/orders`) using the internal checkout API key
5. Payments observability snapshot (`/api/v1/payments/observability`)
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx
from httpx import ASGITransport, Response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SMPLAT checkout smoke test")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the FastAPI service (ignored with --in-process)",
    )
    parser.add_argument(
        "--api-key",
        help="Value for X-API-Key when calling protected checkout endpoints (optional in --in-process mode).",
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


async def _get_json(client: httpx.AsyncClient, path: str) -> dict[str, Any]:
    response: Response = await client.get(path)
    response.raise_for_status()
    return response.json()


async def _get_json_auth(
    client: httpx.AsyncClient,
    path: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    response: Response = await client.get(path, headers=headers)
    response.raise_for_status()
    return response.json()


async def _post_json(
    client: httpx.AsyncClient,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any] | None:
    response: Response = await client.post(path, json=payload, headers=headers)
    response.raise_for_status()
    if response.status_code == 204:
        return None
    return response.json()


async def _run_checks(client: httpx.AsyncClient, api_key: str) -> dict[str, Any]:
    health = await _get_json(client, "/healthz")
    if health.get("status") != "ok":
        raise RuntimeError(f"Unexpected health response: {health}")

    products = await _get_json(client, "/api/v1/products/")
    if not products:
        raise RuntimeError("No products returned from catalogue")

    product = next((prod for prod in products if (prod.get("status") or "").lower() == "active"), None)
    if product is None:
        raise RuntimeError("No active products available for smoke test")

    slug = product["slug"]
    detail = await _get_json(client, f"/api/v1/products/{slug}")
    if detail.get("slug") != slug:
        raise RuntimeError(f"Product detail slug mismatch: expected {slug}, got {detail.get('slug')}")

    price = float(
        detail.get("basePrice")
        or product.get("basePrice")
        or detail.get("base_price")
        or product.get("base_price")
        or 0
    )
    if price <= 0:
        raise RuntimeError("Product base price missing or zero; cannot create order")

    payload = {
        "items": [
            {
                "product_id": detail["id"],
                "product_title": detail["title"],
                "quantity": 1,
                "unit_price": price,
                "total_price": price,
                "selected_options": None,
                "attributes": {"smoke_test_id": str(uuid.uuid4())},
            }
        ],
        "currency": detail.get("currency") or product.get("currency") or "EUR",
        "source": "checkout",
        "notes": "Automated smoke test order",
    }

    order = await _post_json(client, "/api/v1/orders/", payload, headers={"X-API-Key": api_key})
    if not order:
        raise RuntimeError("Order creation returned empty response")

    observability = await _get_json_auth(
        client,
        "/api/v1/payments/observability",
        headers={"X-API-Key": api_key},
    )
    checkout_totals = observability.get("checkout", {}).get("totals", {})
    if "succeeded" not in checkout_totals:
        raise RuntimeError(f"Payments observability response missing checkout totals: {observability}")

    return order


async def _ensure_product_fixture() -> None:
    from smplat_api.db.base import Base  # type: ignore import-position
    from smplat_api.db.session import async_session, engine  # type: ignore import-position
    from smplat_api.models.customer_profile import CurrencyEnum  # type: ignore import-position
    from smplat_api.schemas.product import ProductCreate, ProductStatus  # type: ignore import-position
    from smplat_api.services.products import ProductService  # type: ignore import-position

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        service = ProductService(session)
        existing = await service.get_product_by_slug("instagram-growth")
        if existing:
            return
        await service.create_product(
            ProductCreate(
                slug="instagram-growth",
                title="Instagram Growth Campaign",
                description="Seeded via smoke test",
                category="instagram",
                basePrice=299.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatus.ACTIVE,
            )
        )


async def run_http(base_url: str, timeout: float, api_key: str) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=base_url, timeout=timeout) as client:
        return await _run_checks(client, api_key)


async def run_in_process(timeout: float, api_key: str) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.app import create_app  # type: ignore import-position

    app = create_app()
    lifespan = app.router.lifespan_context(app)
    await lifespan.__aenter__()
    try:
        await _ensure_product_fixture()
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=timeout) as client:
            return await _run_checks(client, api_key)
    finally:
        await lifespan.__aexit__(None, None, None)


def resolve_api_key(args_api_key: str | None, in_process: bool) -> str:
    if args_api_key:
        return args_api_key
    env_key = os.environ.get("CHECKOUT_API_KEY")
    if env_key:
        return env_key
    if in_process:
        return "smplat-smoke-key"
    raise SystemExit("Missing --api-key or CHECKOUT_API_KEY environment variable for HTTP smoke test.")


def main() -> int:
    args = parse_args()
    api_key = resolve_api_key(args.api_key, args.in_process)

    if args.in_process:
        order = asyncio.run(run_in_process(args.timeout, api_key))
    else:
        order = asyncio.run(run_http(args.base_url, args.timeout, api_key))

    items = order.get("items") or []
    product_title = items[0]["product_title"] if items else "unknown product"
    print(f"Checkout smoke test passed ✅ Order {order.get('order_number')} created for {product_title}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

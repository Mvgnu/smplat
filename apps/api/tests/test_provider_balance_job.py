from __future__ import annotations

import json
from decimal import Decimal
from datetime import datetime

import httpx
import pytest
from sqlalchemy import select

from smplat_api.jobs.fulfillment.provider_balance import run_provider_balance_snapshot
from smplat_api.models.fulfillment import FulfillmentProvider, FulfillmentProviderBalance, FulfillmentProviderStatusEnum, FulfillmentProviderHealthStatusEnum


@pytest.mark.asyncio
async def test_run_provider_balance_snapshot_updates_balance(session_factory):
    async with session_factory() as session:
        provider = FulfillmentProvider(
            id="prov-balance",
            name="Balance Provider",
            base_url="https://provider.test",
            status=FulfillmentProviderStatusEnum.ACTIVE,
            health_status=FulfillmentProviderHealthStatusEnum.HEALTHY,
            metadata_json={
                "automation": {
                    "endpoints": {
                        "balance": {
                            "method": "GET",
                            "url": "https://provider.test/balance",
                            "response": {
                                "balancePath": "data.balance",
                                "currencyPath": "data.currency",
                            },
                        }
                    }
                }
            },
        )
        session.add(provider)
        await session.commit()

    async def handler(request: httpx.Request) -> httpx.Response:
        response_body = {"data": {"balance": 1234.5, "currency": "usd"}}
        return httpx.Response(200, json=response_body)

    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)

    summary = await run_provider_balance_snapshot(
        session_factory=session_factory,
        http_client=http_client,
    )
    await http_client.aclose()

    assert summary["snapshots"] == 1

    async with session_factory() as session:
        balances = (
            await session.execute(select(FulfillmentProviderBalance).where(FulfillmentProviderBalance.provider_id == "prov-balance"))
        ).scalars().all()
        assert len(balances) == 1
        snapshot = balances[0]
        assert snapshot.balance_amount == Decimal("1234.5")
        assert snapshot.currency == "USD"
        assert snapshot.payload["data"]["balance"] == 1234.5
        assert snapshot.retrieved_at <= datetime.utcnow()

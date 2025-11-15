from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_preferences_creates_defaults(app_with_db):
    app, _session_factory = app_with_db
    user_id = uuid4()

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(f"/api/v1/notifications/preferences/{user_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["order_updates"] is True
    assert body["payment_updates"] is True
    assert body["fulfillment_alerts"] is True
    assert body["marketing_messages"] is False
    assert body["billing_alerts"] is False
    assert body["last_selected_order_id"] is None


@pytest.mark.asyncio
async def test_update_preferences(app_with_db):
    app, _session_factory = app_with_db
    user_id = uuid4()

    async with AsyncClient(app=app, base_url="http://test") as client:
        await client.get(f"/api/v1/notifications/preferences/{user_id}")
        response = await client.patch(
            f"/api/v1/notifications/preferences/{user_id}",
            json={
                "order_updates": False,
                "marketing_messages": True,
                "last_selected_order_id": str(uuid4())
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["order_updates"] is False
    assert body["marketing_messages"] is True
    assert body["last_selected_order_id"] is not None

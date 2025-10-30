import pytest
from httpx import AsyncClient

from smplat_api.app import create_app


@pytest.mark.asyncio
async def test_readyz_reports_component_statuses() -> None:
    app = create_app()

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/health/readyz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"ready", "degraded", "error"}
    components = payload["components"]
    assert "fulfillment_worker" in components
    assert "catalog_scheduler" in components
    assert "weekly_digest" in components
    assert "hosted_session_recovery" in components

import pytest
import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture
async def client(app_with_db) -> AsyncClient:
    app, _session_factory = app_with_db
    async with AsyncClient(app=app, base_url="http://test") as test_client:
        yield test_client


@pytest.mark.asyncio
async def test_catalog_bundle_crud(client: AsyncClient) -> None:
    payload = {
        "primaryProductSlug": "ugc-lab",
        "bundleSlug": "ugc-lab-launch",
        "title": "UGC Launch Bundle",
        "description": "Pair the lab with onboarding support",
        "savingsCopy": "Save 15%",
        "cmsPriority": 120,
        "components": [
            {"slug": "ugc-lab"},
            {"slug": "analytics-suite"}
        ],
        "metadata": {"source": "test"}
    }

    create_response = await client.post("/api/v1/catalog/bundles/", json=payload)
    assert create_response.status_code == 201
    bundle = create_response.json()
    assert bundle["bundleSlug"] == "ugc-lab-launch"

    list_response = await client.get("/api/v1/catalog/bundles/")
    assert list_response.status_code == 200
    bundles = list_response.json()
    assert any(item["bundleSlug"] == "ugc-lab-launch" for item in bundles)

    bundle_id = bundle["id"]
    update_response = await client.patch(
        f"/api/v1/catalog/bundles/{bundle_id}",
        json={"title": "UGC Launch Bundle+"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "UGC Launch Bundle+"

    delete_response = await client.delete(f"/api/v1/catalog/bundles/{bundle_id}")
    assert delete_response.status_code == 204

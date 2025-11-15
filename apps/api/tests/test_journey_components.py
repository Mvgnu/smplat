from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from smplat_api.models.journey_runtime import JourneyComponentRun
from smplat_api.tasks.journey_runtime import process_journey_run


@pytest.mark.asyncio
async def test_journey_component_crud_flow(app_with_db):
    app, _ = app_with_db
    async with AsyncClient(app=app, base_url="http://test") as client:
        create_payload = {
            "key": "ig-handle-lookup",
            "name": "Instagram Handle Lookup",
            "description": "Fetches Instagram metadata for presets.",
            "triggers": [
                {
                    "stage": "preset",
                    "event": "cta_launch",
                    "metadata": {"source": "preset-drawer"},
                }
            ],
            "scriptSlug": "journeys.instagram.lookup",
            "scriptRuntime": "celery",
            "inputSchema": {
                "version": 1,
                "fields": [
                    {
                        "key": "handle",
                        "label": "Instagram Handle",
                        "type": "string",
                        "required": True,
                    }
                ],
            },
            "providerDependencies": [
                {"providerId": "instagram", "serviceId": "lookup", "scopes": ["public"]},
            ],
            "timeoutSeconds": 120,
            "retryPolicy": {"maxAttempts": 3, "strategy": "exponential"},
            "tags": ["instagram", "lookup"],
            "metadata": {"owner": "merchandising"},
        }
        create_response = await client.post("/api/v1/journey-components", json=create_payload)
        assert create_response.status_code == 201
        component = create_response.json()
        component_id = component["id"]
        assert component["scriptSlug"] == "journeys.instagram.lookup"
        assert component["inputSchema"]["fields"][0]["key"] == "handle"

        list_response = await client.get("/api/v1/journey-components")
        assert list_response.status_code == 200
        assert any(item["id"] == component_id for item in list_response.json())

        update_response = await client.patch(
            f"/api/v1/journey-components/{component_id}",
            json={"name": "Updated Lookup", "tags": ["instagram", "updated"]},
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["name"] == "Updated Lookup"
        assert updated["tags"] == ["instagram", "updated"]

        delete_response = await client.delete(f"/api/v1/journey-components/{component_id}")
        assert delete_response.status_code == 204

        final_list = await client.get("/api/v1/journey-components")
        assert final_list.status_code == 200
        assert all(item["id"] != component_id for item in final_list.json())


@pytest.mark.asyncio
async def test_product_configuration_includes_journey_components(app_with_db):
    app, _ = app_with_db
    async with AsyncClient(app=app, base_url="http://test") as client:
        component_payload = {
            "key": "cta-launch",
            "name": "CTA Launch Component",
            "triggers": [{"stage": "checkout", "event": "checkout_step"}],
            "scriptSlug": "journeys.checkout.cta",
            "inputSchema": {"version": 1, "fields": []},
        }
        create_component = await client.post("/api/v1/journey-components", json=component_payload)
        assert create_component.status_code == 201
        component_id = create_component.json()["id"]

        product_payload = {
            "slug": "journey-demo-product",
            "title": "Journey Demo Product",
            "description": "Test product with journey component.",
            "category": "automation",
            "basePrice": 199.0,
            "currency": "EUR",
            "status": "draft",
            "channelEligibility": ["web"],
            "configuration": {
                "journeyComponents": [
                    {
                        "componentId": component_id,
                        "displayOrder": 0,
                        "isRequired": True,
                        "bindings": [
                            {"kind": "static", "inputKey": "handle", "value": "demo_handle"},
                        ],
                        "metadata": {"drawer": "primary"},
                    }
                ]
            },
        }
        create_product = await client.post("/api/v1/products/", json=product_payload)
        assert create_product.status_code == 201
        product_id = create_product.json()["id"]

        product_detail = await client.get(f"/api/v1/products/{product_payload['slug']}")
        assert product_detail.status_code == 200
        detail = product_detail.json()
        assert detail["journeyComponents"]
        journey_entry = detail["journeyComponents"][0]
        assert journey_entry["componentId"] == component_id
        assert journey_entry["bindings"][0]["inputKey"] == "handle"
        assert journey_entry["component"]["scriptSlug"] == "journeys.checkout.cta"

        # Ensure the configuration can be updated by replacing journey components
        update_payload = {
            "configuration": {
                "journeyComponents": [
                    {
                        "componentId": component_id,
                        "displayOrder": 1,
                        "isRequired": False,
                        "bindings": [
                            {"kind": "runtime", "inputKey": "orderId", "source": "input.order.id"},
                        ],
                    }
                ]
            }
        }
        patch_response = await client.patch(f"/api/v1/products/{product_id}", json=update_payload)
        assert patch_response.status_code == 200

        updated_detail = await client.get(f"/api/v1/products/{product_payload['slug']}")
        assert updated_detail.status_code == 200
        updated_entry = updated_detail.json()["journeyComponents"][0]
        assert updated_entry["displayOrder"] == 1
        assert updated_entry["isRequired"] is False
        assert updated_entry["bindings"][0]["kind"] == "runtime"


@pytest.mark.asyncio
async def test_journey_runtime_run_and_overview(app_with_db):
    app, session_factory = app_with_db
    async with AsyncClient(app=app, base_url="http://test") as client:
        component_payload = {
            "key": "runtime-test",
            "name": "Runtime Test Component",
            "triggers": [{"stage": "checkout", "event": "checkout_step"}],
            "scriptSlug": "journeys.checkout.runtime",
            "scriptRuntime": "celery",
            "inputSchema": {
                "version": 1,
                "fields": [
                    {"key": "orderId", "label": "Order ID", "type": "string"},
                ],
            },
            "retryPolicy": {"maxAttempts": 2},
        }
        component_response = await client.post("/api/v1/journey-components", json=component_payload)
        assert component_response.status_code == 201
        component_id = component_response.json()["id"]

        product_payload = {
            "slug": "runtime-product",
            "title": "Runtime Product",
            "description": "Includes runtime component",
            "category": "journeys",
            "basePrice": 25.0,
            "currency": "EUR",
            "status": "draft",
            "channelEligibility": ["storefront"],
            "configuration": {
                "journeyComponents": [
                    {
                        "componentId": component_id,
                        "displayOrder": 0,
                        "isRequired": True,
                        "bindings": [
                            {"kind": "product_field", "inputKey": "productSlug", "path": "product.slug", "required": True},
                            {"kind": "runtime", "inputKey": "orderId", "source": "input.order.id", "required": True},
                        ],
                    }
                ]
            },
        }
        product_response = await client.post("/api/v1/products/", json=product_payload)
        assert product_response.status_code == 201
        product_id = product_response.json()["id"]

        run_payload = {
            "componentId": component_id,
            "productId": product_id,
            "channel": "storefront",
            "inputPayload": {"order": {"id": "order_123"}},
        }
        run_response = await client.post("/api/v1/journey-components/run", json=run_payload)
        assert run_response.status_code == 201
        run_data = run_response.json()
        assert run_data["productId"] == product_id
        assert run_data["componentId"] == component_id
        assert run_data["status"] in {"queued", "pending"}

        execution_result = await process_journey_run(UUID(run_data["id"]), session_factory=session_factory)
        assert execution_result["status"] in {"succeeded", "failed"}

        overview_response = await client.get(f"/api/v1/products/{product_id}/journeys")
        assert overview_response.status_code == 200
        overview = overview_response.json()
        assert overview["productId"] == product_id
        assert len(overview["journeyComponents"]) == 1
        assert overview["journeyComponents"][0]["componentId"] == component_id
        assert len(overview["recentRuns"]) >= 1
        latest_run = overview["recentRuns"][0]
        assert latest_run["status"] == "succeeded"
        assert latest_run["resultPayload"]["bindings"]["orderId"] == "order_123"
        assert latest_run["resultPayload"]["bindings"]["productSlug"] == product_payload["slug"]
        telemetry = latest_run.get("telemetry") or {}
        assert telemetry.get("runner") == "echo"
        assert telemetry.get("bindingsCount", 0) >= 1
        assert telemetry.get("outputPreview")
        component_health = overview["componentHealth"]
        assert component_health
        health_entry = component_health[0]
        assert health_entry["componentId"] == component_id
        assert health_entry["runCount"] >= 1
        assert health_entry["successCount"] >= 1
        assert health_entry["failureCount"] == 0
        assert health_entry["lastRun"]
        assert health_entry["lastRun"]["id"] == latest_run["id"]


@pytest.mark.asyncio
async def test_journey_runtime_retry_policy_requeues_pending_run(app_with_db):
    app, session_factory = app_with_db
    async with AsyncClient(app=app, base_url="http://test") as client:
        component_payload = {
            "key": "retry-test",
            "name": "Retry Test Component",
            "triggers": [{"stage": "checkout", "event": "checkout_step"}],
            "scriptSlug": "journeys.checkout.retry",
            "inputSchema": {"version": 1, "fields": []},
            "retryPolicy": {"maxAttempts": 2},
        }
        component_response = await client.post("/api/v1/journey-components", json=component_payload)
        assert component_response.status_code == 201
        component_id = component_response.json()["id"]

        product_payload = {
            "slug": "retry-product",
            "title": "Retry Product",
            "description": "Test product for retry policy",
            "category": "journeys",
            "basePrice": 25.0,
            "currency": "EUR",
            "status": "draft",
            "channelEligibility": ["storefront"],
            "configuration": {
                "journeyComponents": [
                    {
                        "componentId": component_id,
                        "displayOrder": 0,
                        "isRequired": True,
                        "bindings": [],
                    }
                ]
            },
        }
        product_response = await client.post("/api/v1/products/", json=product_payload)
        assert product_response.status_code == 201
        product_id = product_response.json()["id"]

        run_payload = {
            "componentId": component_id,
            "productId": product_id,
            "channel": "storefront",
            "bindings": [
                {"kind": "runtime", "inputKey": "orderId", "source": "input.order.id", "required": True},
            ],
        }
        run_response = await client.post("/api/v1/journey-components/run", json=run_payload)
        assert run_response.status_code == 201
        run_id = UUID(run_response.json()["id"])

        first_result = await process_journey_run(run_id, session_factory=session_factory)
        assert first_result["status"] in {"failed", "queued"}
        async with session_factory() as session:
            run_record = await session.get(JourneyComponentRun, run_id)
            assert run_record is not None
            assert run_record.status.value == "queued"
            assert run_record.attempts == 1
            assert run_record.telemetry_json is not None
            assert run_record.telemetry_json.get("missingBindings") == ["orderId"]

        second_result = await process_journey_run(run_id, session_factory=session_factory)
        assert second_result["status"] == "failed"
        async with session_factory() as session:
            run_record = await session.get(JourneyComponentRun, run_id)
            assert run_record is not None
            assert run_record.status.value == "failed"
            assert run_record.attempts == 2
            assert run_record.telemetry_json.get("runner") == "echo"

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_record_and_list_access_events(app_with_db):
    app, _session_factory = app_with_db
    user_id = uuid4()

    async with AsyncClient(app=app, base_url="http://test") as client:
        create_response = await client.post(
            "/api/v1/security/access-events",
            json={
                "route": "/admin/security",
                "method": "GET",
                "required_tier": "admin",
                "decision": "allowed",
                "subject_email": "admin@example.com",
                "user_id": str(user_id),
                "metadata": {"source": "test"},
            },
        )
        assert create_response.status_code == 201

        denied_response = await client.post(
            "/api/v1/security/access-events",
            json={
                "route": "/admin/orders",
                "method": "POST",
                "required_tier": "admin",
                "decision": "denied",
                "reason": "insufficient_role",
                "subject_email": "blocked@example.com",
            },
        )
        assert denied_response.status_code == 201

        list_response = await client.get("/api/v1/security/access-events", params={"limit": 10})
        assert list_response.status_code == 200
        events = list_response.json()
        assert len(events) == 2
        assert events[0]["decision"] in {"allowed", "denied"}

        metrics_response = await client.get("/api/v1/security/access-events/metrics", params={"window_hours": 24})
        assert metrics_response.status_code == 200
        metrics = metrics_response.json()
        assert metrics["total"] == 2
        assert metrics["allowed"] == 1
        assert metrics["denied"] == 1

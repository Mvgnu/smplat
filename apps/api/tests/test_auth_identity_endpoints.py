from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from smplat_api.models.auth_identity import AuthSession, AuthVerificationToken
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum


@pytest.mark.asyncio
async def test_user_crud_flow(app_with_db):
    app, session_factory = app_with_db

    async with AsyncClient(app=app, base_url="http://test") as client:
        create_response = await client.post(
            "/api/v1/auth/users",
            json={
                "email": "qa-user@example.com",
                "display_name": "QA User",
                "role": "admin",
                "status": "active",
                "email_verified_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert create_response.status_code == 201
        created = create_response.json()
        user_id = created["id"]
        assert created["email"] == "qa-user@example.com"
        assert created["is_email_verified"] is True

        update_response = await client.patch(
            f"/api/v1/auth/users/{user_id}",
            json={
                "display_name": "QA User Updated",
                "is_email_verified": False,
                "role": "client",
            },
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["display_name"] == "QA User Updated"
        assert updated["is_email_verified"] is False
        assert updated["role"] == "client"

        by_id = await client.get(f"/api/v1/auth/users/{user_id}")
        assert by_id.status_code == 200
        assert by_id.json()["display_name"] == "QA User Updated"

        by_email = await client.get(
            "/api/v1/auth/users/by-email",
            params={"email": "qa-user@example.com"},
        )
        assert by_email.status_code == 200
        assert by_email.json()["id"] == user_id

        delete_response = await client.delete(f"/api/v1/auth/users/{user_id}")
        assert delete_response.status_code == 204

    async with session_factory() as session:
        stored = await session.get(User, UUID(user_id))
        assert stored is None


@pytest.mark.asyncio
async def test_session_and_verification_token_flow(app_with_db):
    app, session_factory = app_with_db

    async with session_factory() as session:
        user = User(
            email="session-user@example.com",
            display_name="Session User",
            role=UserRoleEnum.CLIENT,
            status=UserStatusEnum.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = user.id

    async with AsyncClient(app=app, base_url="http://test") as client:
        token_expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        session_token = "token-123"

        create_session = await client.post(
            "/api/v1/auth/sessions",
            json={
                "session_token": session_token,
                "user_id": str(user_id),
                "expires": token_expires,
                "permissions": ["member:read"],
            },
        )
        assert create_session.status_code == 201

        fetched = await client.get(f"/api/v1/auth/sessions/{session_token}")
        assert fetched.status_code == 200
        payload = fetched.json()
        assert payload["session"]["session_token"] == session_token
        assert payload["user"]["id"] == str(user_id)

        update_session = await client.patch(
            f"/api/v1/auth/sessions/{session_token}",
            json={"permissions": ["member:read", "operator:manage"]},
        )
        assert update_session.status_code == 200
        assert update_session.json()["permissions"] == ["member:read", "operator:manage"]

        delete_session = await client.delete(f"/api/v1/auth/sessions/{session_token}")
        assert delete_session.status_code == 204

        create_token = await client.post(
            "/api/v1/auth/verification-tokens",
            json={
                "identifier": "session-user@example.com",
                "token": "verify-123",
                "expires": token_expires,
            },
        )
        assert create_token.status_code == 201

        consume_token = await client.post(
            "/api/v1/auth/verification-tokens/use",
            json={"identifier": "session-user@example.com", "token": "verify-123"},
        )
        assert consume_token.status_code == 200

        reuse_token = await client.post(
            "/api/v1/auth/verification-tokens/use",
            json={"identifier": "session-user@example.com", "token": "verify-123"},
        )
        assert reuse_token.status_code == 404

    async with session_factory() as session:
        remaining_session = await session.execute(
            select(AuthSession).where(AuthSession.session_token == "token-123")
        )
        assert remaining_session.scalar_one_or_none() is None

        tokens = await session.execute(
            select(AuthVerificationToken).where(
                AuthVerificationToken.identifier == "session-user@example.com"
            )
        )
        assert tokens.scalar_one_or_none() is None

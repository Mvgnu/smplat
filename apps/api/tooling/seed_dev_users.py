"""Seed development shortcut users into the API database."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from typing import TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from smplat_api.core.settings import settings
from smplat_api.models.user import User


class SeedUser(TypedDict):
    email: str
    display_name: str
    role: str
    status: str


DEV_USERS: list[SeedUser] = [
    {
        "email": os.getenv("DEV_SHORTCUT_CUSTOMER_EMAIL", "customer@smplat.dev").lower(),
        "display_name": "Customer QA",
        "role": "client",
        "status": "active",
    },
    {
        "email": os.getenv("DEV_SHORTCUT_ADMIN_EMAIL", "admin@smplat.dev").lower(),
        "display_name": "Admin QA",
        "role": "admin",
        "status": "active",
    },
    {
        "email": os.getenv("DEV_SHORTCUT_TESTING_EMAIL", "testing@smplat.dev").lower(),
        "display_name": "Testing QA",
        "role": "client",
        "status": "active",
    },
    {
        "email": os.getenv("DEV_SHORTCUT_ANALYSIS_EMAIL", "analysis@smplat.dev").lower(),
        "display_name": "Analysis QA",
        "role": "finance",
        "status": "active",
    },
]


async def seed_users(session: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    for user in DEV_USERS:
        normalized_role = user["role"].lower()
        normalized_status = user["status"].lower()
        with session.no_autoflush:
            existing = await session.execute(select(User).where(User.email == user["email"]))
        record = existing.scalar_one_or_none()

        if record:
            record.display_name = user["display_name"]
            record.role = normalized_role
            record.status = normalized_status
            record.email_verified_at = now
            record.is_email_verified = True
        else:
            session.add(
                User(
                    email=user["email"],
                    display_name=user["display_name"],
                    role=normalized_role,
                    status=normalized_status,
                    email_verified_at=now,
                    is_email_verified=True,
                )
            )
    await session.commit()


async def main() -> None:
    engine = create_async_engine(settings.database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    try:
        async with session_factory() as session:
            await seed_users(session)
        print("Development shortcut users ready ✅")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

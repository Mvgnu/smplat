import sys
from pathlib import Path

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from smplat_api.app import create_app
from smplat_api.db.base import Base
from smplat_api.db.session import get_session


def _configure_path() -> None:
    src_path = Path(__file__).resolve().parents[1] / "src"
    if src_path.exists():
        sys.path.insert(0, str(src_path))


_configure_path()


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def app_with_db(session_factory):
    app = create_app()

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    try:
        yield app, session_factory
    finally:
        app.dependency_overrides.clear()

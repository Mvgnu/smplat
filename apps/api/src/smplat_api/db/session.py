from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from smplat_api.core.settings import settings

engine = create_async_engine(settings.database_url, echo=False, future=True)

async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session

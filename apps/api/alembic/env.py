from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

from smplat_api.core.settings import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def get_metadata():
    from smplat_api.db.base import Base  # noqa: WPS433 (late import)

    return Base.metadata


def run_migrations_offline():
    """Run migrations in 'offline' mode."""
    context.configure(url=settings.database_url, target_metadata=get_metadata(), literal_binds=True)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode."""
    # Convert async database URL to sync for migrations
    database_url = settings.database_url
    # Replace async drivers with sync equivalents
    if database_url.startswith("postgresql+asyncpg"):
        database_url = database_url.replace("postgresql+asyncpg", "postgresql")
    elif database_url.startswith("postgresql+aiosqlite"):
        database_url = database_url.replace("postgresql+aiosqlite", "sqlite")
    elif "+aiosqlite" in database_url:
        database_url = database_url.replace("+aiosqlite", "")
    
    connectable = create_engine(database_url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=get_metadata())

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

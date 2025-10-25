from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

from smplat_api.core.settings import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def get_metadata():
    from smplat_api.db.base import Base  # noqa: WPS433 (late import)

    return Base.metadata


def run_migrations_offline():
    """Run migrations in 'offline' mode."""
    # Ensure sync driver for offline context (psycopg2 for Postgres)
    url = settings.database_url.replace("+asyncpg", "+psycopg2")
    context.configure(url=url, target_metadata=get_metadata(), literal_binds=True)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section, {})
    # Force sync driver for online context as well
    if "sqlalchemy.url" in configuration:
        configuration["sqlalchemy.url"] = configuration["sqlalchemy.url"].replace("+asyncpg", "+psycopg2")

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=get_metadata())

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

"""Create fulfillment provider catalog tables.

Revision ID: 20251210_39_fulfillment_provider_catalog
Revises: 20251210_38_fulfillment_provider_orders
Create Date: 2025-01-10 11:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM


revision = "20251210_39_fulfillment_provider_catalog"
down_revision = "20251210_38_fulfillment_provider_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    provider_status_enum = ENUM(
        "active",
        "inactive",
        name="fulfillment_provider_status_enum",
        create_type=False,
    )
    provider_health_enum = ENUM(
        "unknown",
        "healthy",
        "degraded",
        "offline",
        name="fulfillment_provider_health_status_enum",
        create_type=False,
    )
    service_status_enum = ENUM(
        "active",
        "inactive",
        name="fulfillment_service_status_enum",
        create_type=False,
    )
    service_health_enum = ENUM(
        "unknown",
        "healthy",
        "degraded",
        "offline",
        name="fulfillment_service_health_status_enum",
        create_type=False,
    )

    bind = op.get_bind()
    enum_creations = [
        ("fulfillment_provider_status_enum", "'active','inactive'"),
        ("fulfillment_provider_health_status_enum", "'unknown','healthy','degraded','offline'"),
        ("fulfillment_service_status_enum", "'active','inactive'"),
        ("fulfillment_service_health_status_enum", "'unknown','healthy','degraded','offline'"),
    ]
    for name, values in enum_creations:
        op.execute(
            sa.text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = :enum_name) THEN
                        EXECUTE format('CREATE TYPE %I AS ENUM (%s)', :enum_name, :enum_values);
                    END IF;
                END;
                $$;
                """
            ).bindparams(enum_name=name, enum_values=values)
        )

    op.create_table(
        "fulfillment_providers",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("allowed_regions", sa.JSON(), nullable=True),
        sa.Column("credentials", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("rate_limit_per_minute", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            provider_status_enum,
            nullable=False,
            server_default="inactive",
        ),
        sa.Column(
            "health_status",
            provider_health_enum,
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("last_health_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("health_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_index(
        "ix_fulfillment_providers_status",
        "fulfillment_providers",
        ["status"],
    )
    op.create_index(
        "ix_fulfillment_providers_health_status",
        "fulfillment_providers",
        ["health_status"],
    )

    op.execute(
        """
        INSERT INTO fulfillment_providers (
            id,
            name,
            description,
            base_url,
            allowed_regions,
            credentials,
            metadata_json,
            rate_limit_per_minute,
            status,
            health_status
        )
        VALUES (
            'xyz',
            'XYZ Growth Network',
            'Legacy static provider entry migrated into the catalog.',
            'https://api.xyzgrowth.example',
            to_jsonb(ARRAY['eu']),
            NULL,
            jsonb_build_object(
                'supportEmail', 'ops@xyzgrowth.example',
                'docUrl', 'https://xyzgrowth.example/docs/api'
            ),
            NULL,
            'active',
            'unknown'
        )
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.create_table(
        "fulfillment_services",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=255), nullable=True),
        sa.Column("default_currency", sa.String(length=3), nullable=True),
        sa.Column("allowed_regions", sa.JSON(), nullable=True),
        sa.Column("rate_limit_per_minute", sa.Integer(), nullable=True),
        sa.Column("credentials", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            service_status_enum,
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "health_status",
            service_health_enum,
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("last_health_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("health_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["fulfillment_providers.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_fulfillment_services_provider_id",
        "fulfillment_services",
        ["provider_id"],
    )
    op.create_index(
        "ix_fulfillment_services_status",
        "fulfillment_services",
        ["status"],
    )

    op.execute(
        """
        INSERT INTO fulfillment_services (
            id,
            provider_id,
            name,
            action,
            category,
            default_currency,
            allowed_regions,
            rate_limit_per_minute,
            credentials,
            metadata_json,
            status,
            health_status
        )
        VALUES (
            '321',
            'xyz',
            'Follower Growth · EU',
            'followers_eu_standard',
            'followers',
            'EUR',
            to_jsonb(ARRAY['eu']),
            NULL,
            NULL,
            jsonb_build_object('maxQuantity', 10000, 'leadTimeDays', 5),
            'active',
            'unknown'
        )
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO fulfillment_services (
            id,
            provider_id,
            name,
            action,
            category,
            default_currency,
            allowed_regions,
            rate_limit_per_minute,
            credentials,
            metadata_json,
            status,
            health_status
        )
        VALUES (
            'svc_followers_eu',
            'xyz',
            'Follower Growth · EU',
            'followers_eu_standard',
            'followers',
            'EUR',
            to_jsonb(ARRAY['eu']),
            NULL,
            NULL,
            jsonb_build_object('maxQuantity', 10000, 'leadTimeDays', 5),
            'active',
            'unknown'
        )
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_fulfillment_services_status", table_name="fulfillment_services")
    op.drop_index("ix_fulfillment_services_provider_id", table_name="fulfillment_services")
    op.drop_table("fulfillment_services")

    op.drop_index("ix_fulfillment_providers_health_status", table_name="fulfillment_providers")
    op.drop_index("ix_fulfillment_providers_status", table_name="fulfillment_providers")
    op.drop_table("fulfillment_providers")

    service_health_enum = sa.Enum(
        "unknown",
        "healthy",
        "degraded",
        "offline",
        name="fulfillment_service_health_status_enum",
    )
    service_status_enum = sa.Enum(
        "active",
        "inactive",
        name="fulfillment_service_status_enum",
    )
    provider_health_enum = sa.Enum(
        "unknown",
        "healthy",
        "degraded",
        "offline",
        name="fulfillment_provider_health_status_enum",
    )
    provider_status_enum = sa.Enum(
        "active",
        "inactive",
        name="fulfillment_provider_status_enum",
    )

    bind = op.get_bind()
    service_health_enum.drop(bind, checkfirst=True)
    service_status_enum.drop(bind, checkfirst=True)
    provider_health_enum.drop(bind, checkfirst=True)
    provider_status_enum.drop(bind, checkfirst=True)

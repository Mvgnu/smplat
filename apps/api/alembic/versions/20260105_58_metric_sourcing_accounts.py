"""Create customer social accounts and item metric references."""

from collections.abc import Sequence
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision: str = "20260105_58_metric_sourcing_accounts"
down_revision: str | None = "20260104_57_guardrail_followup_conversion_metadata"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

SOCIAL_PLATFORM_ENUM = "social_platform_enum"
SOCIAL_ACCOUNT_STATUS_ENUM = "social_account_verification_status_enum"


def upgrade() -> None:
    conn = op.get_bind()
    base_platform_enum = sa.Enum("instagram", "tiktok", "youtube", name=SOCIAL_PLATFORM_ENUM)
    base_verification_enum = sa.Enum(
        "pending",
        "verified",
        "rejected",
        "expired",
        name=SOCIAL_ACCOUNT_STATUS_ENUM,
    )
    base_platform_enum.create(conn, checkfirst=True)
    base_verification_enum.create(conn, checkfirst=True)

    platform_enum = sa.Enum(
        "instagram",
        "tiktok",
        "youtube",
        name=SOCIAL_PLATFORM_ENUM,
        create_type=False,
    )
    verification_enum = sa.Enum(
        "pending",
        "verified",
        "rejected",
        "expired",
        name=SOCIAL_ACCOUNT_STATUS_ENUM,
        create_type=False,
    )

    op.create_table(
        "customer_social_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "customer_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customer_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("platform", platform_enum, nullable=False),
        sa.Column("handle", sa.String(length=255), nullable=False),
        sa.Column("account_id", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("profile_url", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("verification_status", verification_enum, nullable=False, server_default="pending"),
        sa.Column("verification_method", sa.String(length=255), nullable=True),
        sa.Column("verification_notes", sa.Text(), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_scraped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("baseline_metrics", sa.JSON(), nullable=True),
        sa.Column("delivery_snapshots", sa.JSON(), nullable=True),
        sa.Column("target_metrics", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("ownership_token", sa.String(length=255), nullable=True),
        sa.Column("ownership_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("platform", "handle", name="uq_social_account_platform_handle"),
    )
    op.create_index(
        "ix_customer_social_accounts_customer_profile_id",
        "customer_social_accounts",
        ["customer_profile_id"],
    )

    op.add_column(
        "order_items",
        sa.Column("customer_social_account_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("order_items", sa.Column("baseline_metrics", sa.JSON(), nullable=True))
    op.add_column("order_items", sa.Column("delivery_snapshots", sa.JSON(), nullable=True))
    op.add_column("order_items", sa.Column("target_metrics", sa.JSON(), nullable=True))
    op.create_foreign_key(
        "order_items_customer_social_account_id_fkey",
        "order_items",
        "customer_social_accounts",
        ["customer_social_account_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("order_items_customer_social_account_id_fkey", "order_items", type_="foreignkey")
    op.drop_column("order_items", "target_metrics")
    op.drop_column("order_items", "delivery_snapshots")
    op.drop_column("order_items", "baseline_metrics")
    op.drop_column("order_items", "customer_social_account_id")

    op.drop_index("ix_customer_social_accounts_customer_profile_id", table_name="customer_social_accounts")
    op.drop_table("customer_social_accounts")

    conn = op.get_bind()
    verification_enum = sa.Enum(
        "pending",
        "verified",
        "rejected",
        "expired",
        name=SOCIAL_ACCOUNT_STATUS_ENUM,
    )
    platform_enum = sa.Enum("instagram", "tiktok", "youtube", name=SOCIAL_PLATFORM_ENUM)
    verification_enum.drop(conn, checkfirst=True)
    platform_enum.drop(conn, checkfirst=True)

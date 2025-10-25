"""Add customer profiles and notifications.

Revision ID: 20251015_02
Revises: 20251015_01
Create Date: 2025-10-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251015_02"
down_revision: Union[str, None] = "20251015_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE preferred_currency_enum AS ENUM ('EUR', 'USD')")
    op.execute("CREATE TYPE notification_channel_enum AS ENUM ('email', 'sms', 'push')")
    op.execute("CREATE TYPE notification_status_enum AS ENUM ('pending', 'sent', 'failed')")

    op.create_table(
        "customer_profiles",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("company_name", sa.String(), nullable=True),
        sa.Column("vat_id", sa.String(), nullable=True),
        sa.Column("street_address", sa.String(), nullable=True),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("postal_code", sa.String(), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("instagram_handle", sa.String(), nullable=True),
        sa.Column(
            "preferred_currency",
            sa.Enum(name="preferred_currency_enum", create_type=False),
            nullable=False,
            server_default="EUR",
        ),
        sa.Column("marketing_consent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "channel",
            sa.Enum(name="notification_channel_enum", create_type=False),
            nullable=False,
            server_default="email",
        ),
        sa.Column(
            "status",
            sa.Enum(name="notification_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("provider_message_id", sa.String(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_status", "notifications", ["status"])


def downgrade() -> None:
    op.drop_index("ix_notifications_status", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_table("customer_profiles")

    op.execute("DROP TYPE notification_status_enum")
    op.execute("DROP TYPE notification_channel_enum")
    op.execute("DROP TYPE preferred_currency_enum")

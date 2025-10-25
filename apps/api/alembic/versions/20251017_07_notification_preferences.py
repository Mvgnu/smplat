"""Add notification preferences table.

Revision ID: 20251017_07
Revises: 20251015_06
Create Date: 2025-10-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251017_07"
down_revision: Union[str, None] = "20251015_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("order_updates", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("payment_updates", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("fulfillment_alerts", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("marketing_messages", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_selected_order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_notification_preferences_user_id_users",
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")

"""Add webhook events table for idempotency.

Revision ID: 20251015_06
Revises: 20251015_05
Create Date: 2025-10-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251015_06"
down_revision: Union[str, None] = "20251015_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE webhook_provider_enum AS ENUM ('stripe')")

    op.create_table(
        "webhook_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "provider",
            sa.Enum(name="webhook_provider_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("provider", "external_id", name="uq_webhook_events_provider_external"),
    )


def downgrade() -> None:
    op.drop_table("webhook_events")
    op.execute("DROP TYPE webhook_provider_enum")

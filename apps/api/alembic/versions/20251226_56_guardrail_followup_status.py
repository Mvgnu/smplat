"""Add provider guardrail status cache."""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251226_56_guardrail_followup_status"
down_revision: Union[str, None] = "20251226_55_provider_platform_context_cache"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "provider_guardrail_status",
        sa.Column("provider_id", sa.String(length=128), primary_key=True),
        sa.Column("provider_name", sa.String(length=255), nullable=True),
        sa.Column("last_action", sa.String(length=64), nullable=True),
        sa.Column("is_paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_source", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "last_follow_up_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("provider_guardrail_followup.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("provider_guardrail_status")

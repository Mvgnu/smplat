"""Create processor event ledger table."""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20251026_15"
down_revision: Union[str, None] = "20251025_14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processor_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "provider",
            sa.Enum(name="webhook_provider_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("payload_hash", sa.String(length=128), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("invoice_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("replay_requested", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("replay_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replay_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("replayed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_replay_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("provider", "external_id", name="uq_processor_event_provider_external"),
        sa.UniqueConstraint("provider", "payload_hash", name="uq_processor_event_provider_payload_hash"),
    )


def downgrade() -> None:
    op.drop_table("processor_events")

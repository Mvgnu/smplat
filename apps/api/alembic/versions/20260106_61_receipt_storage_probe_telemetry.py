"""Add telemetry table for receipt storage probes."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260106_61_receipt_storage_probe_telemetry"
down_revision: str | None = "20260105_60_order_timeline_replay_events"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "receipt_storage_probe_telemetry",
        sa.Column("component", sa.String(length=64), primary_key=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.String(length=512), nullable=True),
        sa.Column("last_sentinel_key", sa.String(length=512), nullable=True),
        sa.Column("last_detail", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("receipt_storage_probe_telemetry")

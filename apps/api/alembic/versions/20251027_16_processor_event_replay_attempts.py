from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20251027_16"
down_revision: Union[str, None] = "20251026_15"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processor_event_replay_attempts",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("metadata_snapshot", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["processor_events.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_processor_event_replay_attempts_event_id",
        "processor_event_replay_attempts",
        ["event_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_processor_event_replay_attempts_event_id",
        table_name="processor_event_replay_attempts",
    )
    op.drop_table("processor_event_replay_attempts")

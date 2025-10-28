from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20251029_18"
down_revision: Union[str, None] = "20251028_17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "hosted_session_recovery_runs",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("triggered_by", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("scheduled_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notified_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_hosted_session_recovery_runs_started_at",
        "hosted_session_recovery_runs",
        ["started_at"],
    )
    op.create_index(
        "ix_hosted_session_recovery_runs_status",
        "hosted_session_recovery_runs",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_hosted_session_recovery_runs_status",
        table_name="hosted_session_recovery_runs",
    )
    op.drop_index(
        "ix_hosted_session_recovery_runs_started_at",
        table_name="hosted_session_recovery_runs",
    )
    op.drop_table("hosted_session_recovery_runs")

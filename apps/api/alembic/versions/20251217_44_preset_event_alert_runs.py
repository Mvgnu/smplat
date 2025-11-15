"""preset event alert runs"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251217_44_preset_event_alert_runs"
down_revision = "20251216_43_preset_event_daily_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "preset_event_alert_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("window_start_date", sa.Date(), nullable=False),
        sa.Column("window_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("alerts_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("alert_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_preset_event_alert_runs_window_start",
        "preset_event_alert_runs",
        ["window_start_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_preset_event_alert_runs_window_start", table_name="preset_event_alert_runs")
    op.drop_table("preset_event_alert_runs")

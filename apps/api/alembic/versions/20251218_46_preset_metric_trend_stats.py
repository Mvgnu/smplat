"""add trend stats column to preset metrics"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251218_46_preset_metric_trend_stats"
down_revision = "20251217_45_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "preset_event_daily_metrics",
        sa.Column(
            "trend_stats",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("preset_event_daily_metrics", "trend_stats")

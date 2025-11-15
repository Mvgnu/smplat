"""preset daily metrics"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251216_43_preset_event_daily_metrics"
down_revision = "20251215_42_product_media_asset_enrichment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "preset_event_daily_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("metric_date", sa.Date(), nullable=False, unique=True),
        sa.Column("preset_cta_apply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("preset_configurator_apply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("preset_configurator_clear_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_preset_event_daily_metrics_metric_date",
        "preset_event_daily_metrics",
        ["metric_date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_preset_event_daily_metrics_metric_date", table_name="preset_event_daily_metrics")
    op.drop_table("preset_event_daily_metrics")

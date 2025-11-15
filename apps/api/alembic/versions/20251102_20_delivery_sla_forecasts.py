"""Introduce staffing shifts and metric forecast payloads."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251102_20"
down_revision: Union[str, None] = "20251030_19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create fulfillment_metric_cache table if it doesn't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fulfillment_metric_cache') THEN
                CREATE TABLE fulfillment_metric_cache (
                    id UUID PRIMARY KEY,
                    sku VARCHAR NOT NULL,
                    metric_type VARCHAR NOT NULL,
                    value NUMERIC(12, 2) NOT NULL,
                    forecast JSON,
                    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    UNIQUE (sku, metric_type)
                );
                CREATE INDEX ix_fulfillment_metric_cache_sku ON fulfillment_metric_cache(sku);
            ELSE
                ALTER TABLE fulfillment_metric_cache ADD COLUMN IF NOT EXISTS forecast JSON;
            END IF;
        END $$;
    """)

    op.create_table(
        "fulfillment_staffing_shifts",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sku", sa.String(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hourly_capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "ix_fulfillment_staffing_shifts_window",
        "fulfillment_staffing_shifts",
        ["sku", "starts_at", "ends_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_fulfillment_staffing_shifts_window", table_name="fulfillment_staffing_shifts")
    op.drop_table("fulfillment_staffing_shifts")
    op.drop_table("fulfillment_metric_cache")

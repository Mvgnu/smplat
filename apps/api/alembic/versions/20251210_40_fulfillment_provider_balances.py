"""Create fulfillment provider balance snapshots."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251210_40_fulfillment_provider_balances"
down_revision = "20251210_39_fulfillment_provider_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fulfillment_provider_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("balance_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["fulfillment_providers.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("provider_id", name="uq_fulfillment_provider_balances_provider_id"),
    )


def downgrade() -> None:
    op.drop_table("fulfillment_provider_balances")

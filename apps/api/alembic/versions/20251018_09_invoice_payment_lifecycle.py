"""Enhance invoices with payment lifecycle metadata.

Revision ID: 20251018_09
Revises: 20251017_08
Create Date: 2025-10-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251018_09"
down_revision: Union[str, None] = "20251017_08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("payment_intent_id", sa.String(), nullable=True))
    op.add_column("invoices", sa.Column("external_processor_id", sa.String(), nullable=True))
    op.add_column(
        "invoices",
        sa.Column("settlement_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "invoices",
        sa.Column("adjustments_total", sa.Numeric(12, 2), server_default="0", nullable=False),
    )
    op.add_column("invoices", sa.Column("adjustments", sa.JSON(), nullable=True))
    op.add_column("invoices", sa.Column("payment_timeline", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "payment_timeline")
    op.drop_column("invoices", "adjustments")
    op.drop_column("invoices", "adjustments_total")
    op.drop_column("invoices", "settlement_at")
    op.drop_column("invoices", "external_processor_id")
    op.drop_column("invoices", "payment_intent_id")

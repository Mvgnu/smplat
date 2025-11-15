"""Add processor metadata columns to invoices.

Revision ID: 20251019_10
Revises: 20251018_09
Create Date: 2025-10-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20251019_10"
down_revision: Union[str, None] = "20251018_09"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("processor_customer_id", sa.String(), nullable=True))
    op.add_column("invoices", sa.Column("processor_charge_id", sa.String(), nullable=True))
    op.add_column("invoices", sa.Column("webhook_replay_token", sa.String(), nullable=True))
    op.add_column("invoices", sa.Column("last_payment_error", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "last_payment_error")
    op.drop_column("invoices", "webhook_replay_token")
    op.drop_column("invoices", "processor_charge_id")
    op.drop_column("invoices", "processor_customer_id")

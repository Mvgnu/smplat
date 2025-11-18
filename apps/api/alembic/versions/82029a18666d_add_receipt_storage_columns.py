"""add_receipt_storage_columns

Revision ID: 82029a18666d
Revises: 20260105_60_order_timeline_replay_events
Create Date: 2025-11-17 14:31:25.492182

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '82029a18666d'
down_revision: Union[str, Sequence[str], None] = '20260105_60_order_timeline_replay_events'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "orders",
        sa.Column("receipt_storage_key", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("receipt_storage_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("receipt_storage_uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("orders", "receipt_storage_uploaded_at")
    op.drop_column("orders", "receipt_storage_url")
    op.drop_column("orders", "receipt_storage_key")

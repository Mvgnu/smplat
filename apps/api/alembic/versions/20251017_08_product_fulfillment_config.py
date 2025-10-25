"""Add fulfillment configuration to products.

Revision ID: 20251017_08
Revises: 20251017_07
Create Date: 2025-10-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251017_08"
down_revision: Union[str, None] = "20251017_07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("fulfillment_config", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "fulfillment_config")

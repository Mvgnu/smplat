"""Add platform context JSON column to order items."""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251226_53_order_item_platform_context"
down_revision: Union[str, None] = "20251224_52_onboarding_pricing_experiment_events"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("platform_context", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "platform_context")

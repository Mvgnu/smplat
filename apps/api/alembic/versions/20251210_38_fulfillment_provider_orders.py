"""Create fulfillment provider order log table.

Revision ID: 20251210_38_fulfillment_provider_orders
Revises: 20251210_37_product_add_on_metadata
Create Date: 2025-01-10 09:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251210_38_fulfillment_provider_orders"
down_revision = "20251210_37_product_add_on_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fulfillment_provider_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("provider_name", sa.String(), nullable=True),
        sa.Column("service_id", sa.String(), nullable=False),
        sa.Column("service_action", sa.String(), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_fulfillment_provider_orders_order_id",
        "fulfillment_provider_orders",
        ["order_id"],
    )
    op.create_index(
        "ix_fulfillment_provider_orders_order_item_id",
        "fulfillment_provider_orders",
        ["order_item_id"],
    )
    op.create_index(
        "ix_fulfillment_provider_orders_service_id",
        "fulfillment_provider_orders",
        ["service_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_fulfillment_provider_orders_service_id", table_name="fulfillment_provider_orders")
    op.drop_index("ix_fulfillment_provider_orders_order_item_id", table_name="fulfillment_provider_orders")
    op.drop_index("ix_fulfillment_provider_orders_order_id", table_name="fulfillment_provider_orders")
    op.drop_table("fulfillment_provider_orders")

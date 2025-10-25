"""Commerce core tables.

Revision ID: 20251015_03
Revises: 20251015_02
Create Date: 2025-10-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251015_03"
down_revision: Union[str, None] = "20251015_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE product_status_enum AS ENUM ('draft', 'active', 'archived')")
    op.execute("CREATE TYPE order_status_enum AS ENUM ('pending', 'processing', 'active', 'completed', 'on_hold', 'canceled')")
    op.execute("CREATE TYPE order_source_enum AS ENUM ('checkout', 'manual')")
    op.execute("CREATE TYPE payment_status_enum AS ENUM ('pending', 'succeeded', 'failed', 'refunded')")
    op.execute("CREATE TYPE payment_provider_enum AS ENUM ('stripe', 'manual')")

    op.create_table(
        "products",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False, unique=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("base_price", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "currency",
            sa.Enum(name="preferred_currency_enum", create_type=False),
            nullable=False,
            server_default="EUR",
        ),
        sa.Column(
            "status",
            sa.Enum(name="product_status_enum", create_type=False),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "product_option_groups",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "product_options",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("group_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["product_option_groups.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "orders",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_number", sa.String(), nullable=False, unique=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum(name="order_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "source",
            sa.Enum(name="order_source_enum", create_type=False),
            nullable=False,
            server_default="checkout",
        ),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column(
            "currency",
            sa.Enum(name="preferred_currency_enum", create_type=False),
            nullable=False,
            server_default="EUR",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "order_items",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("product_title", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("selected_options", sa.JSON(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "payments",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "provider",
            sa.Enum(name="payment_provider_enum", create_type=False),
            nullable=False,
            server_default="stripe",
        ),
        sa.Column("provider_reference", sa.String(), nullable=False, unique=True),
        sa.Column(
            "status",
            sa.Enum(name="payment_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "currency",
            sa.Enum(name="preferred_currency_enum", create_type=False),
            nullable=False,
            server_default="EUR",
        ),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
    )

    op.create_index("ix_orders_user_id", "orders", ["user_id"])
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_payments_order_id", "payments", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_payments_order_id", table_name="payments")
    op.drop_index("ix_order_items_order_id", table_name="order_items")
    op.drop_index("ix_orders_user_id", table_name="orders")

    op.drop_table("payments")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("product_options")
    op.drop_table("product_option_groups")
    op.drop_table("products")

    op.execute("DROP TYPE payment_provider_enum")
    op.execute("DROP TYPE payment_status_enum")
    op.execute("DROP TYPE order_source_enum")
    op.execute("DROP TYPE order_status_enum")
    op.execute("DROP TYPE product_status_enum")

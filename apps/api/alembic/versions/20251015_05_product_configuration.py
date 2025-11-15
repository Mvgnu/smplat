"""Add configurable product structures.

Revision ID: 20251015_05
Revises: 20251015_04
Create Date: 2025-10-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251015_05"
down_revision: Union[str, None] = "20251015_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_option_group_type_enum') THEN
                CREATE TYPE product_option_group_type_enum AS ENUM ('single', 'multiple');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_custom_field_type_enum') THEN
                CREATE TYPE product_custom_field_type_enum AS ENUM ('text', 'url', 'number');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_subscription_billing_cycle_enum') THEN
                CREATE TYPE product_subscription_billing_cycle_enum AS ENUM ('one_time', 'monthly', 'quarterly', 'annual');
            END IF;
        END $$;
    """)

    op.add_column(
        "product_option_groups",
        sa.Column(
            "group_type",
            sa.dialects.postgresql.ENUM("single", "multiple", name="product_option_group_type_enum", create_type=False),
            nullable=False,
            server_default="single",
        ),
    )
    op.add_column(
        "product_option_groups",
        sa.Column("metadata_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "product_options",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "product_add_ons",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("is_recommended", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_product_add_ons_product_id", "product_add_ons", ["product_id"])

    op.create_table(
        "product_custom_fields",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column(
            "field_type",
            sa.dialects.postgresql.ENUM("text", "url", "number", name="product_custom_field_type_enum", create_type=False),
            nullable=False,
            server_default="text",
        ),
        sa.Column("placeholder", sa.String(), nullable=True),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_product_custom_fields_product_id", "product_custom_fields", ["product_id"])

    op.create_table(
        "product_subscription_plans",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "billing_cycle",
            sa.dialects.postgresql.ENUM("one_time", "monthly", "quarterly", "annual", name="product_subscription_billing_cycle_enum", create_type=False),
            nullable=False,
            server_default="one_time",
        ),
        sa.Column("price_multiplier", sa.Numeric(10, 2), nullable=True),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_product_subscription_product_id", "product_subscription_plans", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_product_subscription_product_id", table_name="product_subscription_plans")
    op.drop_table("product_subscription_plans")

    op.drop_index("ix_product_custom_fields_product_id", table_name="product_custom_fields")
    op.drop_table("product_custom_fields")

    op.drop_index("ix_product_add_ons_product_id", table_name="product_add_ons")
    op.drop_table("product_add_ons")

    op.drop_column("product_options", "display_order")
    op.drop_column("product_option_groups", "metadata_json")
    op.drop_column("product_option_groups", "group_type")

    op.execute("DROP TYPE product_subscription_billing_cycle_enum")
    op.execute("DROP TYPE product_custom_field_type_enum")
    op.execute("DROP TYPE product_option_group_type_enum")
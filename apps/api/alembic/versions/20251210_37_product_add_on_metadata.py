"""Add metadata_json to product add-ons and backfill pricing mode.

Revision ID: 20251210_37_product_add_on_metadata
Revises: 20251210_36_product_option_structured_pricing
Create Date: 2025-01-09 00:30:00.000000
"""

from __future__ import annotations

from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "20251210_37_product_add_on_metadata"
down_revision = "20251210_36_product_option_structured_pricing"
branch_labels = None
depends_on = None


metadata = sa.MetaData()

product_add_ons = sa.Table(
    "product_add_ons",
    metadata,
    sa.Column("id", sa.String()),
    sa.Column("price_delta", sa.Numeric(10, 2)),
    sa.Column("metadata_json", sa.JSON()),
)


def _decimal_to_float(value: Decimal | float | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        value = float(value)
    return round(float(value), 2)


def upgrade() -> None:
    op.add_column("product_add_ons", sa.Column("metadata_json", sa.JSON(), nullable=True))

    connection = op.get_bind()

    rows = connection.execute(
        sa.select(product_add_ons.c.id, product_add_ons.c.price_delta)
    ).fetchall()

    for row in rows:
        amount = _decimal_to_float(row.price_delta)
        pricing = {
            "mode": "flat",
            "amount": amount,
        }
        connection.execute(
            product_add_ons.update()
            .where(product_add_ons.c.id == row.id)
            .values(metadata_json={"pricing": pricing})
        )


def downgrade() -> None:
    op.drop_column("product_add_ons", "metadata_json")

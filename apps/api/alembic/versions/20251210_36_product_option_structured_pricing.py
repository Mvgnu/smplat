"""Populate structured pricing metadata for existing product options.

Revision ID: 20251210_36_product_option_structured_pricing
Revises: 20251205_35_product_custom_field_metadata
Create Date: 2025-01-09 00:00:00.000000
"""

from __future__ import annotations

from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "20251210_36_product_option_structured_pricing"
down_revision = "20251205_35_product_custom_field_metadata"
branch_labels = None
depends_on = None


metadata = sa.MetaData()

products = sa.Table(
    "products",
    metadata,
    sa.Column("id", sa.String()),
    sa.Column("base_price", sa.Numeric(10, 2)),
)

product_option_groups = sa.Table(
    "product_option_groups",
    metadata,
    sa.Column("id", sa.String()),
    sa.Column("product_id", sa.String()),
    sa.Column("group_type", sa.String()),
)

product_options = sa.Table(
    "product_options",
    metadata,
    sa.Column("id", sa.String()),
    sa.Column("group_id", sa.String()),
    sa.Column("price_delta", sa.Numeric(10, 2)),
    sa.Column("metadata_json", sa.JSON()),
)


def _to_float(value: Decimal | float | int | None, precision: int = 4) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        value = float(value)
    return round(float(value), precision)


def _compute_structured_payload(
    existing_metadata: dict[str, object] | None,
    *,
    price_delta: Decimal | float | None,
    base_price: Decimal | float | None,
    group_type: str | None,
) -> dict[str, object] | None:
    if existing_metadata is None:
        existing_metadata = {}
    else:
        existing_metadata = dict(existing_metadata)

    if isinstance(existing_metadata.get("structuredPricing"), dict):
        # Already populated by operators; leave as-is.
        return None

    base_price_value = _to_float(base_price, precision=2)
    price_delta_value = _to_float(price_delta, precision=2)

    group_type_lower = (group_type or "").lower()
    is_single = group_type_lower == "single"

    if is_single:
        computed_base_price = base_price_value + price_delta_value
        amount_unit = "package"
    else:
        computed_base_price = price_delta_value
        amount_unit = "addon"

    structured_pricing = {
        "amount": 1,
        "amountUnit": amount_unit,
        "basePrice": round(computed_base_price, 2),
        "unitPrice": round(computed_base_price, 4),
    }

    existing_metadata["structuredPricing"] = structured_pricing
    return existing_metadata


def upgrade() -> None:
    connection = op.get_bind()

    option_rows = connection.execute(
        sa.select(
            product_options.c.id,
            product_options.c.metadata_json,
            product_options.c.price_delta,
            product_option_groups.c.group_type,
            products.c.base_price,
        ).select_from(
            product_options.join(
                product_option_groups,
                product_options.c.group_id == product_option_groups.c.id,
            ).join(
                products,
                product_option_groups.c.product_id == products.c.id,
            )
        )
    ).fetchall()

    for row in option_rows:
        updated_metadata = _compute_structured_payload(
            row.metadata_json,
            price_delta=row.price_delta,
            base_price=row.base_price,
            group_type=row.group_type,
        )
        if updated_metadata is None:
            continue

        connection.execute(
            product_options.update()
            .where(product_options.c.id == row.id)
            .values(metadata_json=updated_metadata)
        )


def downgrade() -> None:
    connection = op.get_bind()

    option_rows = connection.execute(
        sa.select(product_options.c.id, product_options.c.metadata_json)
    ).fetchall()

    for row in option_rows:
        metadata_json = row.metadata_json or {}
        if not isinstance(metadata_json, dict):
            continue
        structured = metadata_json.get("structuredPricing")
        if not isinstance(structured, dict):
            continue
        metadata_json = dict(metadata_json)
        metadata_json.pop("structuredPricing", None)
        connection.execute(
            product_options.update()
            .where(product_options.c.id == row.id)
            .values(metadata_json=metadata_json)
        )

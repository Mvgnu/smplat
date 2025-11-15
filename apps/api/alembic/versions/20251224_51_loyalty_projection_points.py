"""Add loyalty projection points column to orders."""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "20251224_51_loyalty_projection_points"
down_revision = "20251224_50_pricing_experiments"
branch_labels = None
depends_on = None


_LOYALTY_NOTE_REGEX = re.compile(r"loyaltyProjection=(\d+)", re.IGNORECASE)


def upgrade() -> None:
    op.add_column("orders", sa.Column("loyalty_projection_points", sa.Integer(), nullable=True))

    bind = op.get_bind()
    result = bind.execute(sa.text("SELECT id, notes FROM orders WHERE notes IS NOT NULL"))
    rows = result.fetchall()
    for row in rows:
        notes = row.notes
        if not notes:
            continue
        match = _LOYALTY_NOTE_REGEX.search(notes)
        if not match:
            continue
        try:
            points = int(match.group(1))
        except ValueError:
            continue
        bind.execute(
            sa.text(
                "UPDATE orders SET loyalty_projection_points = :points "
                "WHERE id = :order_id"
            ),
            {"points": points, "order_id": row.id},
        )


def downgrade() -> None:
    op.drop_column("orders", "loyalty_projection_points")

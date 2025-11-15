from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251203_34"
down_revision: Union[str, None] = "20251202_33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "checkout_offer_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("offer_slug", sa.String(length=255), nullable=False),
        sa.Column("target_slug", sa.String(length=255), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=True),
        sa.Column("cart_total", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("order_reference", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_checkout_offer_events_event_type",
        "checkout_offer_events",
        ["event_type"],
    )
    op.create_index(
        "ix_checkout_offer_events_offer_slug",
        "checkout_offer_events",
        ["offer_slug"],
    )


def downgrade() -> None:
    op.drop_index("ix_checkout_offer_events_offer_slug", table_name="checkout_offer_events")
    op.drop_index("ix_checkout_offer_events_event_type", table_name="checkout_offer_events")
    op.drop_table("checkout_offer_events")

"""Add order state events audit log."""

from collections.abc import Sequence
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision: str = "20260105_59_order_state_events"
down_revision: str | None = "20260105_58_metric_sourcing_accounts"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

STATE_EVENT_TYPE_ENUM = "order_state_event_type_enum"
STATE_EVENT_ACTOR_ENUM = "order_state_actor_type_enum"


def upgrade() -> None:
    conn = op.get_bind()
    state_event_enum = sa.Enum(
        "state_change",
        "note",
        "refill_requested",
        "refill_completed",
        "refund_requested",
        "refund_completed",
        name=STATE_EVENT_TYPE_ENUM,
    )
    actor_enum = sa.Enum(
        "system",
        "operator",
        "admin",
        "automation",
        "provider",
        name=STATE_EVENT_ACTOR_ENUM,
    )
    state_event_enum.create(conn, checkfirst=True)
    actor_enum.create(conn, checkfirst=True)

    op.create_table(
        "order_state_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.Enum(name=STATE_EVENT_TYPE_ENUM), nullable=False),
        sa.Column("actor_type", sa.Enum(name=STATE_EVENT_ACTOR_ENUM), nullable=True),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column("actor_label", sa.String(length=255), nullable=True),
        sa.Column("from_status", sa.String(length=64), nullable=True),
        sa.Column("to_status", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_order_state_events_order_id_created_at",
        "order_state_events",
        ["order_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_order_state_events_order_id_created_at", table_name="order_state_events")
    op.drop_table("order_state_events")

    conn = op.get_bind()
    actor_enum = sa.Enum(name=STATE_EVENT_ACTOR_ENUM)
    state_event_enum = sa.Enum(name=STATE_EVENT_TYPE_ENUM)
    actor_enum.drop(conn, checkfirst=True)
    state_event_enum.drop(conn, checkfirst=True)

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251201_31"
down_revision: Union[str, None] = "20251128_30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


checkout_stage_enum = sa.Enum(
    "payment",
    "verification",
    "loyalty_hold",
    "fulfillment",
    "completed",
    name="checkout_orchestration_stage_enum",
)

checkout_status_enum = sa.Enum(
    "not_started",
    "in_progress",
    "waiting",
    "completed",
    "failed",
    name="checkout_orchestration_status_enum",
)


def upgrade() -> None:
    bind = op.get_bind()
    checkout_stage_enum.create(bind, checkfirst=True)
    checkout_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "checkout_orchestrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("current_stage", checkout_stage_enum, nullable=False, server_default="payment"),
        sa.Column("stage_status", checkout_status_enum, nullable=False, server_default="not_started"),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_transition_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_action_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "checkout_orchestration_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "orchestration_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("checkout_orchestrations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stage", checkout_stage_enum, nullable=False),
        sa.Column("status", checkout_status_enum, nullable=False),
        sa.Column("transition_note", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_checkout_orchestration_events_orchestration_id",
        "checkout_orchestration_events",
        ["orchestration_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_checkout_orchestration_events_orchestration_id",
        table_name="checkout_orchestration_events",
    )
    op.drop_table("checkout_orchestration_events")
    op.drop_table("checkout_orchestrations")
    bind = op.get_bind()
    checkout_status_enum.drop(bind, checkfirst=True)
    checkout_stage_enum.drop(bind, checkfirst=True)

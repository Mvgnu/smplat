"""Create loyalty nudges table."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251120_26"
down_revision: Union[str, None] = "20251118_25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


nudge_type_enum = sa.Enum(
    "expiring_points",
    "checkout_reminder",
    "redemption_follow_up",
    name="loyalty_nudge_type",
)

nudge_status_enum = sa.Enum(
    "active",
    "acknowledged",
    "dismissed",
    "expired",
    name="loyalty_nudge_status",
)


def upgrade() -> None:
    bind = op.get_bind()
    nudge_type_enum.create(bind, checkfirst=True)
    nudge_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "loyalty_nudges",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "member_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nudge_type", nudge_type_enum, nullable=False),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column(
            "status",
            nudge_status_enum,
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "priority",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "member_id",
            "nudge_type",
            "source_id",
            name="uq_loyalty_nudges_member_type_source",
        ),
    )
    op.create_index(
        "ix_loyalty_nudges_member_status",
        "loyalty_nudges",
        ["member_id", "status"],
    )
    op.create_index(
        "ix_loyalty_nudges_type_status",
        "loyalty_nudges",
        ["nudge_type", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_nudges_type_status",
        table_name="loyalty_nudges",
    )
    op.drop_index(
        "ix_loyalty_nudges_member_status",
        table_name="loyalty_nudges",
    )
    op.drop_table("loyalty_nudges")

    bind = op.get_bind()
    nudge_status_enum.drop(bind, checkfirst=True)
    nudge_type_enum.drop(bind, checkfirst=True)

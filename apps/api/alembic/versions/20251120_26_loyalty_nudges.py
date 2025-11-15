"""Create loyalty nudges table."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251120_26"
down_revision: Union[str, None] = "20251118_25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types idempotently
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_nudge_type') THEN
                CREATE TYPE loyalty_nudge_type AS ENUM (
                    'expiring_points',
                    'checkout_reminder',
                    'redemption_follow_up'
                );
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_nudge_status') THEN
                CREATE TYPE loyalty_nudge_status AS ENUM (
                    'active',
                    'acknowledged',
                    'dismissed',
                    'expired'
                );
            END IF;
        END $$;
    """)

    op.create_table(
        "loyalty_nudges",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "member_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "nudge_type",
            postgresql.ENUM(
                "expiring_points",
                "checkout_reminder",
                "redemption_follow_up",
                name="loyalty_nudge_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "active",
                "acknowledged",
                "dismissed",
                "expired",
                name="loyalty_nudge_status",
                create_type=False,
            ),
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

    op.execute("DROP TYPE IF EXISTS loyalty_nudge_status")
    op.execute("DROP TYPE IF EXISTS loyalty_nudge_type")

"""Add loyalty redemptions and point expirations."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251112_24"
down_revision: Union[str, None] = "20251111_23"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_redemption_status') THEN
                CREATE TYPE loyalty_redemption_status AS ENUM ('requested', 'fulfilled', 'failed', 'cancelled');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_point_expiration_status') THEN
                CREATE TYPE loyalty_point_expiration_status AS ENUM ('scheduled', 'expired', 'consumed', 'cancelled');
            END IF;
        END $$;
    """)

    op.add_column(
        "loyalty_members",
        sa.Column(
            "points_on_hold",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0",
        ),
    )

    op.create_table(
        "loyalty_rewards",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cost_points", sa.Numeric(12, 2), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "loyalty_redemptions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "member_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reward_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_rewards.id"),
            nullable=True,
        ),
        sa.Column("status", sa.dialects.postgresql.ENUM("requested", "fulfilled", "failed", "cancelled", name="loyalty_redemption_status", create_type=False), nullable=False, server_default="requested"),
        sa.Column("points_cost", sa.Numeric(12, 2), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.String(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "loyalty_point_expirations",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "member_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("points", sa.Numeric(12, 2), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_points", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.dialects.postgresql.ENUM("scheduled", "expired", "consumed", "cancelled", name="loyalty_point_expiration_status", create_type=False), nullable=False, server_default="scheduled"),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_index(
        "ix_loyalty_point_expirations_member_id_expires_at",
        "loyalty_point_expirations",
        ["member_id", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_point_expirations_member_id_expires_at",
        table_name="loyalty_point_expirations",
    )
    op.drop_table("loyalty_point_expirations")
    op.drop_table("loyalty_redemptions")
    op.drop_table("loyalty_rewards")
    op.execute("ALTER TABLE loyalty_members DROP COLUMN points_on_hold")
    op.execute("DROP TYPE IF EXISTS loyalty_redemption_status")
    op.execute("DROP TYPE IF EXISTS loyalty_point_expiration_status")

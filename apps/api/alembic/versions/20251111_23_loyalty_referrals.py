"""Create loyalty and referral tables."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251111_23"
down_revision: Union[str, None] = "20251106_22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_ledger_entry_type') THEN
                CREATE TYPE loyalty_ledger_entry_type AS ENUM ('earn', 'redeem', 'adjustment', 'referral_bonus', 'tier_bonus');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_referral_status') THEN
                CREATE TYPE loyalty_referral_status AS ENUM ('draft', 'sent', 'converted', 'expired', 'cancelled');
            END IF;
        END $$;
    """)

    op.create_table(
        "loyalty_tiers",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("point_threshold", sa.Numeric(12, 2), nullable=False),
        sa.Column("benefits", sa.JSON(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "loyalty_members",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_tier_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("loyalty_tiers.id"), nullable=True),
        sa.Column("points_balance", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("lifetime_points", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("referral_code", sa.String(), nullable=True, unique=True),
        sa.Column("last_tier_upgrade_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", name="uq_loyalty_members_user_id"),
    )

    op.create_table(
        "loyalty_ledger_entries",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("member_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_type", sa.dialects.postgresql.ENUM("earn", "redeem", "adjustment", "referral_bonus", "tier_bonus", name="loyalty_ledger_entry_type", create_type=False), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "loyalty_referral_invites",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("referrer_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(), nullable=False, unique=True),
        sa.Column("invitee_email", sa.String(), nullable=True),
        sa.Column("invitee_user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.dialects.postgresql.ENUM("draft", "sent", "converted", "expired", "cancelled", name="loyalty_referral_status", create_type=False), nullable=False, server_default="draft"),
        sa.Column("reward_points", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("loyalty_referral_invites")
    op.drop_table("loyalty_ledger_entries")
    op.drop_table("loyalty_members")
    op.drop_table("loyalty_tiers")
    op.execute("DROP TYPE IF EXISTS loyalty_ledger_entry_type")
    op.execute("DROP TYPE IF EXISTS loyalty_referral_status")

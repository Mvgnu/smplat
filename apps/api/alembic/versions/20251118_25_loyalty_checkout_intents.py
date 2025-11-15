"""Create loyalty checkout intents table."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251118_25"
down_revision: Union[str, None] = "20251112_24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_checkout_intent_kind') THEN
                CREATE TYPE loyalty_checkout_intent_kind AS ENUM ('redemption', 'referral_share');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_checkout_intent_status') THEN
                CREATE TYPE loyalty_checkout_intent_status AS ENUM ('pending', 'resolved', 'cancelled', 'expired');
            END IF;
        END $$;
    """)

    op.create_table(
        "loyalty_checkout_intents",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "member_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("kind", sa.dialects.postgresql.ENUM("redemption", "referral_share", name="loyalty_checkout_intent_kind", create_type=False), nullable=False),
        sa.Column(
            "status",
            sa.dialects.postgresql.ENUM("pending", "resolved", "cancelled", "expired", name="loyalty_checkout_intent_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("order_id", sa.String(), nullable=True),
        sa.Column(
            "redemption_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_redemptions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("referral_code", sa.String(), nullable=True),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
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
            "external_id",
            name="uq_loyalty_checkout_intents_member_external",
        ),
    )
    op.create_index(
        "ix_loyalty_checkout_intents_member_status",
        "loyalty_checkout_intents",
        ["member_id", "status"],
    )
    op.create_index(
        "ix_loyalty_checkout_intents_expires_at",
        "loyalty_checkout_intents",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_checkout_intents_expires_at",
        table_name="loyalty_checkout_intents",
    )
    op.drop_index(
        "ix_loyalty_checkout_intents_member_status",
        table_name="loyalty_checkout_intents",
    )
    op.drop_table("loyalty_checkout_intents")
    op.execute("DROP TYPE IF EXISTS loyalty_checkout_intent_status")
    op.execute("DROP TYPE IF EXISTS loyalty_checkout_intent_kind")

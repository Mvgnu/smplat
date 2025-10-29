"""Create loyalty checkout intents table."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251118_25"
down_revision: Union[str, None] = "20251112_24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


intent_kind_enum = sa.Enum(
    "redemption",
    "referral_share",
    name="loyalty_checkout_intent_kind",
)

intent_status_enum = sa.Enum(
    "pending",
    "resolved",
    "cancelled",
    "expired",
    name="loyalty_checkout_intent_status",
)


def upgrade() -> None:
    bind = op.get_bind()
    intent_kind_enum.create(bind, checkfirst=True)
    intent_status_enum.create(bind, checkfirst=True)

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
        sa.Column("kind", intent_kind_enum, nullable=False),
        sa.Column(
            "status",
            intent_status_enum,
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
    bind = op.get_bind()
    intent_status_enum.drop(bind, checkfirst=True)
    intent_kind_enum.drop(bind, checkfirst=True)

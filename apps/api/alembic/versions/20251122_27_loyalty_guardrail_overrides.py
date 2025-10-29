"""Loyalty guardrail overrides and audit events."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251122_27"
down_revision: Union[str, None] = "20251120_26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


guardrail_scope_enum = sa.Enum(
    "invite_quota",
    "invite_cooldown",
    "global_throttle",
    name="loyalty_guardrail_override_scope",
)

audit_action_enum = sa.Enum(
    "created",
    "revoked",
    name="loyalty_guardrail_audit_action",
)


def upgrade() -> None:
    bind = op.get_bind()
    guardrail_scope_enum.create(bind, checkfirst=True)
    audit_action_enum.create(bind, checkfirst=True)

    op.create_table(
        "loyalty_guardrail_overrides",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", guardrail_scope_enum, nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True, server_default=sa.text("'{}'::jsonb")),
        sa.Column("target_member_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
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
        sa.ForeignKeyConstraint(["target_member_id"], ["loyalty_members.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_loyalty_guardrail_overrides_scope_active",
        "loyalty_guardrail_overrides",
        ["scope", "is_active"],
    )

    op.create_table(
        "loyalty_guardrail_audit_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "override_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_guardrail_overrides.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", audit_action_enum, nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("actor_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_loyalty_guardrail_audit_events_override",
        "loyalty_guardrail_audit_events",
        ["override_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_guardrail_audit_events_override",
        table_name="loyalty_guardrail_audit_events",
    )
    op.drop_table("loyalty_guardrail_audit_events")

    op.drop_index(
        "ix_loyalty_guardrail_overrides_scope_active",
        table_name="loyalty_guardrail_overrides",
    )
    op.drop_table("loyalty_guardrail_overrides")

    bind = op.get_bind()
    audit_action_enum.drop(bind, checkfirst=True)
    guardrail_scope_enum.drop(bind, checkfirst=True)

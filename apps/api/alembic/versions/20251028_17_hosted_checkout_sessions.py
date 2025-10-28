"""Create hosted checkout session table."""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20251028_17"
down_revision: Union[str, None] = "20251027_16"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


HOSTED_SESSION_STATUS_ENUM = "hosted_checkout_session_status_enum"


def upgrade() -> None:
    op.create_table(
        "hosted_checkout_sessions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "initiated",
                "completed",
                "expired",
                "abandoned",
                "failed",
                name=HOSTED_SESSION_STATUS_ENUM,
            ),
            nullable=False,
            server_default="initiated",
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("recovery_notes", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_hosted_checkout_sessions_session_id",
        "hosted_checkout_sessions",
        ["session_id"],
        unique=True,
    )
    op.create_index(
        "ix_hosted_checkout_sessions_workspace_id",
        "hosted_checkout_sessions",
        ["workspace_id"],
    )
    op.create_index(
        "ix_hosted_checkout_sessions_invoice_id",
        "hosted_checkout_sessions",
        ["invoice_id"],
    )

    op.add_column(
        "invoices",
        sa.Column(
            "hosted_session_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_invoices_hosted_session_id",
        "invoices",
        "hosted_checkout_sessions",
        ["hosted_session_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_invoices_hosted_session_id",
        "invoices",
        type_="foreignkey",
    )
    op.drop_column("invoices", "hosted_session_id")
    op.drop_index(
        "ix_hosted_checkout_sessions_invoice_id",
        table_name="hosted_checkout_sessions",
    )
    op.drop_index(
        "ix_hosted_checkout_sessions_workspace_id",
        table_name="hosted_checkout_sessions",
    )
    op.drop_index(
        "ix_hosted_checkout_sessions_session_id",
        table_name="hosted_checkout_sessions",
    )
    op.drop_table("hosted_checkout_sessions")
    op.execute(f"DROP TYPE IF EXISTS {HOSTED_SESSION_STATUS_ENUM}")

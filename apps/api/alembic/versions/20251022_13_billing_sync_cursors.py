"""Add billing sync cursor checkpoints."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251022_13"
down_revision: Union[str, None] = "20251021_12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "billing_sync_cursors",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("processor", sa.String(length=32), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=False),
        sa.Column("cursor_token", sa.String(length=256), nullable=True),
        sa.Column("last_transaction_id", sa.String(length=128), nullable=True),
        sa.Column("last_transaction_occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_transaction_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "workspace_id",
            "processor",
            "object_type",
            name="uq_billing_sync_cursor_scope",
        ),
    )
    op.create_index(
        "ix_billing_sync_cursors_workspace_id",
        "billing_sync_cursors",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_billing_sync_cursors_workspace_id",
        table_name="billing_sync_cursors",
    )
    op.drop_table("billing_sync_cursors")

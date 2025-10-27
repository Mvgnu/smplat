"""Add staging table for unmatched processor statements."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251021_12"
down_revision: Union[str, None] = "20251020_11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processor_statement_staging",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("transaction_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("processor", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.String(length=128), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("workspace_hint", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("first_observed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_observed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "ix_processor_statement_staging_workspace_hint",
        "processor_statement_staging",
        ["workspace_hint"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_processor_statement_staging_workspace_hint",
        table_name="processor_statement_staging",
    )
    op.drop_table("processor_statement_staging")

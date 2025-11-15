"""Add provider automation run history table"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251212_41_provider_automation_runs"
down_revision = "20251210_40_fulfillment_provider_balances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    enum_name = "provider_automation_run_type_enum"
    run_type_enum = postgresql.ENUM("replay", "alert", name=enum_name, create_type=False)
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                CREATE TYPE provider_automation_run_type_enum AS ENUM ('replay', 'alert');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
            """
        )
    )

    op.create_table(
        "provider_automation_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_type",
            run_type_enum,
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("backlog_total", sa.Integer(), nullable=True),
        sa.Column("next_scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("alerts_sent", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("provider_automation_runs")
    run_type_enum = postgresql.ENUM(name="provider_automation_run_type_enum")
    run_type_enum.drop(op.get_bind(), checkfirst=True)

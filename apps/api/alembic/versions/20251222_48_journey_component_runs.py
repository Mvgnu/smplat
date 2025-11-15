"""Create journey component run history table"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251222_48_journey_component_runs"
down_revision = "20251220_47_journey_components"
branch_labels = None
depends_on = None


RUN_STATUS_ENUM_NAME = "journey_component_run_status_enum"
run_status_enum = postgresql.ENUM(
    "pending",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    name=RUN_STATUS_ENUM_NAME,
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            BEGIN
                CREATE TYPE journey_component_run_status_enum AS ENUM (
                    'pending',
                    'queued',
                    'running',
                    'succeeded',
                    'failed',
                    'cancelled'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        END$$;
        """
    )

    op.create_table(
        "journey_component_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("run_token", sa.String(length=64), nullable=False, unique=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("product_component_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("component_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(length=64), nullable=True),
        sa.Column("trigger", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("binding_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "status",
            run_status_enum,
            nullable=False,
            server_default="pending",
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["product_component_id"],
            ["product_journey_components.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["component_id"],
            ["journey_components.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_journey_component_runs_product",
        "journey_component_runs",
        ["product_id"],
    )
    op.create_index(
        "ix_journey_component_runs_component",
        "journey_component_runs",
        ["component_id"],
    )
    op.create_index(
        "ix_journey_component_runs_product_component",
        "journey_component_runs",
        ["product_component_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_journey_component_runs_product_component", table_name="journey_component_runs")
    op.drop_index("ix_journey_component_runs_component", table_name="journey_component_runs")
    op.drop_index("ix_journey_component_runs_product", table_name="journey_component_runs")
    op.drop_table("journey_component_runs")
    sa.Enum(name=RUN_STATUS_ENUM_NAME).drop(op.get_bind(), checkfirst=True)

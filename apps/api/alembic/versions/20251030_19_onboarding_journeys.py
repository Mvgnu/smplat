"""Add onboarding journey persistence tables."""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20251030_19"
down_revision: Union[str, None] = "20251029_18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE onboarding_journey_status AS ENUM ('not_started', 'active', 'completed', 'stalled')"
    )
    op.execute(
        "CREATE TYPE onboarding_task_status AS ENUM ('pending', 'in_progress', 'completed', 'blocked')"
    )
    op.execute(
        "CREATE TYPE onboarding_actor_type AS ENUM ('client', 'operator', 'system')"
    )
    op.execute(
        "CREATE TYPE onboarding_interaction_channel AS ENUM ('dashboard', 'email', 'slack', 'other')"
    )
    op.execute(
        "CREATE TYPE onboarding_event_type AS ENUM ('journey_started', 'task_status_changed', 'artifact_received', 'referral_copied')"
    )

    op.create_table(
        "onboarding_journeys",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum(name="onboarding_journey_status", create_type=False),
            nullable=False,
            server_default="not_started",
        ),
        sa.Column("current_step", sa.String(length=255), nullable=True),
        sa.Column("referral_code", sa.String(length=255), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("progress_percentage", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_onboarding_journeys_order_id",
        "onboarding_journeys",
        ["order_id"],
        unique=True,
    )
    op.create_index(
        "ix_onboarding_journeys_status",
        "onboarding_journeys",
        ["status"],
    )

    op.create_table(
        "onboarding_tasks",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("journey_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(name="onboarding_task_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_onboarding_tasks_journey_status",
        "onboarding_tasks",
        ["journey_id", "status"],
    )

    op.create_table(
        "onboarding_artifacts",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("journey_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["onboarding_tasks.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_onboarding_artifacts_journey_id",
        "onboarding_artifacts",
        ["journey_id"],
    )

    op.create_table(
        "onboarding_interactions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("journey_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "actor_type",
            sa.Enum(name="onboarding_actor_type", create_type=False),
            nullable=False,
            server_default="system",
        ),
        sa.Column(
            "channel",
            sa.Enum(name="onboarding_interaction_channel", create_type=False),
            nullable=False,
            server_default="dashboard",
        ),
        sa.Column("summary", sa.String(length=255), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["onboarding_tasks.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_onboarding_interactions_journey_id",
        "onboarding_interactions",
        ["journey_id"],
    )

    op.create_table(
        "onboarding_journey_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("journey_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(name="onboarding_event_type", create_type=False),
            nullable=False,
        ),
        sa.Column("status_before", sa.String(length=255), nullable=True),
        sa.Column("status_after", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["journey_id"], ["onboarding_journeys.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["onboarding_tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_onboarding_journey_events_order_id",
        "onboarding_journey_events",
        ["order_id"],
    )
    op.create_index(
        "ix_onboarding_journey_events_event_type",
        "onboarding_journey_events",
        ["event_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_onboarding_journey_events_event_type", table_name="onboarding_journey_events")
    op.drop_index("ix_onboarding_journey_events_order_id", table_name="onboarding_journey_events")
    op.drop_table("onboarding_journey_events")

    op.drop_index("ix_onboarding_interactions_journey_id", table_name="onboarding_interactions")
    op.drop_table("onboarding_interactions")

    op.drop_index("ix_onboarding_artifacts_journey_id", table_name="onboarding_artifacts")
    op.drop_table("onboarding_artifacts")

    op.drop_index("ix_onboarding_tasks_journey_status", table_name="onboarding_tasks")
    op.drop_table("onboarding_tasks")

    op.drop_index("ix_onboarding_journeys_status", table_name="onboarding_journeys")
    op.drop_index("ix_onboarding_journeys_order_id", table_name="onboarding_journeys")
    op.drop_table("onboarding_journeys")

    op.execute("DROP TYPE onboarding_event_type")
    op.execute("DROP TYPE onboarding_interaction_channel")
    op.execute("DROP TYPE onboarding_actor_type")
    op.execute("DROP TYPE onboarding_task_status")
    op.execute("DROP TYPE onboarding_journey_status")

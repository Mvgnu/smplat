"""Add telemetry metadata to journey component runs."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251223_49_journey_runtime_telemetry"
down_revision = "20251222_48_journey_component_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "journey_component_runs",
        sa.Column("telemetry", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("journey_component_runs", "telemetry")

"""Add pricing experiment segment onboarding event."""

from __future__ import annotations

from typing import Union

from alembic import op


revision: str = "20251224_52_onboarding_pricing_experiment_events"
down_revision: Union[str, None] = "20251224_51_loyalty_projection_points"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

_EVENT_TYPE = "onboarding_event_type"
_NEW_VALUE = "pricing_experiment_segment"


def upgrade() -> None:
    op.execute(f"ALTER TYPE {_EVENT_TYPE} ADD VALUE IF NOT EXISTS '{_NEW_VALUE}'")


def downgrade() -> None:
  # Postgres cannot drop enum values without recreating the type; leaving as-is.
  pass

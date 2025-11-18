"""Extend order timeline enums for automation replays."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260105_60_order_timeline_replay_events"
down_revision: str | None = "20260105_59_order_state_events"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

ENUM_NAME = "order_state_event_type_enum"
OLD_VALUES = (
    "state_change",
    "note",
    "refill_requested",
    "refill_completed",
    "refund_requested",
    "refund_completed",
)
NEW_VALUES = OLD_VALUES + (
    "replay_scheduled",
    "replay_executed",
    "automation_alert",
)


def upgrade() -> None:
    conn = op.get_bind()
    op.execute(f"ALTER TYPE {ENUM_NAME} RENAME TO {ENUM_NAME}_old")
    new_enum = sa.Enum(*NEW_VALUES, name=ENUM_NAME)
    new_enum.create(conn, checkfirst=False)
    op.execute(
        f"""
        ALTER TABLE order_state_events
        ALTER COLUMN event_type
        TYPE {ENUM_NAME}
        USING event_type::text::{ENUM_NAME}
        """
    )
    op.execute(f"DROP TYPE {ENUM_NAME}_old")


def downgrade() -> None:
    conn = op.get_bind()
    op.execute(f"ALTER TYPE {ENUM_NAME} RENAME TO {ENUM_NAME}_new")
    old_enum = sa.Enum(*OLD_VALUES, name=ENUM_NAME)
    old_enum.create(conn, checkfirst=False)
    drop_values = "', '".join(value for value in NEW_VALUES if value not in OLD_VALUES)
    op.execute(
        f"""
        ALTER TABLE order_state_events
        ALTER COLUMN event_type
        TYPE {ENUM_NAME}
        USING (
            CASE
                WHEN event_type::text IN ('{drop_values}') THEN 'note'
                ELSE event_type::text
            END
        )::{ENUM_NAME}
        """
    )
    op.execute(f"DROP TYPE {ENUM_NAME}_new")

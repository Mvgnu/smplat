from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251202_33"
down_revision: Union[str, None] = "20251202_32"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "access_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("route", sa.String(), nullable=False),
        sa.Column("method", sa.String(), nullable=True),
        sa.Column("required_tier", sa.String(), nullable=False),
        sa.Column("decision", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("subject_email", sa.String(), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("service_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_access_events_route", "access_events", ["route"])
    op.create_index("ix_access_events_user_id", "access_events", ["user_id"])
    op.create_index("ix_access_events_service_account_id", "access_events", ["service_account_id"])


def downgrade() -> None:
    op.drop_index("ix_access_events_service_account_id", table_name="access_events")
    op.drop_index("ix_access_events_user_id", table_name="access_events")
    op.drop_index("ix_access_events_route", table_name="access_events")
    op.drop_table("access_events")

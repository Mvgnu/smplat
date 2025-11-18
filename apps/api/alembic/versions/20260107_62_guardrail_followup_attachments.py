"""Add attachments column to guardrail follow-ups."""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260107_62_guardrail_followup_attachments"
down_revision: Union[str, None] = "20260106_61_receipt_storage_probe_telemetry"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("provider_guardrail_followup", sa.Column("attachments", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("provider_guardrail_followup", "attachments")

"""Add conversion metadata to guardrail follow-ups"""

from collections.abc import Sequence
from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision: str = "20260104_57_guardrail_followup_conversion_metadata"
down_revision: str | None = "20251226_56_guardrail_followup_status"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "provider_guardrail_followup",
        sa.Column("conversion_cursor", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "provider_guardrail_followup",
        sa.Column("conversion_href", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("provider_guardrail_followup", "conversion_href")
    op.drop_column("provider_guardrail_followup", "conversion_cursor")

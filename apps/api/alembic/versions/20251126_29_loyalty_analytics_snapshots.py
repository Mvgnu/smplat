"""Create loyalty analytics snapshots table."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251126_29"
down_revision: Union[str, None] = "20251124_28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "loyalty_analytics_snapshots",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "segments",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "velocity",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index(
        "ix_loyalty_analytics_snapshots_computed_at",
        "loyalty_analytics_snapshots",
        ["computed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_analytics_snapshots_computed_at",
        table_name="loyalty_analytics_snapshots",
    )
    op.drop_table("loyalty_analytics_snapshots")


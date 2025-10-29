from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import table, column


revision: str = "20251128_30"
down_revision: Union[str, None] = "20251126_29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


nudge_channel_enum = sa.Enum(
    "email",
    "sms",
    "push",
    name="loyalty_nudge_channel",
)


def upgrade() -> None:
    bind = op.get_bind()
    nudge_channel_enum.create(bind, checkfirst=True)

    op.create_table(
        "loyalty_nudge_campaigns",
        sa.Column("slug", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False, server_default="86400"),
        sa.Column("frequency_cap_hours", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("default_priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "channel_preferences",
            postgresql.ARRAY(nudge_channel_enum, dimensions=1),
            nullable=False,
            server_default="{email}",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    campaign_table = table(
        "loyalty_nudge_campaigns",
        column("slug", sa.String()),
        column("name", sa.String()),
        column("description", sa.Text()),
        column("ttl_seconds", sa.Integer()),
        column("frequency_cap_hours", sa.Integer()),
        column("default_priority", sa.Integer()),
        column("channel_preferences", postgresql.ARRAY(nudge_channel_enum)),
    )
    op.bulk_insert(
        campaign_table,
        [
            {
                "slug": "expiring_points",
                "name": "Expiring points reminder",
                "description": "Warn members when balances are nearing expiration.",
                "ttl_seconds": 86_400,
                "frequency_cap_hours": 12,
                "default_priority": 20,
                "channel_preferences": ["email", "sms"],
            },
            {
                "slug": "checkout_recovery",
                "name": "Checkout recovery",
                "description": "Prompt members to resume stalled checkouts and redemptions.",
                "ttl_seconds": 172_800,
                "frequency_cap_hours": 6,
                "default_priority": 10,
                "channel_preferences": ["email", "push"],
            },
            {
                "slug": "redemption_follow_up",
                "name": "Redemption follow-up",
                "description": "Keep members informed when redemptions remain pending.",
                "ttl_seconds": 120_960,
                "frequency_cap_hours": 24,
                "default_priority": 5,
                "channel_preferences": ["email"],
            },
        ],
    )

    op.add_column(
        "loyalty_nudges",
        sa.Column(
            "campaign_slug",
            sa.String(length=64),
            sa.ForeignKey("loyalty_nudge_campaigns.slug", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "loyalty_nudges",
        sa.Column(
            "channel_preferences",
            postgresql.ARRAY(nudge_channel_enum, dimensions=1),
            nullable=False,
            server_default="{email}",
        ),
    )

    op.create_table(
        "loyalty_nudge_dispatch_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "nudge_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loyalty_nudges.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", nudge_channel_enum, nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("metadata", sa.JSON(), nullable=True, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index(
        "ix_loyalty_nudge_dispatch_events_nudge_channel",
        "loyalty_nudge_dispatch_events",
        ["nudge_id", "channel", "sent_at"],
    )

    op.add_column(
        "users",
        sa.Column("phone_number", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("push_token", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_loyalty_nudge_dispatch_events_nudge_channel",
        table_name="loyalty_nudge_dispatch_events",
    )
    op.drop_table("loyalty_nudge_dispatch_events")

    op.drop_column("loyalty_nudges", "channel_preferences")
    op.drop_column("loyalty_nudges", "campaign_slug")

    op.drop_table("loyalty_nudge_campaigns")

    op.drop_column("users", "push_token")
    op.drop_column("users", "phone_number")

    bind = op.get_bind()
    nudge_channel_enum.drop(bind, checkfirst=True)

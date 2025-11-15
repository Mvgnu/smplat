"""Add fulfillment and Instagram integration tables.

Revision ID: 20251015_04
Revises: 20251015_03
Create Date: 2025-10-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251015_04"
down_revision: Union[str, None] = "20251015_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_task_type_enum') THEN
                CREATE TYPE fulfillment_task_type_enum AS ENUM ('instagram_setup', 'follower_growth', 'engagement_boost', 'content_promotion', 'analytics_collection', 'campaign_optimization');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_task_status_enum') THEN
                CREATE TYPE fulfillment_task_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'cancelled');
            END IF;
        END $$;
    """)

    op.create_table(
        "instagram_accounts",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("customer_profile_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("instagram_user_id", sa.String(), nullable=True, unique=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("is_business_account", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("follower_count", sa.Integer(), nullable=True),
        sa.Column("following_count", sa.Integer(), nullable=True),
        sa.Column("media_count", sa.Integer(), nullable=True),
        sa.Column("profile_picture_url", sa.Text(), nullable=True),
        sa.Column("biography", sa.Text(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["customer_profile_id"], ["customer_profiles.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_instagram_accounts_customer_profile_id",
        "instagram_accounts",
        ["customer_profile_id"],
    )

    op.create_table(
        "instagram_analytics_snapshots",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("instagram_account_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("snapshot_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("follower_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("following_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_likes_per_post", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_comments_per_post", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("engagement_rate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reach", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("impressions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("posts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stories_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reels_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("additional_metrics", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["instagram_account_id"], ["instagram_accounts.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_instagram_snapshots_account_date",
        "instagram_analytics_snapshots",
        ["instagram_account_id", "snapshot_date"],
    )

    op.create_table(
        "fulfillment_tasks",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_item_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "task_type",
            sa.dialects.postgresql.ENUM("instagram_setup", "follower_growth", "engagement_boost", "content_promotion", "analytics_collection", "campaign_optimization", name="fulfillment_task_type_enum", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.dialects.postgresql.ENUM("pending", "in_progress", "completed", "failed", "cancelled", name="fulfillment_task_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_fulfillment_tasks_order_item_id", "fulfillment_tasks", ["order_item_id"])
    op.create_index("ix_fulfillment_tasks_status", "fulfillment_tasks", ["status"])
    op.create_index("ix_fulfillment_tasks_scheduled_at", "fulfillment_tasks", ["scheduled_at"])

    op.create_table(
        "service_campaigns",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_item_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instagram_account_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("campaign_name", sa.String(), nullable=False),
        sa.Column("campaign_type", sa.String(), nullable=False),
        sa.Column("target_followers", sa.Integer(), nullable=True),
        sa.Column("target_engagement_rate", sa.Integer(), nullable=True),
        sa.Column("target_reach", sa.Integer(), nullable=True),
        sa.Column("current_followers", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_engagement_rate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_reach", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("daily_actions", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("target_hashtags", sa.JSON(), nullable=True),
        sa.Column("target_locations", sa.JSON(), nullable=True),
        sa.Column("target_audience", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["instagram_account_id"], ["instagram_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_service_campaigns_order_item_id", "service_campaigns", ["order_item_id"])
    op.create_index("ix_service_campaigns_instagram_account_id", "service_campaigns", ["instagram_account_id"])

    op.create_table(
        "campaign_activities",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_type", sa.String(), nullable=False),
        sa.Column("target_username", sa.String(), nullable=True),
        sa.Column("target_post_url", sa.String(), nullable=True),
        sa.Column("action_result", sa.String(), nullable=False),
        sa.Column("activity_data", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("performed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["service_campaigns.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_campaign_activities_campaign_id", "campaign_activities", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_campaign_activities_campaign_id", table_name="campaign_activities")
    op.drop_table("campaign_activities")

    op.drop_index("ix_service_campaigns_instagram_account_id", table_name="service_campaigns")
    op.drop_index("ix_service_campaigns_order_item_id", table_name="service_campaigns")
    op.drop_table("service_campaigns")

    op.drop_index("ix_fulfillment_tasks_scheduled_at", table_name="fulfillment_tasks")
    op.drop_index("ix_fulfillment_tasks_status", table_name="fulfillment_tasks")
    op.drop_index("ix_fulfillment_tasks_order_item_id", table_name="fulfillment_tasks")
    op.drop_table("fulfillment_tasks")

    op.drop_index("ix_instagram_snapshots_account_date", table_name="instagram_analytics_snapshots")
    op.drop_table("instagram_analytics_snapshots")

    op.drop_index("ix_instagram_accounts_customer_profile_id", table_name="instagram_accounts")
    op.drop_table("instagram_accounts")

    op.execute("DROP TYPE fulfillment_task_status_enum")
    op.execute("DROP TYPE fulfillment_task_type_enum")
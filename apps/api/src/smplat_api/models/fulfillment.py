"""Fulfillment and task tracking models."""

from enum import Enum
from uuid import uuid4
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, Integer, JSON, String, Text, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class FulfillmentTaskStatusEnum(str, Enum):
    """Status of fulfillment tasks."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FulfillmentTaskTypeEnum(str, Enum):
    """Types of fulfillment tasks."""
    INSTAGRAM_SETUP = "instagram_setup"
    FOLLOWER_GROWTH = "follower_growth"
    ENGAGEMENT_BOOST = "engagement_boost"
    CONTENT_PROMOTION = "content_promotion"
    ANALYTICS_COLLECTION = "analytics_collection"
    CAMPAIGN_OPTIMIZATION = "campaign_optimization"


class FulfillmentTask(Base):
    """Individual fulfillment tasks for order items."""
    __tablename__ = "fulfillment_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_item_id = Column(UUID(as_uuid=True), ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False)
    task_type = Column(
        SqlEnum(FulfillmentTaskTypeEnum, name="fulfillment_task_type_enum"),
        nullable=False
    )
    status = Column(
        SqlEnum(FulfillmentTaskStatusEnum, name="fulfillment_task_status_enum"),
        nullable=False,
        server_default=FulfillmentTaskStatusEnum.PENDING.value
    )
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    payload = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, server_default="0")
    max_retries = Column(Integer, nullable=False, server_default="3")
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    order_item = relationship("OrderItem", back_populates="fulfillment_tasks")


class InstagramAccount(Base):
    """Instagram account details for customers."""
    __tablename__ = "instagram_accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    customer_profile_id = Column(UUID(as_uuid=True), ForeignKey("customer_profiles.id", ondelete="CASCADE"), nullable=False)
    username = Column(String, nullable=False)
    instagram_user_id = Column(String, nullable=True, unique=True)
    access_token = Column(Text, nullable=True)
    is_business_account = Column(Boolean, nullable=False, server_default="false")
    is_verified = Column(Boolean, nullable=False, server_default="false")
    follower_count = Column(Integer, nullable=True)
    following_count = Column(Integer, nullable=True)
    media_count = Column(Integer, nullable=True)
    profile_picture_url = Column(Text, nullable=True)
    biography = Column(Text, nullable=True)
    website = Column(String, nullable=True)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    customer_profile = relationship("CustomerProfile", back_populates="instagram_accounts")
    analytics_snapshots = relationship("InstagramAnalyticsSnapshot", back_populates="instagram_account", cascade="all, delete-orphan")


class InstagramAnalyticsSnapshot(Base):
    """Time-series analytics data for Instagram accounts."""
    __tablename__ = "instagram_analytics_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    instagram_account_id = Column(UUID(as_uuid=True), ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    snapshot_date = Column(DateTime(timezone=True), nullable=False)
    
    # Follower metrics
    follower_count = Column(Integer, nullable=False, server_default="0")
    following_count = Column(Integer, nullable=False, server_default="0")
    
    # Engagement metrics
    avg_likes_per_post = Column(Integer, nullable=False, server_default="0")
    avg_comments_per_post = Column(Integer, nullable=False, server_default="0")
    engagement_rate = Column(Integer, nullable=False, server_default="0")  # Stored as percentage * 100
    
    # Reach and impressions
    reach = Column(Integer, nullable=False, server_default="0")
    impressions = Column(Integer, nullable=False, server_default="0")
    
    # Content metrics
    posts_count = Column(Integer, nullable=False, server_default="0")
    stories_count = Column(Integer, nullable=False, server_default="0")
    reels_count = Column(Integer, nullable=False, server_default="0")
    
    # Additional metrics as JSON for flexibility
    additional_metrics = Column(JSON, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    instagram_account = relationship("InstagramAccount", back_populates="analytics_snapshots")


class ServiceCampaign(Base):
    """Service delivery campaigns for orders."""
    __tablename__ = "service_campaigns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_item_id = Column(UUID(as_uuid=True), ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False)
    instagram_account_id = Column(UUID(as_uuid=True), ForeignKey("instagram_accounts.id", ondelete="SET NULL"), nullable=True)
    
    campaign_name = Column(String, nullable=False)
    campaign_type = Column(String, nullable=False)  # follower_growth, engagement, etc.
    
    # Target metrics
    target_followers = Column(Integer, nullable=True)
    target_engagement_rate = Column(Integer, nullable=True)  # Percentage * 100
    target_reach = Column(Integer, nullable=True)
    
    # Current progress
    current_followers = Column(Integer, nullable=False, server_default="0")
    current_engagement_rate = Column(Integer, nullable=False, server_default="0")
    current_reach = Column(Integer, nullable=False, server_default="0")
    
    # Campaign settings
    daily_actions = Column(Integer, nullable=False, server_default="50")
    target_hashtags = Column(JSON, nullable=True)
    target_locations = Column(JSON, nullable=True)
    target_audience = Column(JSON, nullable=True)
    
    # Status and timing
    status = Column(String, nullable=False, server_default="active")
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    order_item = relationship("OrderItem", back_populates="service_campaign")
    instagram_account = relationship("InstagramAccount")
    campaign_activities = relationship("CampaignActivity", back_populates="campaign", cascade="all, delete-orphan")


class CampaignActivity(Base):
    """Individual activities performed during campaigns."""
    __tablename__ = "campaign_activities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey("service_campaigns.id", ondelete="CASCADE"), nullable=False)

    activity_type = Column(String, nullable=False)  # follow, like, comment, story_view, etc.
    target_username = Column(String, nullable=True)
    target_post_url = Column(String, nullable=True)
    action_result = Column(String, nullable=False)  # success, failed, skipped

    # Activity details
    activity_data = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)

    performed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    campaign = relationship("ServiceCampaign", back_populates="campaign_activities")


class FulfillmentStaffingShift(Base):
    """Operator staffing coverage windows for delivery forecasting."""

    __tablename__ = "fulfillment_staffing_shifts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    sku = Column(String, nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    hourly_capacity = Column(Integer, nullable=False, server_default="0")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
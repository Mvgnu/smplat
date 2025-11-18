"""Customer social account metadata and verification state."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class SocialPlatformEnum(str, Enum):
    """Supported social platforms for storefront deliveries."""

    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    YOUTUBE = "youtube"


class SocialAccountVerificationStatus(str, Enum):
    """Verification lifecycle for a customer social account."""

    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    EXPIRED = "expired"


class CustomerSocialAccount(Base):
    """Persisted social account metadata, verification signals, and metric snapshots."""

    __tablename__ = "customer_social_accounts"
    __table_args__ = (
        UniqueConstraint("platform", "handle", name="uq_social_account_platform_handle"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    customer_profile_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customer_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    platform = Column(
        SqlEnum(SocialPlatformEnum, name="social_platform_enum"),
        nullable=False,
    )
    handle = Column(String(255), nullable=False)
    account_id = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    profile_url = Column(Text, nullable=True)
    avatar_url = Column(Text, nullable=True)
    verification_status = Column(
        SqlEnum(
            SocialAccountVerificationStatus,
            name="social_account_verification_status_enum",
        ),
        nullable=False,
        server_default=SocialAccountVerificationStatus.PENDING.value,
    )
    verification_method = Column(String(255), nullable=True)
    verification_notes = Column(Text, nullable=True)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    last_scraped_at = Column(DateTime(timezone=True), nullable=True)
    baseline_metrics = Column(JSON, nullable=True)
    delivery_snapshots = Column(JSON, nullable=True)
    target_metrics = Column(JSON, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    ownership_token = Column(String(255), nullable=True)
    ownership_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    customer_profile = relationship("CustomerProfile", back_populates="social_accounts")
    order_items = relationship("OrderItem", back_populates="customer_social_account")

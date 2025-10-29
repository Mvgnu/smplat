"""Loyalty and referral domain models."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Numeric,
    String,
    Text,
    JSON,
    func,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class LoyaltyTier(Base):
    """Configurable loyalty tiers with progression thresholds."""

    __tablename__ = "loyalty_tiers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    point_threshold = Column(Numeric(12, 2), nullable=False)
    benefits = Column(JSON, nullable=False, default=list)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    members = relationship("LoyaltyMember", back_populates="current_tier")


class LoyaltyLedgerEntryType(str, Enum):
    """Ledger entry types for loyalty balance adjustments."""

    EARN = "earn"
    REDEEM = "redeem"
    ADJUSTMENT = "adjustment"
    REFERRAL_BONUS = "referral_bonus"
    TIER_BONUS = "tier_bonus"


class LoyaltyMember(Base):
    """Loyalty membership record tied to a user."""

    __tablename__ = "loyalty_members"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_loyalty_members_user_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    current_tier_id = Column(UUID(as_uuid=True), ForeignKey("loyalty_tiers.id"), nullable=True)
    points_balance = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    lifetime_points = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    referral_code = Column(String, nullable=True, unique=True)
    last_tier_upgrade_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    current_tier = relationship("LoyaltyTier", back_populates="members")
    ledger_entries = relationship(
        "LoyaltyLedgerEntry", back_populates="member", cascade="all, delete-orphan"
    )
    referrals = relationship(
        "ReferralInvite", back_populates="referrer", cascade="all, delete-orphan"
    )


class LoyaltyLedgerEntry(Base):
    """Ledger entry storing loyalty point adjustments."""

    __tablename__ = "loyalty_ledger_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_id = Column(UUID(as_uuid=True), ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False)
    entry_type = Column(SqlEnum(LoyaltyLedgerEntryType, name="loyalty_ledger_entry_type"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    member = relationship("LoyaltyMember", back_populates="ledger_entries")


class ReferralStatus(str, Enum):
    """Lifecycle statuses for referral invites."""

    DRAFT = "draft"
    SENT = "sent"
    CONVERTED = "converted"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ReferralInvite(Base):
    """Referral invites issued by loyalty members."""

    __tablename__ = "loyalty_referral_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    referrer_id = Column(UUID(as_uuid=True), ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False)
    code = Column(String, nullable=False, unique=True, index=True)
    invitee_email = Column(String, nullable=True)
    invitee_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(SqlEnum(ReferralStatus, name="loyalty_referral_status"), nullable=False, default=ReferralStatus.DRAFT, server_default=ReferralStatus.DRAFT.value)
    reward_points = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    notes = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    referrer = relationship("LoyaltyMember", back_populates="referrals")

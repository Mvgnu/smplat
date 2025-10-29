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
    Integer,
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
from smplat_api.models.user import User


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
    points_on_hold = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
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
    redemptions = relationship(
        "LoyaltyRedemption", back_populates="member", cascade="all, delete-orphan"
    )
    point_expirations = relationship(
        "LoyaltyPointExpiration", back_populates="member", cascade="all, delete-orphan"
    )
    checkout_intents = relationship(
        "LoyaltyCheckoutIntent", back_populates="member", cascade="all, delete-orphan"
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
    referrer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    code = Column(String, nullable=False, unique=True, index=True)
    invitee_email = Column(String, nullable=True)
    invitee_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(
        SqlEnum(ReferralStatus, name="loyalty_referral_status"),
        nullable=False,
        default=ReferralStatus.DRAFT,
        server_default=ReferralStatus.DRAFT.value,
    )
    reward_points = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    notes = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    referrer = relationship("LoyaltyMember", back_populates="referrals")


class LoyaltyCheckoutIntentKind(str, Enum):
    """Kinds of checkout intents tracked for next actions."""

    REDEMPTION = "redemption"
    REFERRAL_SHARE = "referral_share"


class LoyaltyCheckoutIntentStatus(str, Enum):
    """Lifecycle statuses for checkout intents."""

    PENDING = "pending"
    RESOLVED = "resolved"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class LoyaltyCheckoutIntent(Base):
    """Persisted checkout intents enabling cross-surface reminders."""

    __tablename__ = "loyalty_checkout_intents"
    __table_args__ = (
        UniqueConstraint("member_id", "external_id", name="uq_loyalty_checkout_intents_member_external"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    external_id = Column(String, nullable=False)
    kind = Column(
        SqlEnum(LoyaltyCheckoutIntentKind, name="loyalty_checkout_intent_kind"),
        nullable=False,
    )
    status = Column(
        SqlEnum(LoyaltyCheckoutIntentStatus, name="loyalty_checkout_intent_status"),
        nullable=False,
        default=LoyaltyCheckoutIntentStatus.PENDING,
        server_default=LoyaltyCheckoutIntentStatus.PENDING.value,
    )
    order_id = Column(String, nullable=True)
    redemption_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_redemptions.id", ondelete="SET NULL"),
        nullable=True,
    )
    referral_code = Column(String, nullable=True)
    channel = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    member = relationship("LoyaltyMember", back_populates="checkout_intents")
    redemption = relationship("LoyaltyRedemption")


class LoyaltyNudgeType(str, Enum):
    """Types of loyalty nudges surfaced to members."""

    EXPIRING_POINTS = "expiring_points"
    CHECKOUT_REMINDER = "checkout_reminder"
    REDEMPTION_FOLLOW_UP = "redemption_follow_up"


class LoyaltyNudgeStatus(str, Enum):
    """Lifecycle status for member nudges."""

    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    DISMISSED = "dismissed"
    EXPIRED = "expired"


class LoyaltyNudge(Base):
    """Persisted loyalty nudges for proactive outreach."""

    __tablename__ = "loyalty_nudges"
    __table_args__ = (
        UniqueConstraint(
            "member_id",
            "nudge_type",
            "source_id",
            name="uq_loyalty_nudges_member_type_source",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    nudge_type = Column(
        SqlEnum(LoyaltyNudgeType, name="loyalty_nudge_type"),
        nullable=False,
    )
    source_id = Column(String, nullable=False)
    status = Column(
        SqlEnum(LoyaltyNudgeStatus, name="loyalty_nudge_status"),
        nullable=False,
        default=LoyaltyNudgeStatus.ACTIVE,
        server_default=LoyaltyNudgeStatus.ACTIVE.value,
    )
    priority = Column(Integer, nullable=False, default=0, server_default="0")
    payload_json = Column("payload", JSON, nullable=False, default=dict)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    member = relationship("LoyaltyMember")


class LoyaltyReward(Base):
    """Redeemable rewards for loyalty members."""

    __tablename__ = "loyalty_rewards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    cost_points = Column(Numeric(12, 2), nullable=False)
    metadata_json = Column("metadata", JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    redemptions = relationship("LoyaltyRedemption", back_populates="reward")


class LoyaltyRedemptionStatus(str, Enum):
    """Status lifecycle for loyalty redemptions."""

    REQUESTED = "requested"
    FULFILLED = "fulfilled"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LoyaltyRedemption(Base):
    """Tracks redemption requests and fulfillment state."""

    __tablename__ = "loyalty_redemptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_id = Column(
        UUID(as_uuid=True), ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False
    )
    reward_id = Column(UUID(as_uuid=True), ForeignKey("loyalty_rewards.id"), nullable=True)
    status = Column(
        SqlEnum(LoyaltyRedemptionStatus, name="loyalty_redemption_status"),
        nullable=False,
        default=LoyaltyRedemptionStatus.REQUESTED,
        server_default=LoyaltyRedemptionStatus.REQUESTED.value,
    )
    points_cost = Column(Numeric(12, 2), nullable=False)
    quantity = Column(Integer, nullable=False, default=1, server_default="1")
    requested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    fulfilled_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(String, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    member = relationship("LoyaltyMember", back_populates="redemptions")
    reward = relationship("LoyaltyReward", back_populates="redemptions")


class LoyaltyPointExpirationStatus(str, Enum):
    """Status for scheduled loyalty balance expirations."""

    SCHEDULED = "scheduled"
    EXPIRED = "expired"
    CONSUMED = "consumed"
    CANCELLED = "cancelled"


class LoyaltyPointExpiration(Base):
    """Represents scheduled expiration of loyalty points."""

    __tablename__ = "loyalty_point_expirations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    member_id = Column(
        UUID(as_uuid=True), ForeignKey("loyalty_members.id", ondelete="CASCADE"), nullable=False
    )
    points = Column(Numeric(12, 2), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_points = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    status = Column(
        SqlEnum(LoyaltyPointExpirationStatus, name="loyalty_point_expiration_status"),
        nullable=False,
        default=LoyaltyPointExpirationStatus.SCHEDULED,
        server_default=LoyaltyPointExpirationStatus.SCHEDULED.value,
    )
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    member = relationship("LoyaltyMember", back_populates="point_expirations")


class LoyaltyGuardrailOverrideScope(str, Enum):
    """Scopes for operator-controlled guardrail overrides."""

    INVITE_QUOTA = "invite_quota"
    INVITE_COOLDOWN = "invite_cooldown"
    GLOBAL_THROTTLE = "global_throttle"


class LoyaltyGuardrailOverride(Base):
    """Operator overrides that temporarily relax loyalty guardrails."""

    __tablename__ = "loyalty_guardrail_overrides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    scope = Column(
        SqlEnum(LoyaltyGuardrailOverrideScope, name="loyalty_guardrail_override_scope"),
        nullable=False,
    )
    justification = Column(Text, nullable=False)
    metadata_json = Column("metadata", JSON, nullable=True)
    target_member_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_members.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    target_member = relationship("LoyaltyMember")
    created_by = relationship("User")
    audit_events = relationship(
        "LoyaltyGuardrailAuditEvent",
        back_populates="override",
        cascade="all, delete-orphan",
    )


class LoyaltyGuardrailAuditAction(str, Enum):
    """Lifecycle actions recorded for guardrail overrides."""

    CREATED = "created"
    REVOKED = "revoked"


class LoyaltyGuardrailAuditEvent(Base):
    """Audit trail for operator guardrail overrides."""

    __tablename__ = "loyalty_guardrail_audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    override_id = Column(
        UUID(as_uuid=True),
        ForeignKey("loyalty_guardrail_overrides.id", ondelete="CASCADE"),
        nullable=False,
    )
    action = Column(
        SqlEnum(LoyaltyGuardrailAuditAction, name="loyalty_guardrail_audit_action"),
        nullable=False,
    )
    message = Column(Text, nullable=True)
    actor_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    override = relationship("LoyaltyGuardrailOverride", back_populates="audit_events")
    actor = relationship("User")

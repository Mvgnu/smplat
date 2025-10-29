"""Service layer for loyalty tiers and referral issuance."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.loyalty import (
    LoyaltyGuardrailAuditAction,
    LoyaltyGuardrailAuditEvent,
    LoyaltyGuardrailOverride,
    LoyaltyGuardrailOverrideScope,
    LoyaltyCheckoutIntent,
    LoyaltyCheckoutIntentKind,
    LoyaltyCheckoutIntentStatus,
    LoyaltyLedgerEntry,
    LoyaltyLedgerEntryType,
    LoyaltyNudge,
    LoyaltyNudgeCampaign,
    LoyaltyNudgeChannel,
    LoyaltyNudgeDispatchEvent,
    LoyaltyNudgeStatus,
    LoyaltyNudgeType,
    LoyaltyMember,
    LoyaltyPointExpiration,
    LoyaltyPointExpirationStatus,
    LoyaltyRedemption,
    LoyaltyRedemptionStatus,
    LoyaltyReward,
    LoyaltyTier,
    ReferralInvite,
    ReferralStatus,
)
from smplat_api.models.user import User
from smplat_api.services.notifications import NotificationService
from smplat_api.core.settings import settings


CHECKOUT_INTENT_DEFAULT_TTL = timedelta(days=14)
NUDGE_REFRESH_WINDOW = timedelta(hours=6)
NUDGE_EXPIRING_POINTS_WINDOW = timedelta(days=7)
NUDGE_REDEMPTION_STALLED_WINDOW = timedelta(days=3)


@dataclass
class LoyaltyNudgeCard:
    """Serializable representation of loyalty nudge cards."""

    id: UUID
    nudge_type: LoyaltyNudgeType
    headline: str
    body: str
    cta_label: Optional[str]
    cta_href: Optional[str]
    expires_at: Optional[datetime]
    priority: int
    metadata: dict[str, Any]
    campaign_slug: Optional[str]
    channels: list[LoyaltyNudgeChannel]


@dataclass
class NudgeCampaignConfig:
    """Resolved campaign configuration for nudge orchestration."""

    slug: str
    ttl: timedelta
    frequency_cap: timedelta
    default_priority: int
    channels: list[LoyaltyNudgeChannel]


@dataclass
class _NudgeSignal:
    """Internal representation of a nudge-worthy signal."""

    nudge_type: LoyaltyNudgeType
    source_id: str
    payload: dict[str, Any]
    expires_at: Optional[datetime]
    priority: int = 0
    campaign_slug: Optional[str] = None
    channels: Optional[list[LoyaltyNudgeChannel]] = None


@dataclass
class LoyaltyNudgeDispatchCandidate:
    """Pending dispatch enriched with delivery channels."""

    nudge: LoyaltyNudge
    channels: list[LoyaltyNudgeChannel]


@dataclass
class LoyaltySnapshot:
    """Serializable loyalty overview for clients."""

    member_id: UUID
    user_id: UUID
    current_tier: Optional[str]
    points_balance: Decimal
    points_on_hold: Decimal
    available_points: Decimal
    lifetime_points: Decimal
    progress_to_next_tier: Decimal
    next_tier: Optional[str]
    upcoming_benefits: list[Any]
    referral_code: Optional[str]
    expiring_points: list["PointsExpirationWindow"]


@dataclass
class PointsExpirationWindow:
    """Serializable representation of upcoming expirations."""

    expires_at: datetime
    total_points: Decimal
    remaining_points: Decimal
    status: LoyaltyPointExpirationStatus


@dataclass
class LoyaltyGuardrailOverrideRecord:
    """Serializable guardrail override for operator tooling."""

    id: UUID
    scope: LoyaltyGuardrailOverrideScope
    justification: str
    metadata: dict[str, Any]
    target_member_id: UUID | None
    created_by_user_id: UUID | None
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    is_active: bool


@dataclass
class LoyaltyGuardrailSnapshot:
    """Aggregated guardrail posture for operator console."""

    invite_quota: int
    total_active_invites: int
    members_at_quota: int
    cooldown_seconds: int
    cooldown_remaining_seconds: int | None
    cooldown_until: datetime | None
    throttle_override_active: bool
    overrides: list[LoyaltyGuardrailOverrideRecord]


class LoyaltyService:
    """Coordinates loyalty and referral domain workflows."""

    def __init__(
        self,
        db_session: AsyncSession,
        *,
        notification_service: NotificationService | None = None,
    ) -> None:
        self._db = db_session
        self._notifications = notification_service or NotificationService(db_session)
        self._campaign_cache: dict[str, NudgeCampaignConfig] | None = None

    async def _get_campaigns(self) -> dict[str, NudgeCampaignConfig]:
        """Load loyalty nudge campaigns from persistence."""

        if self._campaign_cache is not None:
            return self._campaign_cache

        stmt = select(LoyaltyNudgeCampaign)
        result = await self._db.execute(stmt)
        campaigns: dict[str, NudgeCampaignConfig] = {}
        for record in result.scalars().all():
            channels = list(record.channel_preferences or [])
            if not channels:
                channels = [LoyaltyNudgeChannel.EMAIL]
            campaigns[record.slug] = NudgeCampaignConfig(
                slug=record.slug,
                ttl=timedelta(seconds=int(record.ttl_seconds or 0) or 86_400),
                frequency_cap=timedelta(hours=int(record.frequency_cap_hours or 0) or 12),
                default_priority=int(record.default_priority or 0),
                channels=channels,
            )

        self._campaign_cache = campaigns
        return campaigns

    @staticmethod
    def _normalize_channels(
        channels: Sequence[LoyaltyNudgeChannel | str] | None,
    ) -> list[LoyaltyNudgeChannel]:
        """Ensure channel preferences resolve to enum values."""

        resolved: list[LoyaltyNudgeChannel] = []
        for entry in channels or []:
            if isinstance(entry, LoyaltyNudgeChannel):
                resolved.append(entry)
                continue
            try:
                resolved.append(LoyaltyNudgeChannel(str(entry)))
            except ValueError:
                logger.warning("Ignoring unsupported loyalty nudge channel", channel=entry)

        if not resolved:
            resolved = [LoyaltyNudgeChannel.EMAIL]
        return resolved

    @staticmethod
    def _resolve_campaign(
        slug: str | None,
        campaigns: dict[str, NudgeCampaignConfig],
        *,
        fallback_priority: int,
    ) -> NudgeCampaignConfig:
        """Resolve campaign metadata with sane defaults."""

        if slug and slug in campaigns:
            return campaigns[slug]

        return NudgeCampaignConfig(
            slug=slug or "default",
            ttl=timedelta(days=1),
            frequency_cap=timedelta(hours=12),
            default_priority=fallback_priority,
            channels=[LoyaltyNudgeChannel.EMAIL],
        )

    async def list_active_tiers(self) -> list[LoyaltyTier]:
        """Return active tiers ordered by threshold."""

        stmt = (
            select(LoyaltyTier)
            .where(LoyaltyTier.is_active.is_(True))
            .order_by(LoyaltyTier.point_threshold.asc())
        )
        result = await self._db.execute(stmt)
        tiers = list(result.scalars().all())
        logger.debug("Fetched loyalty tiers", count=len(tiers))
        return tiers

    async def list_active_rewards(self) -> list[LoyaltyReward]:
        """Return active loyalty rewards ordered by cost."""

        stmt = (
            select(LoyaltyReward)
            .where(LoyaltyReward.is_active.is_(True))
            .order_by(LoyaltyReward.cost_points.asc())
        )
        result = await self._db.execute(stmt)
        rewards = list(result.scalars().all())
        logger.debug("Fetched loyalty rewards", count=len(rewards))
        return rewards

    async def get_reward(self, slug: str) -> LoyaltyReward | None:
        """Lookup a reward by slug."""

        stmt = select(LoyaltyReward).where(LoyaltyReward.slug == slug)
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def ensure_member(self, user_id: UUID) -> LoyaltyMember:
        """Fetch or create the loyalty membership for a user."""

        stmt = (
            select(LoyaltyMember)
            .options(selectinload(LoyaltyMember.current_tier))
            .where(LoyaltyMember.user_id == user_id)
        )
        result = await self._db.execute(stmt)
        member = result.scalar_one_or_none()
        if member:
            return member

        referral_code = await self._generate_unique_referral_code()
        member = LoyaltyMember(
            user_id=user_id,
            referral_code=referral_code,
        )
        self._db.add(member)
        try:
            await self._db.flush()
            logger.info("Created loyalty member", user_id=str(user_id), member_id=str(member.id))
        except IntegrityError:
            await self._db.rollback()
            logger.warning("Detected race when creating loyalty member", user_id=str(user_id))
            return await self.ensure_member(user_id)

        await self._assign_initial_tier(member)
        await self._db.commit()
        await self._db.refresh(member)
        return member

    async def record_ledger_entry(
        self,
        member: LoyaltyMember,
        *,
        entry_type: LoyaltyLedgerEntryType,
        amount: Decimal,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        expires_at: datetime | None = None,
    ) -> LoyaltyLedgerEntry:
        """Record a loyalty ledger entry and update balances."""

        if amount == Decimal("0"):
            raise ValueError("Ledger entries require a non-zero amount")

        balance_before = Decimal(member.points_balance or Decimal("0"))
        balance_delta = Decimal(amount)
        new_balance = balance_before + balance_delta
        if new_balance < Decimal("0"):
            raise ValueError("Insufficient loyalty balance for ledger entry")

        ledger_entry = LoyaltyLedgerEntry(
            member_id=member.id,
            entry_type=entry_type,
            amount=amount,
            description=description,
            metadata_json=metadata or {},
        )
        self._db.add(ledger_entry)

        member.points_balance = new_balance
        if entry_type in {
            LoyaltyLedgerEntryType.EARN,
            LoyaltyLedgerEntryType.REFERRAL_BONUS,
            LoyaltyLedgerEntryType.TIER_BONUS,
        }:
            member.lifetime_points = (member.lifetime_points or Decimal("0")) + amount

        if expires_at and amount > Decimal("0"):
            await self._create_point_expiration(
                member,
                points=amount,
                expires_at=expires_at,
                metadata=metadata or {},
            )

        await self._maybe_upgrade_tier(member)
        await self._db.flush()
        logger.info(
            "Recorded loyalty ledger entry",
            member_id=str(member.id),
            amount=str(amount),
            entry_type=entry_type.value,
        )
        return ledger_entry

    async def issue_referral(
        self,
        member: LoyaltyMember,
        *,
        invitee_email: str | None,
        reward_points: Decimal,
        metadata: dict[str, Any] | None = None,
        status: ReferralStatus = ReferralStatus.SENT,
    ) -> ReferralInvite:
        """Create a referral invite for a member."""

        code = await self._generate_unique_referral_code()
        referral = ReferralInvite(
            referrer_id=member.id,
            code=code,
            invitee_email=invitee_email,
            reward_points=reward_points,
            metadata_json=metadata or {},
            status=status,
        )
        self._db.add(referral)
        await self._db.flush()
        logger.info("Issued referral invite", code=code, member_id=str(member.id))
        return referral

    async def list_member_referrals(self, member: LoyaltyMember) -> list[ReferralInvite]:
        """Return referral invites for the provided member ordered by recency."""

        stmt = (
            select(ReferralInvite)
            .where(ReferralInvite.referrer_id == member.id)
            .order_by(ReferralInvite.created_at.desc())
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def list_member_ledger_entries(
        self,
        member: LoyaltyMember,
        *,
        limit: int = 25,
        cursor: Tuple[datetime, UUID] | None = None,
        entry_types: Sequence[LoyaltyLedgerEntryType] | None = None,
    ) -> tuple[list[LoyaltyLedgerEntry], Tuple[datetime, UUID] | None]:
        """Return a paginated slice of ledger entries for a member."""

        bounded_limit = max(1, min(limit, 100))
        stmt = (
            select(LoyaltyLedgerEntry)
            .where(LoyaltyLedgerEntry.member_id == member.id)
            .order_by(LoyaltyLedgerEntry.occurred_at.desc(), LoyaltyLedgerEntry.id.desc())
        )
        if entry_types:
            stmt = stmt.where(LoyaltyLedgerEntry.entry_type.in_(list(entry_types)))
        if cursor:
            cursor_time, cursor_id = cursor
            stmt = stmt.where(
                or_(
                    LoyaltyLedgerEntry.occurred_at < cursor_time,
                    and_(
                        LoyaltyLedgerEntry.occurred_at == cursor_time,
                        LoyaltyLedgerEntry.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.limit(bounded_limit + 1)
        result = await self._db.execute(stmt)
        rows = list(result.scalars().all())
        has_more = len(rows) > bounded_limit
        entries = rows[:bounded_limit]
        next_cursor: Tuple[datetime, UUID] | None = None
        if has_more and entries:
            tail = entries[-1]
            next_cursor = (tail.occurred_at, tail.id)

        return entries, next_cursor

    async def list_member_redemptions(
        self,
        member: LoyaltyMember,
        *,
        limit: int = 25,
        cursor: Tuple[datetime, UUID] | None = None,
        statuses: Sequence[LoyaltyRedemptionStatus] | None = None,
    ) -> tuple[list[LoyaltyRedemption], Tuple[datetime, UUID] | None]:
        """Return redemption records for a member ordered by requested time."""

        bounded_limit = max(1, min(limit, 100))
        stmt = (
            select(LoyaltyRedemption)
            .where(LoyaltyRedemption.member_id == member.id)
            .order_by(LoyaltyRedemption.requested_at.desc(), LoyaltyRedemption.id.desc())
        )
        if statuses:
            stmt = stmt.where(LoyaltyRedemption.status.in_(list(statuses)))
        if cursor:
            cursor_time, cursor_id = cursor
            stmt = stmt.where(
                or_(
                    LoyaltyRedemption.requested_at < cursor_time,
                    and_(
                        LoyaltyRedemption.requested_at == cursor_time,
                        LoyaltyRedemption.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.limit(bounded_limit + 1)
        result = await self._db.execute(stmt)
        rows = list(result.scalars().all())
        has_more = len(rows) > bounded_limit
        redemptions = rows[:bounded_limit]
        next_cursor: Tuple[datetime, UUID] | None = None
        if has_more and redemptions:
            tail = redemptions[-1]
            next_cursor = (tail.requested_at, tail.id)

        return redemptions, next_cursor

    async def count_member_redemptions(
        self,
        member: LoyaltyMember,
        *,
        statuses: Sequence[LoyaltyRedemptionStatus] | None = None,
    ) -> int:
        """Count redemptions for a member filtered by status."""

        stmt = select(func.count(LoyaltyRedemption.id)).where(
            LoyaltyRedemption.member_id == member.id
        )
        if statuses:
            stmt = stmt.where(LoyaltyRedemption.status.in_(list(statuses)))
        result = await self._db.execute(stmt)
        return int(result.scalar_one() or 0)

    async def list_member_referral_conversions(
        self,
        member: LoyaltyMember,
        *,
        limit: int = 25,
        cursor: Tuple[datetime, UUID] | None = None,
        statuses: Sequence[ReferralStatus] | None = None,
    ) -> tuple[list[ReferralInvite], Tuple[datetime, UUID] | None]:
        """Return referral invites filtered by lifecycle for dashboards."""

        bounded_limit = max(1, min(limit, 100))
        stmt = (
            select(ReferralInvite)
            .where(ReferralInvite.referrer_id == member.id)
            .order_by(ReferralInvite.created_at.desc(), ReferralInvite.id.desc())
        )
        if statuses:
            stmt = stmt.where(ReferralInvite.status.in_(list(statuses)))
        if cursor:
            cursor_time, cursor_id = cursor
            stmt = stmt.where(
                or_(
                    ReferralInvite.created_at < cursor_time,
                    and_(
                        ReferralInvite.created_at == cursor_time,
                        ReferralInvite.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.limit(bounded_limit + 1)
        result = await self._db.execute(stmt)
        rows = list(result.scalars().all())
        has_more = len(rows) > bounded_limit
        invites = rows[:bounded_limit]
        next_cursor: Tuple[datetime, UUID] | None = None
        if has_more and invites:
            tail = invites[-1]
            next_cursor = (tail.created_at, tail.id)

        return invites, next_cursor

    async def referral_conversion_summary(self, member: LoyaltyMember) -> dict[str, Any]:
        """Aggregate referral conversion counts and earned rewards."""

        stmt = (
            select(
                ReferralInvite.status,
                func.count(ReferralInvite.id),
                func.sum(ReferralInvite.reward_points),
                func.max(ReferralInvite.updated_at),
            )
            .where(ReferralInvite.referrer_id == member.id)
            .group_by(ReferralInvite.status)
        )
        result = await self._db.execute(stmt)
        status_counts: dict[str, int] = {}
        converted_points = Decimal("0")
        last_activity: datetime | None = None
        for status, count, reward_sum, updated_at in result.all():
            status_counts[status.value if isinstance(status, ReferralStatus) else status] = int(count or 0)
            if status == ReferralStatus.CONVERTED:
                converted_points = Decimal(reward_sum or 0)
            if updated_at and (last_activity is None or updated_at > last_activity):
                last_activity = updated_at

        return {
            "status_counts": status_counts,
            "converted_points": converted_points,
            "last_activity": last_activity,
        }

    async def list_member_nudges(
        self,
        member: LoyaltyMember,
        *,
        now: datetime | None = None,
    ) -> list[LoyaltyNudgeCard]:
        """Return active loyalty nudges for a member."""

        await self._sync_member_nudges(member, now=now)

        stmt = (
            select(LoyaltyNudge)
            .where(
                LoyaltyNudge.member_id == member.id,
                LoyaltyNudge.status == LoyaltyNudgeStatus.ACTIVE,
            )
            .order_by(LoyaltyNudge.priority.desc(), LoyaltyNudge.created_at.asc())
        )
        result = await self._db.execute(stmt)
        nudges = list(result.scalars().all())

        cards: list[LoyaltyNudgeCard] = []
        for nudge in nudges:
            payload = dict(nudge.payload_json or {})
            metadata = payload.get("metadata") or {}
            headline = str(payload.get("headline") or "")
            body = str(payload.get("body") or "")
            cta_label = payload.get("ctaLabel")
            cta_href = payload.get("ctaHref")
            channels = self._normalize_channels(nudge.channel_preferences)
            cards.append(
                LoyaltyNudgeCard(
                    id=nudge.id,
                    nudge_type=nudge.nudge_type,
                    headline=headline,
                    body=body,
                    cta_label=cta_label,
                    cta_href=cta_href,
                    expires_at=nudge.expires_at,
                    priority=nudge.priority or 0,
                    metadata=metadata,
                    campaign_slug=nudge.campaign_slug,
                    channels=channels,
                )
            )

        cards.sort(
            key=lambda card: (
                -(card.priority or 0),
                card.expires_at or datetime.max.replace(tzinfo=timezone.utc),
                str(card.id),
            )
        )
        return cards

    async def update_member_nudge_status(
        self,
        member: LoyaltyMember,
        nudge_id: UUID,
        *,
        status: LoyaltyNudgeStatus,
        now: datetime | None = None,
    ) -> LoyaltyNudge | None:
        """Update a nudge lifecycle state for a member."""

        stmt = select(LoyaltyNudge).where(
            LoyaltyNudge.id == nudge_id,
            LoyaltyNudge.member_id == member.id,
        )
        result = await self._db.execute(stmt)
        nudge = result.scalar_one_or_none()
        if nudge is None:
            return None

        timestamp = now or datetime.now(timezone.utc)

        if status == LoyaltyNudgeStatus.ACKNOWLEDGED:
            nudge.status = LoyaltyNudgeStatus.ACKNOWLEDGED
            nudge.acknowledged_at = timestamp
        elif status == LoyaltyNudgeStatus.DISMISSED:
            nudge.status = LoyaltyNudgeStatus.DISMISSED
            nudge.dismissed_at = timestamp
        elif status == LoyaltyNudgeStatus.ACTIVE:
            nudge.status = LoyaltyNudgeStatus.ACTIVE
            nudge.dismissed_at = None
            nudge.acknowledged_at = None
        else:
            nudge.status = status

        await self._db.flush()
        return nudge

    async def aggregate_nudge_candidates(
        self,
        *,
        limit: int = 250,
        now: datetime | None = None,
    ) -> dict[UUID, list[LoyaltyNudgeCard]]:
        """Aggregate nudges for members with actionable signals."""

        now = now or datetime.now(timezone.utc)
        candidate_member_ids: set[UUID] = set()

        expiring_stmt = (
            select(LoyaltyPointExpiration.member_id)
            .where(
                LoyaltyPointExpiration.expires_at <= now + NUDGE_EXPIRING_POINTS_WINDOW,
                LoyaltyPointExpiration.expires_at >= now,
                LoyaltyPointExpiration.status == LoyaltyPointExpirationStatus.SCHEDULED,
            )
            .limit(limit)
        )
        expiring_result = await self._db.execute(expiring_stmt)
        candidate_member_ids.update(expiring_result.scalars().all())

        intent_stmt = (
            select(LoyaltyCheckoutIntent.member_id)
            .where(
                LoyaltyCheckoutIntent.status == LoyaltyCheckoutIntentStatus.PENDING,
            )
            .limit(limit)
        )
        intent_result = await self._db.execute(intent_stmt)
        candidate_member_ids.update(intent_result.scalars().all())

        stalled_stmt = (
            select(LoyaltyRedemption.member_id)
            .where(
                LoyaltyRedemption.status == LoyaltyRedemptionStatus.REQUESTED,
                LoyaltyRedemption.requested_at <= now - NUDGE_REDEMPTION_STALLED_WINDOW,
            )
            .limit(limit)
        )
        stalled_result = await self._db.execute(stalled_stmt)
        candidate_member_ids.update(stalled_result.scalars().all())

        if not candidate_member_ids:
            return {}

        stmt = select(LoyaltyMember).where(LoyaltyMember.id.in_(list(candidate_member_ids)))
        result = await self._db.execute(stmt)
        members = list(result.scalars().all())

        aggregated: dict[UUID, list[LoyaltyNudgeCard]] = {}
        for member_row in members:
            cards = await self.list_member_nudges(member_row, now=now)
            if cards:
                aggregated[member_row.id] = cards

        return aggregated

    async def collect_nudge_dispatch_batch(
        self,
        *,
        limit: int = 100,
        now: datetime | None = None,
    ) -> list[LoyaltyNudgeDispatchCandidate]:
        """Return nudges ready for outbound notifications."""

        now = now or datetime.now(timezone.utc)
        campaigns = await self._get_campaigns()
        stmt = (
            select(LoyaltyNudge)
            .options(selectinload(LoyaltyNudge.member))
            .where(
                LoyaltyNudge.status == LoyaltyNudgeStatus.ACTIVE,
                or_(LoyaltyNudge.expires_at.is_(None), LoyaltyNudge.expires_at > now),
            )
            .order_by(LoyaltyNudge.priority.desc(), LoyaltyNudge.updated_at.desc())
            .limit(limit * 3)
        )
        result = await self._db.execute(stmt)
        candidates: list[LoyaltyNudgeDispatchCandidate] = []
        for nudge in result.scalars().all():
            campaign = self._resolve_campaign(
                nudge.campaign_slug, campaigns, fallback_priority=nudge.priority or 0
            )
            cutoff = now - campaign.frequency_cap
            if nudge.last_triggered_at and nudge.last_triggered_at > cutoff:
                continue
            channels = self._normalize_channels(nudge.channel_preferences)
            candidates.append(LoyaltyNudgeDispatchCandidate(nudge=nudge, channels=channels))
            if len(candidates) >= limit:
                break

        return candidates

    async def mark_nudges_triggered(
        self,
        nudges: Sequence[LoyaltyNudgeDispatchCandidate],
        *,
        now: datetime | None = None,
    ) -> None:
        """Record the latest trigger time for dispatched nudges."""

        timestamp = now or datetime.now(timezone.utc)
        for candidate in nudges:
            candidate.nudge.last_triggered_at = timestamp
            for channel in candidate.channels:
                event = LoyaltyNudgeDispatchEvent(
                    nudge_id=candidate.nudge.id,
                    channel=channel,
                    sent_at=timestamp,
                    metadata_json={"campaign": candidate.nudge.campaign_slug},
                )
                self._db.add(event)
        await self._db.flush()

    async def _sync_member_nudges(
        self,
        member: LoyaltyMember,
        *,
        now: datetime | None = None,
    ) -> None:
        """Ensure persisted nudges reflect current loyalty signals."""

        current_time = now or datetime.now(timezone.utc)
        campaigns = await self._get_campaigns()
        signals = await self._build_nudge_signals(member, campaigns, now=current_time)

        stmt = select(LoyaltyNudge).where(LoyaltyNudge.member_id == member.id)
        result = await self._db.execute(stmt)
        existing = list(result.scalars().all())
        existing_by_key = {
            (nudge.nudge_type, nudge.source_id): nudge for nudge in existing
        }

        seen_keys: set[tuple[LoyaltyNudgeType, str]] = set()
        for signal in signals:
            key = (signal.nudge_type, signal.source_id)
            seen_keys.add(key)
            payload = signal.payload
            campaign = campaigns.get(signal.campaign_slug or "")
            if campaign is None:
                campaign = NudgeCampaignConfig(
                    slug=signal.campaign_slug or "default",
                    ttl=timedelta(days=1),
                    frequency_cap=timedelta(hours=12),
                    default_priority=signal.priority,
                    channels=[LoyaltyNudgeChannel.EMAIL],
                )
            channels = signal.channels or campaign.channels
            priority = signal.priority if signal.priority else campaign.default_priority
            expires_at = signal.expires_at or current_time + campaign.ttl

            nudge = existing_by_key.get(key)
            if nudge is None:
                nudge = LoyaltyNudge(
                    member_id=member.id,
                    nudge_type=signal.nudge_type,
                    source_id=signal.source_id,
                    payload_json=payload,
                    priority=priority,
                    expires_at=expires_at,
                    campaign_slug=campaign.slug,
                    channel_preferences=channels,
                )
                self._db.add(nudge)
                existing_by_key[key] = nudge
                continue

            if nudge.status != LoyaltyNudgeStatus.DISMISSED:
                nudge.status = LoyaltyNudgeStatus.ACTIVE
                nudge.payload_json = payload
                nudge.priority = priority
                nudge.expires_at = expires_at
                nudge.campaign_slug = campaign.slug
                nudge.channel_preferences = channels

        for nudge in existing:
            key = (nudge.nudge_type, nudge.source_id)
            if key in seen_keys:
                continue
            if nudge.status not in {LoyaltyNudgeStatus.DISMISSED, LoyaltyNudgeStatus.EXPIRED}:
                nudge.status = LoyaltyNudgeStatus.EXPIRED
                nudge.expires_at = nudge.expires_at or current_time

        await self._db.flush()

    async def _build_nudge_signals(
        self,
        member: LoyaltyMember,
        campaigns: dict[str, NudgeCampaignConfig],
        *,
        now: datetime,
    ) -> list[_NudgeSignal]:
        """Inspect loyalty signals and produce nudge candidates."""

        signals: list[_NudgeSignal] = []

        exp_stmt = (
            select(LoyaltyPointExpiration)
            .where(
                LoyaltyPointExpiration.member_id == member.id,
                LoyaltyPointExpiration.status == LoyaltyPointExpirationStatus.SCHEDULED,
                LoyaltyPointExpiration.expires_at >= now,
                LoyaltyPointExpiration.expires_at <= now + NUDGE_EXPIRING_POINTS_WINDOW,
            )
            .order_by(LoyaltyPointExpiration.expires_at.asc())
        )
        exp_result = await self._db.execute(exp_stmt)
        exp_campaign = self._resolve_campaign("expiring_points", campaigns, fallback_priority=20)
        for expiration in exp_result.scalars().all():
            points = Decimal(expiration.points or 0)
            consumed = Decimal(expiration.consumed_points or 0)
            remaining = points - consumed
            if remaining <= 0:
                continue

            headline = "Points expiring soon"
            body = (
                f"{int(remaining)} points will expire on {expiration.expires_at.date().isoformat()}."
            )
            payload = {
                "headline": headline,
                "body": body,
                "ctaLabel": "Redeem rewards",
                "ctaHref": "/account/loyalty",
                "metadata": {
                    "pointsRemaining": float(remaining),
                    "expirationId": str(expiration.id),
                    "expiresAt": expiration.expires_at.isoformat(),
                },
            }
            signals.append(
                _NudgeSignal(
                    nudge_type=LoyaltyNudgeType.EXPIRING_POINTS,
                    source_id=str(expiration.id),
                    payload=payload,
                    expires_at=expiration.expires_at,
                    priority=exp_campaign.default_priority,
                    campaign_slug=exp_campaign.slug,
                    channels=exp_campaign.channels,
                )
            )

        intent_stmt = (
            select(LoyaltyCheckoutIntent)
            .where(
                LoyaltyCheckoutIntent.member_id == member.id,
                LoyaltyCheckoutIntent.status == LoyaltyCheckoutIntentStatus.PENDING,
                or_(
                    LoyaltyCheckoutIntent.expires_at.is_(None),
                    LoyaltyCheckoutIntent.expires_at >= now,
                ),
            )
            .order_by(LoyaltyCheckoutIntent.created_at.desc())
        )
        intent_result = await self._db.execute(intent_stmt)
        checkout_campaign = self._resolve_campaign("checkout_recovery", campaigns, fallback_priority=10)
        for intent in intent_result.scalars().all():
            metadata = intent.metadata_json or {}
            reward_name = metadata.get("rewardName") or metadata.get("reward_slug")
            channel = intent.channel or "checkout"
            headline = "Complete your redemption"
            if reward_name:
                body = f"Finish redeeming {reward_name} to secure your reward."
            else:
                body = "You have a pending checkout intent awaiting completion."

            payload = {
                "headline": headline,
                "body": body,
                "ctaLabel": "Resume checkout",
                "ctaHref": "/checkout",
                "metadata": {
                    "intentId": str(intent.id),
                    "channel": channel,
                    "expiresAt": intent.expires_at.isoformat() if intent.expires_at else None,
                },
            }
            signals.append(
                _NudgeSignal(
                    nudge_type=LoyaltyNudgeType.CHECKOUT_REMINDER,
                    source_id=str(intent.id),
                    payload=payload,
                    expires_at=intent.expires_at,
                    priority=checkout_campaign.default_priority,
                    campaign_slug=checkout_campaign.slug,
                    channels=checkout_campaign.channels,
                )
            )

        redemption_stmt = (
            select(LoyaltyRedemption)
            .options(selectinload(LoyaltyRedemption.reward))
            .where(
                LoyaltyRedemption.member_id == member.id,
                LoyaltyRedemption.status == LoyaltyRedemptionStatus.REQUESTED,
                LoyaltyRedemption.requested_at <= now - NUDGE_REDEMPTION_STALLED_WINDOW,
            )
            .order_by(LoyaltyRedemption.requested_at.asc())
        )
        redemption_result = await self._db.execute(redemption_stmt)
        redemption_campaign = self._resolve_campaign(
            "redemption_follow_up", campaigns, fallback_priority=5
        )
        for redemption in redemption_result.scalars().all():
            reward_name = redemption.reward.name if redemption.reward else None
            headline = "We’re reviewing your redemption"
            requested_at = redemption.requested_at
            if requested_at and requested_at.tzinfo is None:
                requested_at = requested_at.replace(tzinfo=timezone.utc)
            age_days = max((now - requested_at).days, 1) if requested_at else 1
            if reward_name:
                body = (
                    f"Your request for {reward_name} has been pending for {age_days} day(s)."
                )
            else:
                body = f"A redemption request has been pending for {age_days} day(s)."

            payload = {
                "headline": headline,
                "body": body,
                "ctaLabel": "Contact support",
                "ctaHref": "/support",
                "metadata": {
                    "redemptionId": str(redemption.id),
                    "requestedAt": redemption.requested_at.isoformat(),
                },
            }
            signals.append(
                _NudgeSignal(
                    nudge_type=LoyaltyNudgeType.REDEMPTION_FOLLOW_UP,
                    source_id=str(redemption.id),
                    payload=payload,
                    expires_at=redemption.requested_at + timedelta(days=14),
                    priority=redemption_campaign.default_priority,
                    campaign_slug=redemption_campaign.slug,
                    channels=redemption_campaign.channels,
                )
            )

        return signals

    async def count_open_referrals(self, member: LoyaltyMember) -> int:
        """Count active (draft or sent) referrals for abuse controls."""

        stmt = (
            select(func.count(ReferralInvite.id))
            .where(ReferralInvite.referrer_id == member.id)
            .where(ReferralInvite.status.in_([ReferralStatus.DRAFT, ReferralStatus.SENT]))
        )
        result = await self._db.execute(stmt)
        return int(result.scalar_one() or 0)

    async def latest_referral(self, member: LoyaltyMember) -> ReferralInvite | None:
        """Fetch the most recent referral invite for cooldown calculations."""

        stmt = (
            select(ReferralInvite)
            .where(ReferralInvite.referrer_id == member.id)
            .order_by(ReferralInvite.created_at.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_referral_for_member(
        self, member: LoyaltyMember, referral_id: UUID
    ) -> ReferralInvite | None:
        """Retrieve a referral invite ensuring it belongs to the member."""

        stmt = (
            select(ReferralInvite)
            .where(ReferralInvite.id == referral_id)
            .where(ReferralInvite.referrer_id == member.id)
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def cancel_referral(
        self,
        referral: ReferralInvite,
        *,
        reason: str | None = None,
    ) -> ReferralInvite:
        """Cancel an active referral invite."""

        if referral.status in {ReferralStatus.CONVERTED, ReferralStatus.CANCELLED}:
            return referral

        referral.status = ReferralStatus.CANCELLED
        metadata = referral.metadata_json or {}
        if reason:
            metadata = {**metadata, "cancel_reason": reason}
        referral.metadata_json = metadata
        await self._db.flush()
        logger.info("Cancelled referral invite", referral_id=str(referral.id))
        return referral

    async def complete_referral(
        self,
        code: str,
        *,
        invitee_user: User,
    ) -> Optional[ReferralInvite]:
        """Mark a referral invite as converted and credit rewards."""

        stmt = (
            select(ReferralInvite)
            .options(selectinload(ReferralInvite.referrer).selectinload(LoyaltyMember.current_tier))
            .where(ReferralInvite.code == code)
        )
        result = await self._db.execute(stmt)
        referral = result.scalar_one_or_none()
        if referral is None:
            logger.warning("Referral code not found", code=code)
            return None

        if referral.status == ReferralStatus.CONVERTED:
            logger.info("Referral already converted", code=code)
            return referral

        referral.status = ReferralStatus.CONVERTED
        referral.invitee_user_id = invitee_user.id
        referral.completed_at = datetime.now(timezone.utc)

        member = referral.referrer
        if member is None:
            logger.error("Referral missing referrer", code=code)
            return referral

        await self.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.REFERRAL_BONUS,
            amount=referral.reward_points,
            description="Referral conversion bonus",
            metadata={"referral_code": code, "invitee": invitee_user.email},
        )

        await self._db.flush()
        logger.info("Referral converted", code=code, member_id=str(member.id))
        return referral

    async def fetch_guardrail_snapshot(self) -> LoyaltyGuardrailSnapshot:
        """Aggregate guardrail posture for operator consoles."""

        invite_quota = int(settings.referral_member_max_active_invites)
        active_statuses = [ReferralStatus.DRAFT, ReferralStatus.SENT]

        active_invites_result = await self._db.execute(
            select(func.count(ReferralInvite.id)).where(
                ReferralInvite.status.in_(active_statuses)
            )
        )
        total_active_invites = int(active_invites_result.scalar_one() or 0)

        members_at_quota = 0
        if invite_quota > 0:
            members_at_quota_result = await self._db.execute(
                select(func.count())
                .select_from(
                    select(
                        ReferralInvite.referrer_id,
                        func.count(ReferralInvite.id).label("invite_count"),
                    )
                    .where(ReferralInvite.status.in_(active_statuses))
                    .group_by(ReferralInvite.referrer_id)
                    .having(func.count(ReferralInvite.id) >= invite_quota)
                    .subquery()
                )
            )
            members_at_quota = int(members_at_quota_result.scalar_one() or 0)

        cooldown_seconds = int(settings.referral_member_invite_cooldown_seconds)
        cooldown_remaining_seconds: int | None = None
        cooldown_until: datetime | None = None
        latest_invite_result = await self._db.execute(
            select(ReferralInvite.created_at)
            .where(ReferralInvite.status.in_(active_statuses))
            .order_by(ReferralInvite.created_at.desc())
            .limit(1)
        )
        latest_created_at: datetime | None = latest_invite_result.scalar_one_or_none()
        if latest_created_at and cooldown_seconds > 0:
            if latest_created_at.tzinfo is None:
                latest_created_at = latest_created_at.replace(tzinfo=timezone.utc)
            cooldown_until_candidate = latest_created_at + timedelta(seconds=cooldown_seconds)
            now = datetime.now(timezone.utc)
            if cooldown_until_candidate > now:
                cooldown_until = cooldown_until_candidate
                cooldown_remaining_seconds = int((cooldown_until_candidate - now).total_seconds())

        overrides_result = await self._db.execute(
            select(LoyaltyGuardrailOverride)
            .where(LoyaltyGuardrailOverride.is_active.is_(True))
            .order_by(LoyaltyGuardrailOverride.created_at.desc())
        )
        overrides = [
            self._serialize_guardrail_override(record)
            for record in overrides_result.scalars().all()
        ]

        throttle_override_active = any(
            override.scope == LoyaltyGuardrailOverrideScope.GLOBAL_THROTTLE
            for override in overrides
        )

        return LoyaltyGuardrailSnapshot(
            invite_quota=invite_quota,
            total_active_invites=total_active_invites,
            members_at_quota=members_at_quota,
            cooldown_seconds=cooldown_seconds,
            cooldown_remaining_seconds=cooldown_remaining_seconds,
            cooldown_until=cooldown_until,
            throttle_override_active=throttle_override_active,
            overrides=overrides,
        )

    async def create_guardrail_override(
        self,
        *,
        scope: LoyaltyGuardrailOverrideScope,
        justification: str,
        actor_user_id: UUID | None = None,
        target_member_id: UUID | None = None,
        expires_at: datetime | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyGuardrailOverride:
        """Persist a guardrail override and append audit history."""

        metadata = metadata or {}
        now = datetime.now(timezone.utc)

        actor: User | None = None
        if actor_user_id:
            actor = await self._db.get(User, actor_user_id)
            if actor is None:
                raise ValueError("Actor user does not exist for guardrail override")

        target_member: LoyaltyMember | None = None
        if target_member_id:
            target_member = await self._db.get(LoyaltyMember, target_member_id)
            if target_member is None:
                raise ValueError("Target loyalty member not found for override")

        existing_overrides_result = await self._db.execute(
            select(LoyaltyGuardrailOverride)
            .where(LoyaltyGuardrailOverride.scope == scope)
            .where(LoyaltyGuardrailOverride.is_active.is_(True))
        )
        for record in existing_overrides_result.scalars().all():
            record.is_active = False
            record.revoked_at = now
            self._db.add(
                LoyaltyGuardrailAuditEvent(
                    override_id=record.id,
                    action=LoyaltyGuardrailAuditAction.REVOKED,
                    message="Superseded by a new override",
                    actor_user_id=actor_user_id,
                )
            )

        override = LoyaltyGuardrailOverride(
            scope=scope,
            justification=justification,
            metadata_json=metadata or None,
            target_member_id=target_member.id if target_member else None,
            created_by_user_id=actor.id if actor else None,
            expires_at=expires_at,
        )
        self._db.add(override)
        await self._db.flush()

        self._db.add(
            LoyaltyGuardrailAuditEvent(
                override_id=override.id,
                action=LoyaltyGuardrailAuditAction.CREATED,
                message=justification,
                actor_user_id=actor.id if actor else None,
            )
        )

        await self._db.flush()
        logger.info(
            "Created loyalty guardrail override",
            override_id=str(override.id),
            scope=scope.value,
        )
        return override

    def _serialize_guardrail_override(
        self, record: LoyaltyGuardrailOverride
    ) -> LoyaltyGuardrailOverrideRecord:
        """Convert ORM override to console-friendly dataclass."""

        return LoyaltyGuardrailOverrideRecord(
            id=record.id,
            scope=record.scope,
            justification=record.justification,
            metadata=record.metadata_json or {},
            target_member_id=record.target_member_id,
            created_by_user_id=record.created_by_user_id,
            created_at=record.created_at,
            expires_at=record.expires_at,
            revoked_at=record.revoked_at,
            is_active=bool(record.is_active),
        )

    async def create_redemption(
        self,
        member: LoyaltyMember,
        *,
        reward_slug: str | None = None,
        points_cost: Decimal | None = None,
        quantity: int = 1,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyRedemption:
        """Reserve points and create a redemption request."""

        metadata = metadata or {}
        if quantity <= 0:
            raise ValueError("Quantity must be positive")

        reward: LoyaltyReward | None = None
        if reward_slug:
            reward = await self.get_reward(reward_slug)
            if reward is None or not reward.is_active:
                raise ValueError("Reward is not available")
            total_cost = Decimal(reward.cost_points or 0) * Decimal(quantity)
        elif points_cost is not None:
            total_cost = Decimal(points_cost)
        else:
            raise ValueError("Must provide reward slug or points cost")

        if total_cost <= Decimal("0"):
            raise ValueError("Redemption cost must be positive")

        self._reserve_points(member, total_cost)

        redemption = LoyaltyRedemption(
            member_id=member.id,
            reward_id=reward.id if reward else None,
            points_cost=total_cost,
            quantity=quantity,
            metadata_json=metadata,
        )
        self._db.add(redemption)
        await self._db.flush()
        logger.info(
            "Created loyalty redemption",
            redemption_id=str(redemption.id),
            member_id=str(member.id),
            points=str(total_cost),
        )
        return redemption

    async def apply_checkout_intents(
        self,
        member: LoyaltyMember,
        *,
        order_id: str,
        intents: Sequence[dict[str, Any]],
        action: Literal["confirm", "cancel"],
    ) -> list[LoyaltyCheckoutIntent]:
        """Persist checkout intents and reconcile redemption metadata."""

        if not intents:
            return []

        redemption_intents = [
            intent for intent in intents if intent.get("kind") == LoyaltyCheckoutIntentKind.REDEMPTION.value
        ]
        referral_intents = [
            intent for intent in intents if intent.get("kind") == LoyaltyCheckoutIntentKind.REFERRAL_SHARE.value
        ]

        processed: list[LoyaltyCheckoutIntent] = []

        if action == "cancel":
            redemption_mapping = await self._cancel_checkout_redemptions(
                member,
                order_id=order_id,
                intents=redemption_intents,
            )
            for intent in redemption_intents:
                checkout_id = str(intent.get("id"))
                record = await self._persist_checkout_intent(
                    member,
                    external_id=checkout_id,
                    kind=LoyaltyCheckoutIntentKind.REDEMPTION,
                    status=LoyaltyCheckoutIntentStatus.CANCELLED,
                    order_id=order_id,
                    channel=self._resolve_intent_channel(intent),
                    expires_at=None,
                    metadata=self._extract_intent_metadata(intent),
                    redemption=redemption_mapping.get(checkout_id),
                    referral_code=None,
                )
                processed.append(record)

            for intent in referral_intents:
                checkout_id = str(intent.get("id"))
                record = await self._persist_checkout_intent(
                    member,
                    external_id=checkout_id,
                    kind=LoyaltyCheckoutIntentKind.REFERRAL_SHARE,
                    status=LoyaltyCheckoutIntentStatus.CANCELLED,
                    order_id=order_id,
                    channel=self._resolve_intent_channel(intent),
                    expires_at=None,
                    metadata=self._extract_intent_metadata(intent),
                    referral_code=self._resolve_intent_referral_code(intent),
                )
                processed.append(record)

            return processed

        redemption_mapping = await self._confirm_checkout_redemptions(
            member,
            order_id=order_id,
            intents=redemption_intents,
        )

        for intent in redemption_intents:
            checkout_id = str(intent.get("id"))
            redemption = redemption_mapping.get(checkout_id)
            if not redemption:
                continue

            record = await self._persist_checkout_intent(
                member,
                external_id=checkout_id,
                kind=LoyaltyCheckoutIntentKind.REDEMPTION,
                status=LoyaltyCheckoutIntentStatus.PENDING,
                order_id=order_id,
                channel=self._resolve_intent_channel(intent) or "checkout",
                expires_at=self._resolve_intent_expiration(intent),
                metadata=self._extract_intent_metadata(intent),
                redemption=redemption,
                referral_code=None,
            )
            processed.append(record)

        for intent in referral_intents:
            checkout_id = str(intent.get("id"))
            record = await self._persist_checkout_intent(
                member,
                external_id=checkout_id,
                kind=LoyaltyCheckoutIntentKind.REFERRAL_SHARE,
                status=LoyaltyCheckoutIntentStatus.PENDING,
                order_id=order_id,
                channel=self._resolve_intent_channel(intent),
                expires_at=self._resolve_intent_expiration(intent),
                metadata=self._extract_intent_metadata(intent),
                referral_code=self._resolve_intent_referral_code(intent),
            )
            processed.append(record)

        return processed

    async def _cancel_checkout_redemptions(
        self,
        member: LoyaltyMember,
        *,
        order_id: str,
        intents: Sequence[dict[str, Any]],
    ) -> dict[str, LoyaltyRedemption]:
        if not intents:
            return {}

        checkout_ids = [str(intent.get("id")) for intent in intents if intent.get("id")]
        existing_by_intent = await self._load_checkout_redemptions(member, checkout_ids)

        for intent in intents:
            checkout_id = str(intent.get("id"))
            redemption = existing_by_intent.get(checkout_id)
            if not redemption:
                continue

            metadata: dict[str, Any] = {"checkout_intent_id": checkout_id, "order_id": order_id}
            metadata.update(intent.get("metadata") or {})
            metadata.setdefault(
                "checkout_channel",
                (redemption.metadata_json or {}).get("checkout_channel", "checkout"),
            )
            metadata.setdefault("cancellationReason", "checkout_intent_cancelled")
            await self.cancel_redemption(
                redemption,
                reason="checkout_intent_cancelled",
                metadata=metadata,
            )

        return existing_by_intent

    async def _confirm_checkout_redemptions(
        self,
        member: LoyaltyMember,
        *,
        order_id: str,
        intents: Sequence[dict[str, Any]],
    ) -> dict[str, LoyaltyRedemption]:
        if not intents:
            return {}

        checkout_ids = [str(intent.get("id")) for intent in intents if intent.get("id")]
        existing_by_intent = await self._load_checkout_redemptions(member, checkout_ids)

        for intent in intents:
            checkout_id = str(intent.get("id"))
            metadata: dict[str, Any] = {
                "checkout_intent_id": checkout_id,
                "order_id": order_id,
                "checkout_channel": intent.get("channel") or "checkout",
            }
            metadata.update(intent.get("metadata") or {})

            existing = existing_by_intent.get(checkout_id)
            if existing:
                existing_metadata = dict(existing.metadata_json or {})
                existing_metadata.update(metadata)
                existing.metadata_json = existing_metadata
                await self._db.flush()
                continue

            quantity = int(intent.get("quantity") or 1)
            reward_slug = intent.get("rewardSlug")
            points_cost_value = intent.get("pointsCost")
            points_cost = (
                Decimal(str(points_cost_value)) if points_cost_value is not None else None
            )

            try:
                redemption = await self.create_redemption(
                    member,
                    reward_slug=reward_slug,
                    points_cost=points_cost,
                    quantity=quantity,
                    metadata=metadata,
                )
            except ValueError as error:
                logger.warning(
                    "Failed to apply checkout redemption intent",
                    checkout_intent_id=checkout_id,
                    reason=str(error),
                )
                continue

            existing_by_intent[checkout_id] = redemption

        return existing_by_intent

    async def _load_checkout_redemptions(
        self,
        member: LoyaltyMember,
        checkout_ids: Sequence[str],
    ) -> dict[str, LoyaltyRedemption]:
        if not checkout_ids:
            return {}

        stmt = (
            select(LoyaltyRedemption)
            .options(selectinload(LoyaltyRedemption.member))
            .where(
                LoyaltyRedemption.member_id == member.id,
                LoyaltyRedemption.metadata_json.isnot(None),
            )
        )
        result = await self._db.execute(stmt)
        existing_by_intent: dict[str, LoyaltyRedemption] = {}
        for redemption in result.scalars().all():
            metadata = redemption.metadata_json or {}
            checkout_intent_id = metadata.get("checkout_intent_id")
            if checkout_intent_id and checkout_intent_id in checkout_ids:
                existing_by_intent[checkout_intent_id] = redemption
        return existing_by_intent

    async def _persist_checkout_intent(
        self,
        member: LoyaltyMember,
        *,
        external_id: str,
        kind: LoyaltyCheckoutIntentKind,
        status: LoyaltyCheckoutIntentStatus,
        order_id: str | None,
        channel: str | None,
        expires_at: datetime | None,
        metadata: dict[str, Any] | None,
        redemption: LoyaltyRedemption | None = None,
        referral_code: str | None = None,
    ) -> LoyaltyCheckoutIntent:
        stmt = (
            select(LoyaltyCheckoutIntent)
            .options(selectinload(LoyaltyCheckoutIntent.redemption))
            .where(
                LoyaltyCheckoutIntent.member_id == member.id,
                LoyaltyCheckoutIntent.external_id == external_id,
            )
        )
        result = await self._db.execute(stmt)
        record = result.scalar_one_or_none()

        if record is None:
            record = LoyaltyCheckoutIntent(
                member_id=member.id,
                external_id=external_id,
                kind=kind,
            )
            self._db.add(record)

        if order_id:
            record.order_id = order_id
        if channel:
            record.channel = channel
        if redemption:
            record.redemption = redemption
        if referral_code:
            record.referral_code = referral_code

        if expires_at:
            record.expires_at = expires_at

        existing_metadata = dict(record.metadata_json or {})
        if metadata:
            normalized_update = self._normalize_metadata(metadata)
            existing_metadata.update(normalized_update)
        record.metadata_json = existing_metadata or None

        record.status = status
        if status in {
            LoyaltyCheckoutIntentStatus.CANCELLED,
            LoyaltyCheckoutIntentStatus.RESOLVED,
            LoyaltyCheckoutIntentStatus.EXPIRED,
        }:
            record.resolved_at = datetime.now(timezone.utc)
        elif status == LoyaltyCheckoutIntentStatus.PENDING:
            record.resolved_at = None

        await self._db.flush()
        return record

    def _resolve_intent_channel(self, intent: dict[str, Any]) -> str | None:
        channel = intent.get("channel")
        if channel:
            return str(channel)
        metadata = intent.get("metadata") or {}
        channel_meta = metadata.get("checkout_channel")
        return str(channel_meta) if channel_meta else None

    def _resolve_intent_referral_code(self, intent: dict[str, Any]) -> str | None:
        referral_code = intent.get("referralCode")
        if referral_code:
            return str(referral_code)
        metadata = intent.get("metadata") or {}
        fallback = metadata.get("referralCode") or metadata.get("referral_code")
        return str(fallback) if fallback else None

    def _resolve_intent_expiration(self, intent: dict[str, Any]) -> datetime | None:
        expires_at = intent.get("expiresAt")
        if expires_at:
            parsed = self._parse_datetime(expires_at)
            if parsed:
                return parsed

        metadata = intent.get("metadata") or {}
        metadata_expires = metadata.get("expiresAt")
        if metadata_expires:
            parsed_metadata = self._parse_datetime(metadata_expires)
            if parsed_metadata:
                return parsed_metadata

        ttl_seconds = metadata.get("ttlSeconds")
        if isinstance(ttl_seconds, (int, float)):
            return datetime.now(timezone.utc) + timedelta(seconds=int(ttl_seconds))

        return datetime.now(timezone.utc) + CHECKOUT_INTENT_DEFAULT_TTL

    def _extract_intent_metadata(self, intent: dict[str, Any]) -> dict[str, Any]:
        metadata = dict(intent.get("metadata") or {})
        for key in (
            "rewardSlug",
            "rewardName",
            "pointsCost",
            "quantity",
            "referralCode",
            "createdAt",
        ):
            value = intent.get(key)
            if value is not None and key not in metadata:
                metadata[key] = value
        return self._normalize_metadata(metadata)

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value
        if isinstance(value, str):
            try:
                sanitized = value.replace("Z", "+00:00")
                parsed = datetime.fromisoformat(sanitized)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        return None

    def _normalize_metadata(self, data: dict[str, Any]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        for key, value in data.items():
            normalized[key] = self._normalize_metadata_value(value)
        return normalized

    def _normalize_metadata_value(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
        if isinstance(value, dict):
            return {k: self._normalize_metadata_value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [self._normalize_metadata_value(item) for item in value]
        return value

    async def list_checkout_next_actions(
        self,
        member: LoyaltyMember,
        *,
        include_resolved: bool = False,
    ) -> list[LoyaltyCheckoutIntent]:
        """Return checkout intents eligible for next action surfaces."""

        now_utc = datetime.now(timezone.utc)
        stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member.id,
        )
        if not include_resolved:
            stmt = stmt.where(
                LoyaltyCheckoutIntent.status == LoyaltyCheckoutIntentStatus.PENDING,
                or_(
                    LoyaltyCheckoutIntent.expires_at.is_(None),
                    LoyaltyCheckoutIntent.expires_at > now_utc,
                ),
            )

        stmt = stmt.order_by(LoyaltyCheckoutIntent.created_at.asc())
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def resolve_checkout_intent(
        self,
        member: LoyaltyMember,
        intent_id: UUID,
        *,
        status: LoyaltyCheckoutIntentStatus = LoyaltyCheckoutIntentStatus.RESOLVED,
    ) -> LoyaltyCheckoutIntent | None:
        """Mark a checkout intent as resolved for the member."""

        stmt = select(LoyaltyCheckoutIntent).where(
            LoyaltyCheckoutIntent.member_id == member.id,
            LoyaltyCheckoutIntent.id == intent_id,
        )
        result = await self._db.execute(stmt)
        record = result.scalar_one_or_none()
        if record is None:
            return None

        record.status = status
        record.resolved_at = datetime.now(timezone.utc)
        await self._db.flush()
        return record

    async def fulfill_redemption(
        self,
        redemption: LoyaltyRedemption,
        *,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyRedemption:
        """Finalize a redemption and deduct the held balance."""

        if redemption.status != LoyaltyRedemptionStatus.REQUESTED:
            logger.info(
                "Redemption already resolved",
                redemption_id=str(redemption.id),
                status=redemption.status.value,
            )
            return redemption

        member = redemption.member
        if member is None:
            stmt = (
                select(LoyaltyRedemption)
                .options(selectinload(LoyaltyRedemption.member))
                .where(LoyaltyRedemption.id == redemption.id)
            )
            result = await self._db.execute(stmt)
            redemption = result.scalar_one()
            member = redemption.member

        total_cost = Decimal(redemption.points_cost or 0)
        self._release_points(member, total_cost)
        await self._consume_expiring_points(member, total_cost)

        entry_metadata = {"redemption_id": str(redemption.id)}
        if redemption.reward_id:
            entry_metadata["reward_id"] = str(redemption.reward_id)
        if metadata:
            entry_metadata.update(metadata)

        await self.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.REDEEM,
            amount=total_cost * Decimal("-1"),
            description=description or "Loyalty reward redemption",
            metadata=entry_metadata,
        )

        redemption.status = LoyaltyRedemptionStatus.FULFILLED
        redemption.fulfilled_at = datetime.now(timezone.utc)
        existing_metadata = dict(redemption.metadata_json or {})
        existing_metadata.update(metadata or {})
        redemption.metadata_json = existing_metadata
        await self._db.flush()
        logger.info(
            "Fulfilled loyalty redemption",
            redemption_id=str(redemption.id),
            member_id=str(member.id),
        )
        return redemption

    async def fail_redemption(
        self,
        redemption: LoyaltyRedemption,
        *,
        reason: str,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyRedemption:
        """Mark a redemption as failed and release the hold."""

        if redemption.status != LoyaltyRedemptionStatus.REQUESTED:
            return redemption

        member = redemption.member
        if member is None:
            stmt = (
                select(LoyaltyRedemption)
                .options(selectinload(LoyaltyRedemption.member))
                .where(LoyaltyRedemption.id == redemption.id)
            )
            result = await self._db.execute(stmt)
            redemption = result.scalar_one()
            member = redemption.member

        self._release_points(member, Decimal(redemption.points_cost or 0))
        redemption.status = LoyaltyRedemptionStatus.FAILED
        redemption.failure_reason = reason
        redemption.cancelled_at = datetime.now(timezone.utc)
        existing_metadata = dict(redemption.metadata_json or {})
        if metadata:
            existing_metadata.update(metadata)
        redemption.metadata_json = existing_metadata
        await self._db.flush()
        logger.warning(
            "Redemption failed",
            redemption_id=str(redemption.id),
            reason=reason,
        )
        return redemption

    async def cancel_redemption(
        self,
        redemption: LoyaltyRedemption,
        *,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyRedemption:
        """Cancel a redemption and release held points."""

        if redemption.status != LoyaltyRedemptionStatus.REQUESTED:
            return redemption

        member = redemption.member
        if member is None:
            stmt = (
                select(LoyaltyRedemption)
                .options(selectinload(LoyaltyRedemption.member))
                .where(LoyaltyRedemption.id == redemption.id)
            )
            result = await self._db.execute(stmt)
            redemption = result.scalar_one()
            member = redemption.member

        self._release_points(member, Decimal(redemption.points_cost or 0))
        redemption.status = LoyaltyRedemptionStatus.CANCELLED
        redemption.cancelled_at = datetime.now(timezone.utc)
        existing_metadata = dict(redemption.metadata_json or {})
        if metadata:
            existing_metadata.update(metadata)
        if reason:
            existing_metadata.setdefault("cancellationReason", reason)
        redemption.metadata_json = existing_metadata
        await self._db.flush()
        logger.info(
            "Cancelled loyalty redemption",
            redemption_id=str(redemption.id),
            reason=reason,
        )
        return redemption

    async def schedule_point_expiration(
        self,
        member: LoyaltyMember,
        *,
        points: Decimal,
        expires_at: datetime,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyPointExpiration:
        if points <= Decimal("0"):
            raise ValueError("Expiration amount must be positive")
        return await self._create_point_expiration(
            member,
            points=points,
            expires_at=expires_at,
            metadata=metadata or {},
        )

    async def expire_scheduled_points(
        self,
        *,
        reference_time: datetime | None = None,
    ) -> list[LoyaltyPointExpiration]:
        """Expire scheduled balances up to the provided timestamp."""

        horizon = reference_time or datetime.now(timezone.utc)
        stmt = (
            select(LoyaltyPointExpiration)
            .options(selectinload(LoyaltyPointExpiration.member))
            .where(
                LoyaltyPointExpiration.status == LoyaltyPointExpirationStatus.SCHEDULED,
                LoyaltyPointExpiration.expires_at <= horizon,
            )
            .order_by(LoyaltyPointExpiration.expires_at.asc())
        )
        result = await self._db.execute(stmt)
        expired_records: list[LoyaltyPointExpiration] = []
        for record in result.scalars().all():
            member = record.member
            if member is None:
                logger.warning("Expiration missing member", expiration_id=str(record.id))
                continue

            remaining = max(Decimal(record.points or 0) - Decimal(record.consumed_points or 0), Decimal("0"))
            if remaining > Decimal("0"):
                expire_amount = min(remaining, Decimal(member.points_balance or 0))
                if expire_amount > Decimal("0"):
                    metadata = {"expiration_id": str(record.id)}
                    try:
                        await self.record_ledger_entry(
                            member,
                            entry_type=LoyaltyLedgerEntryType.ADJUSTMENT,
                            amount=expire_amount * Decimal("-1"),
                            description="Loyalty points expiration",
                            metadata=metadata,
                        )
                    except ValueError as exc:
                        logger.warning(
                            "Unable to record expiration adjustment",
                            expiration_id=str(record.id),
                            error=str(exc),
                        )
                leftover = remaining - expire_amount
                if leftover > Decimal("0"):
                    logger.warning(
                        "Expiration left unadjusted balance",
                        expiration_id=str(record.id),
                        remaining=str(leftover),
                    )
                record.consumed_points = min(record.points, record.consumed_points + expire_amount)

            record.status = LoyaltyPointExpirationStatus.EXPIRED
            expired_records.append(record)

        await self._db.flush()
        return expired_records

    async def snapshot_member(self, member: LoyaltyMember) -> LoyaltySnapshot:
        """Return a serializable snapshot of a loyalty member."""

        tiers = await self.list_active_tiers()
        current_tier = member.current_tier
        if current_tier is None and tiers:
            current_tier = next((tier for tier in tiers if tier.id == member.current_tier_id), None)

        next_tier = None
        if current_tier:
            for tier in tiers:
                if tier.point_threshold > current_tier.point_threshold:
                    next_tier = tier
                    break
        elif tiers:
            next_tier = tiers[0]

        lifetime_points = Decimal(member.lifetime_points or 0)
        current_threshold = Decimal(current_tier.point_threshold or 0) if current_tier else Decimal("0")
        if next_tier:
            next_threshold = Decimal(next_tier.point_threshold or 0)
            denominator = max(next_threshold - current_threshold, Decimal("1"))
            progress = (lifetime_points - current_threshold) / denominator
            progress = max(Decimal("0"), min(progress, Decimal("1")))
        else:
            progress = Decimal("1") if tiers else Decimal("0")

        points_balance = Decimal(member.points_balance or 0)
        points_on_hold = Decimal(member.points_on_hold or 0)
        available_points = max(points_balance - points_on_hold, Decimal("0"))
        expiring = await self._list_expiration_windows(member)

        return LoyaltySnapshot(
            member_id=member.id,
            user_id=member.user_id,
            current_tier=current_tier.slug if current_tier else None,
            points_balance=points_balance,
            points_on_hold=points_on_hold,
            available_points=available_points,
            lifetime_points=lifetime_points,
            progress_to_next_tier=progress,
            next_tier=next_tier.slug if next_tier else None,
            upcoming_benefits=list(next_tier.benefits or []) if next_tier else [],
            referral_code=member.referral_code,
            expiring_points=expiring,
        )

    async def _assign_initial_tier(self, member: LoyaltyMember) -> None:
        tiers = await self.list_active_tiers()
        if not tiers:
            return
        lowest = tiers[0]
        member.current_tier_id = lowest.id
        member.last_tier_upgrade_at = datetime.now(timezone.utc)

    async def _maybe_upgrade_tier(self, member: LoyaltyMember) -> None:
        tiers = await self.list_active_tiers()
        if not tiers:
            return
        eligible = [
            tier for tier in tiers if tier.point_threshold <= (member.lifetime_points or Decimal("0"))
        ]
        if not eligible:
            return
        target = eligible[-1]
        if member.current_tier_id == target.id:
            return
        member.current_tier_id = target.id
        member.last_tier_upgrade_at = datetime.now(timezone.utc)
        logger.info("Upgraded loyalty tier", member_id=str(member.id), tier_slug=target.slug)
        await self._notifications.send_loyalty_tier_upgrade(member, target)

    async def _generate_unique_referral_code(self) -> str:
        candidate = uuid4().hex[:8].upper()
        stmt = select(LoyaltyMember).where(LoyaltyMember.referral_code == candidate)
        result = await self._db.execute(stmt)
        exists = result.scalar_one_or_none()
        if exists:
            return await self._generate_unique_referral_code()
        stmt_ref = select(ReferralInvite).where(ReferralInvite.code == candidate)
        result_ref = await self._db.execute(stmt_ref)
        if result_ref.scalar_one_or_none():
            return await self._generate_unique_referral_code()
        return candidate

    def _available_points(self, member: LoyaltyMember) -> Decimal:
        """Return spendable points (balance minus holds)."""

        return max(
            Decimal(member.points_balance or 0) - Decimal(member.points_on_hold or 0),
            Decimal("0"),
        )

    def _reserve_points(self, member: LoyaltyMember, amount: Decimal) -> None:
        if amount <= Decimal("0"):
            raise ValueError("Reserve amount must be positive")
        available = self._available_points(member)
        if available < amount:
            raise ValueError("Insufficient available points for reservation")
        member.points_on_hold = Decimal(member.points_on_hold or 0) + amount

    def _release_points(self, member: LoyaltyMember, amount: Decimal) -> None:
        if amount <= Decimal("0"):
            return
        current_hold = Decimal(member.points_on_hold or 0)
        member.points_on_hold = max(current_hold - amount, Decimal("0"))

    async def _consume_expiring_points(self, member: LoyaltyMember, amount: Decimal) -> None:
        remaining = Decimal(amount)
        if remaining <= Decimal("0"):
            return

        stmt = (
            select(LoyaltyPointExpiration)
            .where(LoyaltyPointExpiration.member_id == member.id)
            .order_by(LoyaltyPointExpiration.expires_at.asc())
        )
        result = await self._db.execute(stmt)
        for record in result.scalars().all():
            available = Decimal(record.points or 0) - Decimal(record.consumed_points or 0)
            if available <= Decimal("0"):
                if record.status == LoyaltyPointExpirationStatus.SCHEDULED:
                    record.status = LoyaltyPointExpirationStatus.CONSUMED
                continue
            consume = min(available, remaining)
            record.consumed_points = Decimal(record.consumed_points or 0) + consume
            if record.consumed_points >= record.points:
                record.status = LoyaltyPointExpirationStatus.CONSUMED
            remaining -= consume
            if remaining <= Decimal("0"):
                break

    async def _create_point_expiration(
        self,
        member: LoyaltyMember,
        *,
        points: Decimal,
        expires_at: datetime,
        metadata: dict[str, Any] | None = None,
    ) -> LoyaltyPointExpiration:
        record = LoyaltyPointExpiration(
            member_id=member.id,
            points=points,
            expires_at=expires_at,
            metadata_json=metadata or {},
        )
        self._db.add(record)
        await self._db.flush()
        logger.debug(
            "Scheduled loyalty expiration",
            member_id=str(member.id),
            points=str(points),
            expires_at=expires_at.isoformat(),
        )
        return record

    async def _list_expiration_windows(self, member: LoyaltyMember, limit: int = 5) -> list[PointsExpirationWindow]:
        stmt = (
            select(LoyaltyPointExpiration)
            .where(LoyaltyPointExpiration.member_id == member.id)
            .order_by(LoyaltyPointExpiration.expires_at.asc())
            .limit(limit)
        )
        result = await self._db.execute(stmt)
        windows: list[PointsExpirationWindow] = []
        for record in result.scalars().all():
            total_points = Decimal(record.points or 0)
            consumed = Decimal(record.consumed_points or 0)
            windows.append(
                PointsExpirationWindow(
                    expires_at=record.expires_at,
                    total_points=total_points,
                    remaining_points=max(total_points - consumed, Decimal("0")),
                    status=record.status,
                )
            )
        return windows


def encode_time_uuid_cursor(timestamp: datetime, identifier: UUID) -> str:
    """Encode pagination cursor for chronological queries."""

    payload = f"{timestamp.isoformat()}|{identifier}".encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("utf-8")


def decode_time_uuid_cursor(cursor: str) -> Tuple[datetime, UUID]:
    """Decode pagination cursor into datetime and UUID parts."""

    raw = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
    timestamp_str, identifier_str = raw.split("|", 1)
    return datetime.fromisoformat(timestamp_str), UUID(identifier_str)

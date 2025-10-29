"""Service layer for loyalty tiers and referral issuance."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.loyalty import (
    LoyaltyLedgerEntry,
    LoyaltyLedgerEntryType,
    LoyaltyMember,
    LoyaltyTier,
    ReferralInvite,
    ReferralStatus,
)
from smplat_api.models.user import User
from smplat_api.services.notifications import NotificationService


@dataclass
class LoyaltySnapshot:
    """Serializable loyalty overview for clients."""

    member_id: UUID
    user_id: UUID
    current_tier: Optional[str]
    points_balance: Decimal
    lifetime_points: Decimal
    referral_code: Optional[str]


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
    ) -> LoyaltyLedgerEntry:
        """Record a loyalty ledger entry and update balances."""

        if amount == Decimal("0"):
            raise ValueError("Ledger entries require a non-zero amount")

        ledger_entry = LoyaltyLedgerEntry(
            member_id=member.id,
            entry_type=entry_type,
            amount=amount,
            description=description,
            metadata_json=metadata or {},
        )
        self._db.add(ledger_entry)

        balance_delta = amount
        member.points_balance = (member.points_balance or Decimal("0")) + balance_delta
        if entry_type in {LoyaltyLedgerEntryType.EARN, LoyaltyLedgerEntryType.REFERRAL_BONUS, LoyaltyLedgerEntryType.TIER_BONUS}:
            member.lifetime_points = (member.lifetime_points or Decimal("0")) + amount

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
    ) -> ReferralInvite:
        """Create a referral invite for a member."""

        code = await self._generate_unique_referral_code()
        referral = ReferralInvite(
            referrer_id=member.id,
            code=code,
            invitee_email=invitee_email,
            reward_points=reward_points,
            metadata_json=metadata or {},
        )
        self._db.add(referral)
        await self._db.flush()
        logger.info("Issued referral invite", code=code, member_id=str(member.id))
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

    async def snapshot_member(self, member: LoyaltyMember) -> LoyaltySnapshot:
        """Return a serializable snapshot of a loyalty member."""

        return LoyaltySnapshot(
            member_id=member.id,
            user_id=member.user_id,
            current_tier=member.current_tier.slug if member.current_tier else None,
            points_balance=Decimal(member.points_balance or 0),
            lifetime_points=Decimal(member.lifetime_points or 0),
            referral_code=member.referral_code,
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

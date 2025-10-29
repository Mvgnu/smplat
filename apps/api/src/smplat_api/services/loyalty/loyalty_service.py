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
        existing_metadata = redemption.metadata_json or {}
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
        existing_metadata = redemption.metadata_json or {}
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
        existing_metadata = redemption.metadata_json or {}
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

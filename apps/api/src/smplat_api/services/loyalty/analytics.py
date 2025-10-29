"""Predictive loyalty segmentation and velocity analytics service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.loyalty import (
    LoyaltyAnalyticsSnapshot,
    LoyaltyLedgerEntry,
    LoyaltyLedgerEntryType,
    LoyaltyMember,
    ReferralInvite,
    ReferralStatus,
)


@dataclass(slots=True)
class LoyaltySegmentSummary:
    """Aggregated metrics for a loyalty engagement segment."""

    slug: str
    label: str
    member_count: int
    average_invites_per_member: float
    average_conversions_per_member: float
    average_points_earned_per_member: float


@dataclass(slots=True)
class LoyaltyVelocityMetrics:
    """Platform-wide loyalty velocity statistics for a window."""

    window_days: int
    total_invites: int
    total_conversions: int
    total_points_earned: float
    invites_per_member: float
    conversions_per_member: float
    points_per_member: float


@dataclass(slots=True)
class LoyaltyAnalyticsComputation:
    """Snapshot of loyalty engagement segmentation and velocities."""

    computed_at: datetime
    window_days: int
    segments: list[LoyaltySegmentSummary]
    velocity: LoyaltyVelocityMetrics


class LoyaltyAnalyticsService:
    """Compute predictive loyalty engagement segments and trend velocity."""

    # meta: service: loyalty-analytics

    def __init__(self, db: AsyncSession, *, window_days: int = 30) -> None:
        self._db = db
        self._window_days = window_days

    async def compute_snapshot(self) -> LoyaltyAnalyticsComputation:
        """Compute the latest loyalty engagement analytics snapshot."""

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=self._window_days)
        stalled_cutoff = now - timedelta(days=90)
        active_cutoff = now - timedelta(days=self._window_days)

        member_ids = await self._fetch_member_ids()
        if not member_ids:
            empty_segment = LoyaltySegmentSummary(
                slug="inactive",
                label="No members",
                member_count=0,
                average_invites_per_member=0.0,
                average_conversions_per_member=0.0,
                average_points_earned_per_member=0.0,
            )
            velocity = LoyaltyVelocityMetrics(
                window_days=self._window_days,
                total_invites=0,
                total_conversions=0,
                total_points_earned=0.0,
                invites_per_member=0.0,
                conversions_per_member=0.0,
                points_per_member=0.0,
            )
            return LoyaltyAnalyticsComputation(
                computed_at=now,
                window_days=self._window_days,
                segments=[empty_segment],
                velocity=velocity,
            )

        last_activity = await self._fetch_last_activity(member_ids)
        invite_counts = await self._count_invites(member_ids, window_start)
        conversion_counts = await self._count_conversions(member_ids, window_start)
        earned_points = await self._sum_points(member_ids, window_start)

        segment_definitions: Dict[str, Dict[str, object]] = {
            "active": {"label": "Active champions", "members": []},
            "stalled": {"label": "Stalled patrons", "members": []},
            "at-risk": {"label": "At-risk members", "members": []},
        }

        for member_id in member_ids:
            latest_activity = last_activity.get(member_id)
            if latest_activity and latest_activity >= active_cutoff:
                segment_key = "active"
            elif latest_activity and latest_activity >= stalled_cutoff:
                segment_key = "stalled"
            else:
                segment_key = "at-risk"
            segment_definitions[segment_key]["members"].append(member_id)

        segments: list[LoyaltySegmentSummary] = []
        total_invites = 0
        total_conversions = 0
        total_points = Decimal("0")

        for slug, definition in segment_definitions.items():
            members: list[UUID] = definition["members"]  # type: ignore[assignment]
            member_count = len(members)
            segment_invites = sum(invite_counts.get(member_id, 0) for member_id in members)
            segment_conversions = sum(
                conversion_counts.get(member_id, 0) for member_id in members
            )
            segment_points = sum(earned_points.get(member_id, Decimal("0")) for member_id in members)

            total_invites += segment_invites
            total_conversions += segment_conversions
            total_points += segment_points

            segments.append(
                LoyaltySegmentSummary(
                    slug=slug,
                    label=definition["label"],
                    member_count=member_count,
                    average_invites_per_member=
                        float(segment_invites / member_count) if member_count else 0.0,
                    average_conversions_per_member=
                        float(segment_conversions / member_count) if member_count else 0.0,
                    average_points_earned_per_member=
                        float(segment_points / member_count) if member_count else 0.0,
                )
            )

        member_total = len(member_ids)
        velocity = LoyaltyVelocityMetrics(
            window_days=self._window_days,
            total_invites=total_invites,
            total_conversions=total_conversions,
            total_points_earned=float(total_points),
            invites_per_member=float(total_invites / member_total) if member_total else 0.0,
            conversions_per_member=float(total_conversions / member_total)
            if member_total
            else 0.0,
            points_per_member=float(total_points / Decimal(member_total)) if member_total else 0.0,
        )

        return LoyaltyAnalyticsComputation(
            computed_at=now,
            window_days=self._window_days,
            segments=segments,
            velocity=velocity,
        )

    async def persist_snapshot(self) -> LoyaltyAnalyticsSnapshot:
        """Compute and persist the latest snapshot."""

        snapshot = await self.compute_snapshot()
        record = LoyaltyAnalyticsSnapshot(
            computed_at=snapshot.computed_at,
            segments_json=[
                {
                    "slug": segment.slug,
                    "label": segment.label,
                    "memberCount": segment.member_count,
                    "averageInvitesPerMember": segment.average_invites_per_member,
                    "averageConversionsPerMember": segment.average_conversions_per_member,
                    "averagePointsEarnedPerMember": segment.average_points_earned_per_member,
                }
                for segment in snapshot.segments
            ],
            velocity_json={
                "windowDays": snapshot.velocity.window_days,
                "totalInvites": snapshot.velocity.total_invites,
                "totalConversions": snapshot.velocity.total_conversions,
                "totalPointsEarned": snapshot.velocity.total_points_earned,
                "invitesPerMember": snapshot.velocity.invites_per_member,
                "conversionsPerMember": snapshot.velocity.conversions_per_member,
                "pointsPerMember": snapshot.velocity.points_per_member,
            },
        )
        self._db.add(record)
        await self._db.flush()
        return record

    async def list_snapshots(
        self,
        *,
        limit: int = 14,
        before: datetime | None = None,
    ) -> Sequence[LoyaltyAnalyticsSnapshot]:
        """List persisted snapshots ordered by most recent."""

        stmt = select(LoyaltyAnalyticsSnapshot).order_by(
            LoyaltyAnalyticsSnapshot.computed_at.desc()
        )
        if before is not None:
            stmt = stmt.where(LoyaltyAnalyticsSnapshot.computed_at < before)
        stmt = stmt.limit(limit)
        result = await self._db.execute(stmt)
        return result.scalars().all()

    async def _fetch_member_ids(self) -> List[UUID]:
        stmt = select(LoyaltyMember.id)
        result = await self._db.execute(stmt)
        return [row[0] for row in result.all()]

    async def _fetch_last_activity(self, member_ids: Iterable[UUID]) -> Dict[UUID, datetime | None]:
        last_activity: Dict[UUID, datetime | None] = {member_id: None for member_id in member_ids}

        ledger_stmt = (
            select(
                LoyaltyLedgerEntry.member_id,
                func.max(LoyaltyLedgerEntry.occurred_at).label("last_event"),
            )
            .where(LoyaltyLedgerEntry.member_id.in_(list(member_ids)))
            .group_by(LoyaltyLedgerEntry.member_id)
        )
        ledger_result = await self._db.execute(ledger_stmt)
        for member_id, occurred_at in ledger_result.all():
            if occurred_at is None:
                continue
            last_activity[member_id] = self._normalize_datetime(
                last_activity.get(member_id), occurred_at
            )

        referral_stmt = (
            select(
                ReferralInvite.referrer_id,
                func.max(ReferralInvite.created_at).label("last_invite"),
            )
            .where(ReferralInvite.referrer_id.in_(list(member_ids)))
            .group_by(ReferralInvite.referrer_id)
        )
        referral_result = await self._db.execute(referral_stmt)
        for member_id, created_at in referral_result.all():
            if created_at is None:
                continue
            last_activity[member_id] = self._normalize_datetime(
                last_activity.get(member_id), created_at
            )

        conversion_stmt = (
            select(
                ReferralInvite.referrer_id,
                func.max(ReferralInvite.completed_at).label("last_conversion"),
            )
            .where(ReferralInvite.referrer_id.in_(list(member_ids)))
            .where(ReferralInvite.status == ReferralStatus.CONVERTED)
            .group_by(ReferralInvite.referrer_id)
        )
        conversion_result = await self._db.execute(conversion_stmt)
        for member_id, completed_at in conversion_result.all():
            if completed_at is None:
                continue
            last_activity[member_id] = self._normalize_datetime(
                last_activity.get(member_id), completed_at
            )

        return last_activity

    async def _count_invites(
        self, member_ids: Iterable[UUID], window_start: datetime
    ) -> Dict[UUID, int]:
        stmt = (
            select(ReferralInvite.referrer_id, func.count())
            .where(ReferralInvite.referrer_id.in_(list(member_ids)))
            .where(ReferralInvite.created_at >= window_start)
            .group_by(ReferralInvite.referrer_id)
        )
        result = await self._db.execute(stmt)
        return {member_id: count for member_id, count in result.all()}

    async def _count_conversions(
        self, member_ids: Iterable[UUID], window_start: datetime
    ) -> Dict[UUID, int]:
        stmt = (
            select(ReferralInvite.referrer_id, func.count())
            .where(ReferralInvite.referrer_id.in_(list(member_ids)))
            .where(ReferralInvite.status == ReferralStatus.CONVERTED)
            .where(ReferralInvite.completed_at.isnot(None))
            .where(ReferralInvite.completed_at >= window_start)
            .group_by(ReferralInvite.referrer_id)
        )
        result = await self._db.execute(stmt)
        return {member_id: count for member_id, count in result.all()}

    async def _sum_points(
        self, member_ids: Iterable[UUID], window_start: datetime
    ) -> Dict[UUID, Decimal]:
        stmt = (
            select(
                LoyaltyLedgerEntry.member_id,
                func.coalesce(func.sum(LoyaltyLedgerEntry.amount), 0),
            )
            .where(LoyaltyLedgerEntry.member_id.in_(list(member_ids)))
            .where(LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.EARN)
            .where(LoyaltyLedgerEntry.occurred_at >= window_start)
            .group_by(LoyaltyLedgerEntry.member_id)
        )
        result = await self._db.execute(stmt)
        return {
            member_id: Decimal(str(total_amount))
            for member_id, total_amount in result.all()
        }

    @staticmethod
    def _normalize_datetime(
        current: datetime | None, candidate: datetime | None
    ) -> datetime | None:
        if candidate is None:
            return current
        if candidate.tzinfo is None:
            candidate = candidate.replace(tzinfo=timezone.utc)
        if current is None:
            return candidate
        return candidate if candidate > current else current


"""Jobs that advance loyalty progression and retention instrumentation."""

# meta: job: loyalty-progression

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Awaitable, Callable, Dict, List

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.loyalty import LoyaltyLedgerEntry, LoyaltyLedgerEntryType, LoyaltyMember
from smplat_api.services.loyalty import LoyaltyService

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]


async def run_loyalty_progression(*, session_factory: SessionFactory) -> Dict[str, Any]:
    """Grant streak bonuses, expire stale balances, and emit analytics events."""

    maybe_session = session_factory()
    session: AsyncSession
    if isinstance(maybe_session, AsyncSession):
        session = maybe_session
    else:
        session = await maybe_session

    async with session as managed_session:
        service = LoyaltyService(managed_session)
        now = dt.datetime.now(dt.timezone.utc)
        bonuses_granted, events = await _grant_streak_bonuses(managed_session, service, now)
        expired = await service.expire_scheduled_points(reference_time=now)
        await managed_session.commit()

        summary = {
            "bonuses_granted": bonuses_granted,
            "expired_points": len(expired),
            "events_emitted": len(events),
        }
        logger.bind(summary=summary, events=events).info("Loyalty progression sweep completed")
        return summary


async def _grant_streak_bonuses(
    session: AsyncSession,
    service: LoyaltyService,
    now: dt.datetime,
) -> tuple[int, List[Dict[str, Any]]]:
    """Award a streak bonus to active members once per rolling window."""

    window_start = now - dt.timedelta(days=7)
    expires_at = now + dt.timedelta(days=180)

    stmt_members = (
        select(LoyaltyMember)
        .options(selectinload(LoyaltyMember.current_tier))
        .where(LoyaltyMember.updated_at >= window_start)
    )
    result = await session.execute(stmt_members)
    members = result.scalars().all()

    bonuses = 0
    events: List[Dict[str, Any]] = []
    for member in members:
        latest_bonus = await _fetch_latest_streak_bonus(session, member)
        if latest_bonus and latest_bonus.created_at and latest_bonus.created_at >= window_start:
            continue

        bonus_amount = Decimal("10")
        metadata = {
            "kind": "streak_bonus",
            "window_start": window_start.isoformat(),
        }
        await service.record_ledger_entry(
            member,
            entry_type=LoyaltyLedgerEntryType.TIER_BONUS,
            amount=bonus_amount,
            description="Weekly loyalty streak bonus",
            metadata=metadata,
            expires_at=expires_at,
        )
        bonuses += 1
        events.append(
            {
                "type": "loyalty.streak_bonus",
                "member_id": str(member.id),
                "amount": float(bonus_amount),
                "window_start": window_start.isoformat(),
            }
        )

    return bonuses, events


async def _fetch_latest_streak_bonus(
    session: AsyncSession,
    member: LoyaltyMember,
) -> LoyaltyLedgerEntry | None:
    stmt = (
        select(LoyaltyLedgerEntry)
        .where(
            LoyaltyLedgerEntry.member_id == member.id,
            LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.TIER_BONUS,
        )
        .order_by(LoyaltyLedgerEntry.created_at.desc())
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


__all__ = ["run_loyalty_progression"]

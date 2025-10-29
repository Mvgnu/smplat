"""API endpoints for loyalty tiers, referrals, and redemptions."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, root_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.api.dependencies.session import require_member_session
from smplat_api.core.settings import settings
from smplat_api.db.session import get_session
from smplat_api.models.loyalty import LoyaltyRedemption, ReferralInvite, ReferralStatus
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService


router = APIRouter(prefix="/loyalty", tags=["loyalty"])


MEMBER_REWARD_POINTS = Decimal(str(settings.referral_member_reward_points))
MAX_ACTIVE_MEMBER_REFERRALS = settings.referral_member_max_active_invites
MEMBER_REFERRAL_COOLDOWN_SECONDS = settings.referral_member_invite_cooldown_seconds


class LoyaltyTierResponse(BaseModel):
    id: UUID
    slug: str
    name: str
    description: Optional[str]
    pointThreshold: float
    benefits: list[Any]
    isActive: bool


class PointsExpirationResponse(BaseModel):
    expiresAt: datetime
    points: float
    remainingPoints: float
    status: str


class LoyaltyMemberResponse(BaseModel):
    id: UUID
    userId: UUID
    currentTier: Optional[str]
    nextTier: Optional[str]
    pointsBalance: float
    pointsOnHold: float
    availablePoints: float
    lifetimePoints: float
    progressToNextTier: float
    referralCode: Optional[str]
    upcomingBenefits: List[Any]
    expiringPoints: List[PointsExpirationResponse]


class ReferralIssueRequest(BaseModel):
    inviteeEmail: Optional[str] = Field(None, description="Email for invitee")
    rewardPoints: float = Field(..., gt=0, description="Points to award upon conversion")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata for the invite")


class ReferralIssueResponse(BaseModel):
    id: UUID
    code: str
    status: str
    rewardPoints: float
    inviteeEmail: Optional[str]
    createdAt: datetime
    expiresAt: Optional[datetime]
    completedAt: Optional[datetime]


class ReferralCreateRequest(BaseModel):
    inviteeEmail: Optional[str] = Field(
        None, description="Optional email address for the invitee"
    )
    metadata: Optional[dict[str, Any]] = Field(
        None, description="Additional metadata to store on the invite"
    )


class ReferralCancelRequest(BaseModel):
    reason: Optional[str] = Field(
        None, description="Reason provided by the member for cancellation"
    )


class ReferralCompleteRequest(BaseModel):
    code: str = Field(..., description="Referral code to mark as converted")
    inviteeUserId: UUID = Field(..., description="User created from the referral")


class LoyaltyRewardResponse(BaseModel):
    id: UUID
    slug: str
    name: str
    description: Optional[str]
    costPoints: float
    isActive: bool


class RedemptionCreateRequest(BaseModel):
    rewardSlug: Optional[str] = Field(None, description="Slug of the reward to redeem")
    pointsCost: Optional[float] = Field(None, gt=0, description="Direct points cost for custom redemption")
    quantity: int = Field(1, gt=0, description="Quantity of the reward")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata for the redemption")

    @root_validator(skip_on_failure=True)
    def validate_reward(cls, values: dict[str, Any]) -> dict[str, Any]:
        if not values.get("rewardSlug") and values.get("pointsCost") is None:
            raise ValueError("rewardSlug or pointsCost must be provided")
        return values


class RedemptionResponse(BaseModel):
    id: UUID
    memberId: UUID
    rewardId: Optional[UUID]
    status: str
    pointsCost: float
    quantity: int
    requestedAt: datetime
    fulfilledAt: Optional[datetime]
    cancelledAt: Optional[datetime]
    failureReason: Optional[str]


class RedemptionFulfillRequest(BaseModel):
    description: Optional[str] = Field(None, description="Override description for the ledger entry")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata to attach to the redemption")


class RedemptionFailureRequest(BaseModel):
    reason: str = Field(..., description="Reason the redemption failed")
    metadata: Optional[dict[str, Any]] = Field(None, description="Metadata to record alongside the failure")


class RedemptionCancelRequest(BaseModel):
    reason: Optional[str] = Field(None, description="Reason for cancelling the redemption")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata to store on the redemption")


@router.get("/tiers", response_model=List[LoyaltyTierResponse])
async def list_loyalty_tiers(
    db: AsyncSession = Depends(get_session),
) -> List[LoyaltyTierResponse]:
    """List active loyalty tiers."""

    service = LoyaltyService(db)
    tiers = await service.list_active_tiers()
    return [
        LoyaltyTierResponse(
            id=tier.id,
            slug=tier.slug,
            name=tier.name,
            description=tier.description,
            pointThreshold=float(tier.point_threshold or 0),
            benefits=list(tier.benefits or []),
            isActive=bool(tier.is_active),
        )
        for tier in tiers
    ]


@router.get("/members/{user_id}", response_model=LoyaltyMemberResponse)
async def get_loyalty_member(
    user_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> LoyaltyMemberResponse:
    """Fetch or create a loyalty member for the provided user."""

    service = LoyaltyService(db)
    member = await service.ensure_member(user_id)
    snapshot = await service.snapshot_member(member)
    return LoyaltyMemberResponse(
        id=snapshot.member_id,
        userId=snapshot.user_id,
        currentTier=snapshot.current_tier,
        nextTier=snapshot.next_tier,
        pointsBalance=float(snapshot.points_balance),
        pointsOnHold=float(snapshot.points_on_hold),
        availablePoints=float(snapshot.available_points),
        lifetimePoints=float(snapshot.lifetime_points),
        progressToNextTier=float(snapshot.progress_to_next_tier),
        referralCode=snapshot.referral_code,
        upcomingBenefits=list(snapshot.upcoming_benefits),
        expiringPoints=[
            PointsExpirationResponse(
                expiresAt=window.expires_at,
                points=float(window.total_points),
                remainingPoints=float(window.remaining_points),
                status=window.status.value,
            )
            for window in snapshot.expiring_points
        ],
    )


@router.get("/referrals", response_model=List[ReferralIssueResponse])
async def list_member_referrals(
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> List[ReferralIssueResponse]:
    """List referral invites for the authenticated member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)
    referrals = await service.list_member_referrals(member)
    return [_serialize_referral(referral) for referral in referrals]


@router.post(
    "/referrals",
    response_model=ReferralIssueResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_member_referral(
    payload: ReferralCreateRequest,
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> ReferralIssueResponse:
    """Create a referral invite for the authenticated member with abuse controls."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    open_count = await service.count_open_referrals(member)
    if open_count >= MAX_ACTIVE_MEMBER_REFERRALS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Referral invite limit reached",
        )

    last_referral = await service.latest_referral(member)
    if (
        last_referral
        and last_referral.created_at
        and (
            datetime.now(timezone.utc) - last_referral.created_at
        ).total_seconds()
        < MEMBER_REFERRAL_COOLDOWN_SECONDS
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before sending another invite",
        )

    reward_points = MEMBER_REWARD_POINTS
    referral = await service.issue_referral(
        member,
        invitee_email=payload.inviteeEmail,
        reward_points=reward_points,
        metadata=payload.metadata,
        status=ReferralStatus.SENT,
    )
    await db.commit()
    await db.refresh(referral)
    return _serialize_referral(referral)


@router.post(
    "/referrals/{referral_id}/cancel",
    response_model=ReferralIssueResponse,
)
async def cancel_member_referral(
    referral_id: UUID,
    payload: ReferralCancelRequest | None = None,
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> ReferralIssueResponse:
    """Cancel a referral invite for the authenticated member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)
    referral = await service.get_referral_for_member(member, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="Referral invite not found")

    referral = await service.cancel_referral(
        referral, reason=payload.reason if payload else None
    )
    await db.commit()
    await db.refresh(referral)
    return _serialize_referral(referral)


@router.post(
    "/members/{user_id}/referrals",
    response_model=ReferralIssueResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_referral_invite(
    user_id: UUID,
    request: ReferralIssueRequest,
    db: AsyncSession = Depends(get_session),
) -> ReferralIssueResponse:
    """Issue a referral invite on behalf of a member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(user_id)
    reward_points = Decimal(str(request.rewardPoints))
    referral = await service.issue_referral(
        member,
        invitee_email=request.inviteeEmail,
        reward_points=reward_points,
        metadata=request.metadata,
    )
    await db.commit()
    await db.refresh(referral)
    return _serialize_referral(referral)


@router.post(
    "/referrals/complete",
    response_model=ReferralIssueResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def complete_referral(
    payload: ReferralCompleteRequest,
    db: AsyncSession = Depends(get_session),
) -> ReferralIssueResponse:
    """Mark a referral as converted and award points."""

    service = LoyaltyService(db)

    stmt = select(User).where(User.id == payload.inviteeUserId)
    result_user = await db.execute(stmt)
    invitee = result_user.scalar_one_or_none()
    if invitee is None:
        raise HTTPException(status_code=404, detail="Invitee user not found")

    await service.ensure_member(payload.inviteeUserId)
    result = await service.complete_referral(payload.code, invitee_user=invitee)
    if result is None:
        raise HTTPException(status_code=404, detail="Referral code not found")
    await db.commit()
    await db.refresh(result)
    return _serialize_referral(result)


@router.get("/rewards", response_model=List[LoyaltyRewardResponse])
async def list_loyalty_rewards(
    db: AsyncSession = Depends(get_session),
) -> List[LoyaltyRewardResponse]:
    """List active loyalty rewards."""

    service = LoyaltyService(db)
    rewards = await service.list_active_rewards()
    return [
        LoyaltyRewardResponse(
            id=reward.id,
            slug=reward.slug,
            name=reward.name,
            description=reward.description,
            costPoints=float(reward.cost_points or 0),
            isActive=bool(reward.is_active),
        )
        for reward in rewards
    ]


def _serialize_referral(referral: ReferralInvite) -> ReferralIssueResponse:
    return ReferralIssueResponse(
        id=referral.id,
        code=referral.code,
        status=referral.status.value,
        rewardPoints=float(referral.reward_points or 0),
        inviteeEmail=referral.invitee_email,
        createdAt=referral.created_at,
        expiresAt=referral.expires_at,
        completedAt=referral.completed_at,
    )


def _serialize_redemption(redemption: LoyaltyRedemption) -> RedemptionResponse:
    return RedemptionResponse(
        id=redemption.id,
        memberId=redemption.member_id,
        rewardId=redemption.reward_id,
        status=redemption.status.value,
        pointsCost=float(redemption.points_cost or 0),
        quantity=redemption.quantity,
        requestedAt=redemption.requested_at,
        fulfilledAt=redemption.fulfilled_at,
        cancelledAt=redemption.cancelled_at,
        failureReason=redemption.failure_reason,
    )


@router.post(
    "/members/{user_id}/redemptions",
    response_model=RedemptionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_loyalty_redemption(
    user_id: UUID,
    request: RedemptionCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> RedemptionResponse:
    """Create a loyalty redemption for a member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(user_id)
    points_cost = Decimal(str(request.pointsCost)) if request.pointsCost is not None else None
    redemption = await service.create_redemption(
        member,
        reward_slug=request.rewardSlug,
        points_cost=points_cost,
        quantity=request.quantity,
        metadata=request.metadata,
    )
    await db.commit()
    await db.refresh(redemption)
    return _serialize_redemption(redemption)


async def _fetch_redemption(db: AsyncSession, redemption_id: UUID) -> LoyaltyRedemption:
    stmt = (
        select(LoyaltyRedemption)
        .options(selectinload(LoyaltyRedemption.member))
        .where(LoyaltyRedemption.id == redemption_id)
    )
    result = await db.execute(stmt)
    redemption = result.scalar_one_or_none()
    if redemption is None:
        raise HTTPException(status_code=404, detail="Redemption not found")
    return redemption


@router.post(
    "/redemptions/{redemption_id}/fulfill",
    response_model=RedemptionResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def fulfill_loyalty_redemption(
    redemption_id: UUID,
    request: RedemptionFulfillRequest,
    db: AsyncSession = Depends(get_session),
) -> RedemptionResponse:
    """Fulfill a pending loyalty redemption."""

    redemption = await _fetch_redemption(db, redemption_id)
    service = LoyaltyService(db)
    redemption = await service.fulfill_redemption(
        redemption,
        description=request.description,
        metadata=request.metadata,
    )
    await db.commit()
    await db.refresh(redemption)
    return _serialize_redemption(redemption)


@router.post(
    "/redemptions/{redemption_id}/fail",
    response_model=RedemptionResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def fail_loyalty_redemption(
    redemption_id: UUID,
    request: RedemptionFailureRequest,
    db: AsyncSession = Depends(get_session),
) -> RedemptionResponse:
    """Fail a pending loyalty redemption."""

    redemption = await _fetch_redemption(db, redemption_id)
    service = LoyaltyService(db)
    redemption = await service.fail_redemption(
        redemption,
        reason=request.reason,
        metadata=request.metadata,
    )
    await db.commit()
    await db.refresh(redemption)
    return _serialize_redemption(redemption)


@router.post(
    "/redemptions/{redemption_id}/cancel",
    response_model=RedemptionResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def cancel_loyalty_redemption(
    redemption_id: UUID,
    request: RedemptionCancelRequest,
    db: AsyncSession = Depends(get_session),
) -> RedemptionResponse:
    """Cancel a pending loyalty redemption."""

    redemption = await _fetch_redemption(db, redemption_id)
    service = LoyaltyService(db)
    redemption = await service.cancel_redemption(
        redemption,
        reason=request.reason,
        metadata=request.metadata,
    )
    await db.commit()
    await db.refresh(redemption)
    return _serialize_redemption(redemption)

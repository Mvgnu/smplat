"""API endpoints for loyalty tiers and referrals."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.user import User
from smplat_api.services.loyalty import LoyaltyService


router = APIRouter(prefix="/loyalty", tags=["loyalty"])


class LoyaltyTierResponse(BaseModel):
    id: UUID
    slug: str
    name: str
    description: Optional[str]
    pointThreshold: float
    benefits: list[Any]
    isActive: bool


class LoyaltyMemberResponse(BaseModel):
    id: UUID
    userId: UUID
    currentTier: Optional[str]
    pointsBalance: float
    lifetimePoints: float
    referralCode: Optional[str]


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


class ReferralCompleteRequest(BaseModel):
    code: str = Field(..., description="Referral code to mark as converted")
    inviteeUserId: UUID = Field(..., description="User created from the referral")


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
        pointsBalance=float(snapshot.points_balance),
        lifetimePoints=float(snapshot.lifetime_points),
        referralCode=snapshot.referral_code,
    )


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
    return ReferralIssueResponse(
        id=referral.id,
        code=referral.code,
        status=referral.status.value,
        rewardPoints=float(referral.reward_points or 0),
        inviteeEmail=referral.invitee_email,
    )


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
    return ReferralIssueResponse(
        id=result.id,
        code=result.code,
        status=result.status.value,
        rewardPoints=float(result.reward_points or 0),
        inviteeEmail=result.invitee_email,
    )

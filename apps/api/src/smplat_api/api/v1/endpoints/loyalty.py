"""API endpoints for loyalty tiers, referrals, and redemptions."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, root_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.api.dependencies.session import require_member_session
from smplat_api.core.settings import settings
from smplat_api.db.session import get_session
from smplat_api.models.loyalty import (
    LoyaltyGuardrailOverrideScope,
    LoyaltyCheckoutIntent,
    LoyaltyCheckoutIntentKind,
    LoyaltyCheckoutIntentStatus,
    LoyaltyLedgerEntry,
    LoyaltyLedgerEntryType,
    LoyaltyNudgeStatus,
    LoyaltyRedemption,
    LoyaltyRedemptionStatus,
    ReferralInvite,
    ReferralStatus,
)
from smplat_api.models.user import User
from smplat_api.services.loyalty import (
    LoyaltyGuardrailOverrideRecord,
    LoyaltyGuardrailSnapshot,
    LoyaltyNudgeCard,
    LoyaltyService,
    decode_time_uuid_cursor,
    encode_time_uuid_cursor,
)


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


class LedgerEntryResponse(BaseModel):
    id: UUID
    occurredAt: datetime
    entryType: str
    amount: float
    description: Optional[str]
    metadata: dict[str, Any] = Field(default_factory=dict)


class LedgerWindowResponse(BaseModel):
    entries: List[LedgerEntryResponse]
    nextCursor: Optional[str]


class RedemptionWindowResponse(BaseModel):
    redemptions: List[RedemptionResponse]
    nextCursor: Optional[str]
    pendingCount: int


class ReferralConversionResponse(BaseModel):
    id: UUID
    code: str
    status: str
    rewardPoints: float
    inviteeEmail: Optional[str]
    createdAt: datetime
    updatedAt: datetime
    completedAt: Optional[datetime]


class ReferralConversionWindowResponse(BaseModel):
    invites: List[ReferralConversionResponse]
    nextCursor: Optional[str]
    statusCounts: dict[str, int]
    convertedPoints: float
    lastActivity: Optional[datetime]


class LoyaltyNudgeCardResponse(BaseModel):
    id: UUID
    nudgeType: str
    headline: str
    body: str
    ctaLabel: Optional[str]
    ctaHref: Optional[str]
    expiresAt: Optional[datetime]
    priority: int


class LoyaltyGuardrailOverrideResponse(BaseModel):
    id: UUID
    scope: str
    justification: str
    metadata: dict[str, Any]
    targetMemberId: Optional[UUID]
    createdByUserId: Optional[UUID]
    createdAt: datetime
    expiresAt: Optional[datetime]
    revokedAt: Optional[datetime]
    isActive: bool

    @classmethod
    def from_record(
        cls, record: LoyaltyGuardrailOverrideRecord
    ) -> "LoyaltyGuardrailOverrideResponse":
        return cls(
            id=record.id,
            scope=record.scope.value,
            justification=record.justification,
            metadata=record.metadata,
            targetMemberId=record.target_member_id,
            createdByUserId=record.created_by_user_id,
            createdAt=record.created_at,
            expiresAt=record.expires_at,
            revokedAt=record.revoked_at,
            isActive=record.is_active,
        )


class LoyaltyGuardrailSnapshotResponse(BaseModel):
    inviteQuota: int
    totalActiveInvites: int
    membersAtQuota: int
    cooldownSeconds: int
    cooldownRemainingSeconds: Optional[int]
    cooldownUntil: Optional[datetime]
    throttleOverrideActive: bool
    overrides: list[LoyaltyGuardrailOverrideResponse]

    @classmethod
    def from_snapshot(
        cls, snapshot: LoyaltyGuardrailSnapshot
    ) -> "LoyaltyGuardrailSnapshotResponse":
        return cls(
            inviteQuota=snapshot.invite_quota,
            totalActiveInvites=snapshot.total_active_invites,
            membersAtQuota=snapshot.members_at_quota,
            cooldownSeconds=snapshot.cooldown_seconds,
            cooldownRemainingSeconds=snapshot.cooldown_remaining_seconds,
            cooldownUntil=snapshot.cooldown_until,
            throttleOverrideActive=snapshot.throttle_override_active,
            overrides=[
                LoyaltyGuardrailOverrideResponse.from_record(record)
                for record in snapshot.overrides
            ],
        )


class LoyaltyGuardrailOverrideCreateRequest(BaseModel):
    scope: LoyaltyGuardrailOverrideScope
    justification: str = Field(..., min_length=3, max_length=500)
    actorUserId: Optional[UUID] = Field(None, description="Operator applying the override")
    targetMemberId: Optional[UUID] = Field(
        None, description="Optional loyalty member impacted by the override"
    )
    expiresAt: Optional[datetime] = Field(
        None, description="Optional expiration timestamp for the override"
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class LoyaltyNudgeFeedResponse(BaseModel):
    nudges: List[LoyaltyNudgeCardResponse]


class RedemptionFulfillRequest(BaseModel):
    description: Optional[str] = Field(None, description="Override description for the ledger entry")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata to attach to the redemption")


class RedemptionFailureRequest(BaseModel):
    reason: str = Field(..., description="Reason the redemption failed")
    metadata: Optional[dict[str, Any]] = Field(None, description="Metadata to record alongside the failure")


class RedemptionCancelRequest(BaseModel):
    reason: Optional[str] = Field(None, description="Reason for cancelling the redemption")
    metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata to store on the redemption")


class CheckoutIntentPayload(BaseModel):
    id: UUID
    kind: Literal["redemption", "referral_share"]
    createdAt: datetime
    rewardSlug: Optional[str] = None
    rewardName: Optional[str] = None
    pointsCost: Optional[float] = None
    quantity: Optional[int] = None
    referralCode: Optional[str] = None
    channel: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class CheckoutIntentSubmissionRequest(BaseModel):
    orderId: str = Field(..., description="Order reference that produced the intent")
    action: Literal["confirm", "cancel"] = Field("confirm", description="Apply or cancel queued intents")
    intents: List[CheckoutIntentPayload]
    userId: UUID

    @root_validator(skip_on_failure=True)
    def validate_intents(cls, values: dict[str, Any]) -> dict[str, Any]:
        intents = values.get("intents")
        if not intents:
            raise ValueError("At least one intent is required")
        return values


class CheckoutIntentResponse(BaseModel):
    id: UUID
    clientIntentId: str
    kind: str
    status: str
    orderId: Optional[str]
    channel: Optional[str]
    createdAt: datetime
    expiresAt: Optional[datetime]
    resolvedAt: Optional[datetime]
    metadata: dict[str, Any] = Field(default_factory=dict)


class LoyaltyNextActionCardResponse(BaseModel):
    id: UUID
    kind: str
    headline: str
    description: str
    ctaLabel: str
    createdAt: datetime
    expiresAt: Optional[datetime]
    metadata: dict[str, Any] = Field(default_factory=dict)


class CheckoutNextActionsResponse(BaseModel):
    intents: List[CheckoutIntentResponse]
    cards: List[LoyaltyNextActionCardResponse]


class CheckoutIntentResolveRequest(BaseModel):
    status: Literal["resolved", "cancelled"] = Field(
        "resolved", description="Mark as resolved (dismissed) or cancelled"
    )


class LoyaltyNudgeStatusRequest(BaseModel):
    status: Literal["active", "acknowledged", "dismissed"] = Field(
        "acknowledged", description="Lifecycle status to persist for the nudge",
    )


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


@router.get("/ledger", response_model=LedgerWindowResponse)
async def list_member_ledger_history(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None, description="Opaque cursor for pagination"),
    types: list[str] | None = Query(None, description="Filter ledger entry types"),
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> LedgerWindowResponse:
    """Return member ledger entries with pagination."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    entry_types: list[LoyaltyLedgerEntryType] | None = None
    if types:
        entry_types = []
        for value in types:
            try:
                entry_types.append(LoyaltyLedgerEntryType(value))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"Unsupported ledger type: {value}") from exc

    decoded_cursor = None
    if cursor:
        try:
            decoded_cursor = decode_time_uuid_cursor(cursor)
        except Exception as exc:  # pragma: no cover - defensive for bad cursors
            raise HTTPException(status_code=400, detail="Invalid ledger cursor") from exc

    entries, next_cursor = await service.list_member_ledger_entries(
        member,
        limit=limit,
        cursor=decoded_cursor,
        entry_types=entry_types,
    )

    return LedgerWindowResponse(
        entries=[_serialize_ledger_entry(entry) for entry in entries],
        nextCursor=encode_time_uuid_cursor(*next_cursor) if next_cursor else None,
    )


@router.get("/redemptions", response_model=RedemptionWindowResponse)
async def list_member_redemption_history(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None, description="Opaque cursor for pagination"),
    statuses: list[str] | None = Query(None, description="Filter redemption statuses"),
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> RedemptionWindowResponse:
    """Return member redemption history with pagination."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    redemption_statuses: list[LoyaltyRedemptionStatus] | None = None
    if statuses:
        redemption_statuses = []
        for value in statuses:
            try:
                redemption_statuses.append(LoyaltyRedemptionStatus(value))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"Unsupported redemption status: {value}") from exc

    decoded_cursor = None
    if cursor:
        try:
            decoded_cursor = decode_time_uuid_cursor(cursor)
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=400, detail="Invalid redemption cursor") from exc

    redemptions, next_cursor = await service.list_member_redemptions(
        member,
        limit=limit,
        cursor=decoded_cursor,
        statuses=redemption_statuses,
    )
    pending_count = await service.count_member_redemptions(
        member, statuses=[LoyaltyRedemptionStatus.REQUESTED]
    )

    return RedemptionWindowResponse(
        redemptions=[_serialize_redemption(redemption) for redemption in redemptions],
        nextCursor=encode_time_uuid_cursor(*next_cursor) if next_cursor else None,
        pendingCount=pending_count,
    )


@router.get("/referrals/conversions", response_model=ReferralConversionWindowResponse)
async def list_member_referral_conversions(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None, description="Opaque cursor for pagination"),
    statuses: list[str] | None = Query(None, description="Filter referral statuses"),
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> ReferralConversionWindowResponse:
    """Return referral conversion invites and aggregates."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    referral_statuses: list[ReferralStatus] | None = None
    if statuses:
        referral_statuses = []
        for value in statuses:
            try:
                referral_statuses.append(ReferralStatus(value))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"Unsupported referral status: {value}") from exc

    decoded_cursor = None
    if cursor:
        try:
            decoded_cursor = decode_time_uuid_cursor(cursor)
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=400, detail="Invalid referral cursor") from exc

    invites, next_cursor = await service.list_member_referral_conversions(
        member,
        limit=limit,
        cursor=decoded_cursor,
        statuses=referral_statuses,
    )
    summary = await service.referral_conversion_summary(member)

    return ReferralConversionWindowResponse(
        invites=[_serialize_referral_conversion(invite) for invite in invites],
        nextCursor=encode_time_uuid_cursor(*next_cursor) if next_cursor else None,
        statusCounts=summary.get("status_counts", {}),
        convertedPoints=float(summary.get("converted_points", Decimal("0"))),
        lastActivity=summary.get("last_activity"),
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


def _serialize_checkout_intent(intent: LoyaltyCheckoutIntent) -> CheckoutIntentResponse:
    metadata = dict(intent.metadata_json or {})
    client_intent_id = metadata.get("checkout_intent_id") or metadata.get("clientIntentId")
    if not client_intent_id:
        client_intent_id = intent.external_id

    if intent.redemption_id and "redemptionId" not in metadata:
        metadata["redemptionId"] = str(intent.redemption_id)
    if intent.referral_code and "referralCode" not in metadata:
        metadata["referralCode"] = intent.referral_code

    metadata["clientIntentId"] = str(client_intent_id)

    return CheckoutIntentResponse(
        id=intent.id,
        clientIntentId=str(client_intent_id),
        kind=intent.kind.value,
        status=intent.status.value,
        orderId=intent.order_id,
        channel=intent.channel,
        createdAt=intent.created_at,
        expiresAt=intent.expires_at,
        resolvedAt=intent.resolved_at,
        metadata=metadata,
    )


def _build_next_action_card(intent: LoyaltyCheckoutIntent) -> LoyaltyNextActionCardResponse:
    metadata = dict(intent.metadata_json or {})
    client_intent_id = metadata.get("clientIntentId") or intent.external_id
    metadata["clientIntentId"] = str(client_intent_id)

    if intent.kind == LoyaltyCheckoutIntentKind.REDEMPTION:
        reward_name = metadata.get("rewardName") or metadata.get("rewardSlug") or "Loyalty reward"
        points_cost = metadata.get("pointsCost")
        points_display = None
        if isinstance(points_cost, (int, float)):
            points_display = f"{int(points_cost):,}"

        description = (
            f"Hold {points_display} points and finish fulfillment in the loyalty hub."
            if points_display
            else "Finalize your planned redemption in the loyalty hub."
        )
        metadata.setdefault("ctaHref", "/account/loyalty#rewards")
        headline = reward_name
        cta_label = "Open rewards"
    else:
        referral_code = metadata.get("referralCode") or intent.referral_code or "your referral"
        description = f"Send a thank-you or check in on {referral_code} from the loyalty hub."
        metadata.setdefault("ctaHref", "/account/loyalty/referrals")
        headline = "Referral follow-up"
        cta_label = "Manage referrals"

    metadata.setdefault("intentStatus", intent.status.value)

    return LoyaltyNextActionCardResponse(
        id=intent.id,
        kind=intent.kind.value,
        headline=headline,
        description=description,
        ctaLabel=cta_label,
        createdAt=intent.created_at,
        expiresAt=intent.expires_at,
        metadata=metadata,
    )


def _serialize_nudge_card(card: LoyaltyNudgeCard) -> LoyaltyNudgeCardResponse:
    return LoyaltyNudgeCardResponse(
        id=card.id,
        nudgeType=card.nudge_type.value,
        headline=card.headline,
        body=card.body,
        ctaLabel=card.cta_label,
        ctaHref=card.cta_href,
        expiresAt=card.expires_at,
        priority=card.priority,
        metadata=card.metadata,
    )


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


def _serialize_referral_conversion(referral: ReferralInvite) -> ReferralConversionResponse:
    return ReferralConversionResponse(
        id=referral.id,
        code=referral.code,
        status=referral.status.value,
        rewardPoints=float(referral.reward_points or 0),
        inviteeEmail=referral.invitee_email,
        createdAt=referral.created_at,
        updatedAt=referral.updated_at,
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


def _serialize_ledger_entry(entry: LoyaltyLedgerEntry) -> LedgerEntryResponse:
    metadata = entry.metadata_json or {}
    return LedgerEntryResponse(
        id=entry.id,
        occurredAt=entry.occurred_at,
        entryType=entry.entry_type.value,
        amount=float(entry.amount or 0),
        description=entry.description,
        metadata=dict(metadata),
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


@router.post(
    "/checkout/intents",
    response_model=CheckoutNextActionsResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def submit_checkout_loyalty_intents(
    request: CheckoutIntentSubmissionRequest,
    db: AsyncSession = Depends(get_session),
) -> CheckoutNextActionsResponse:
    """Apply loyalty intents captured during checkout completion."""

    service = LoyaltyService(db)
    member = await service.ensure_member(request.userId)

    intents_payload = [intent.dict() for intent in request.intents]
    await service.apply_checkout_intents(
        member,
        order_id=request.orderId,
        intents=intents_payload,
        action=request.action,
    )

    await db.commit()
    pending = await service.list_checkout_next_actions(member)
    return CheckoutNextActionsResponse(
        intents=[_serialize_checkout_intent(intent) for intent in pending],
        cards=[_build_next_action_card(intent) for intent in pending],
    )


@router.get("/next-actions", response_model=CheckoutNextActionsResponse)
async def list_checkout_next_actions(
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> CheckoutNextActionsResponse:
    """Return active checkout-driven next actions for the member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)
    pending = await service.list_checkout_next_actions(member)
    return CheckoutNextActionsResponse(
        intents=[_serialize_checkout_intent(intent) for intent in pending],
        cards=[_build_next_action_card(intent) for intent in pending],
    )


@router.post(
    "/next-actions/{intent_id}/resolve",
    response_model=CheckoutIntentResponse,
)
async def resolve_checkout_next_action(
    intent_id: UUID,
    request: CheckoutIntentResolveRequest,
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> CheckoutIntentResponse:
    """Mark a checkout next action as resolved or cancelled."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    status_value = (
        LoyaltyCheckoutIntentStatus.CANCELLED
        if request.status == "cancelled"
        else LoyaltyCheckoutIntentStatus.RESOLVED
    )
    record = await service.resolve_checkout_intent(
        member,
        intent_id,
        status=status_value,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Checkout intent not found")

    await db.commit()
    return _serialize_checkout_intent(record)


@router.get("/nudges", response_model=LoyaltyNudgeFeedResponse)
async def list_loyalty_nudges(
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> LoyaltyNudgeFeedResponse:
    """Return proactive loyalty nudges for the authenticated member."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)
    cards = await service.list_member_nudges(member)
    await db.commit()
    return LoyaltyNudgeFeedResponse(nudges=[_serialize_nudge_card(card) for card in cards])


@router.post("/nudges/{nudge_id}/status", status_code=status.HTTP_204_NO_CONTENT)
async def update_loyalty_nudge_status(
    nudge_id: UUID,
    request: LoyaltyNudgeStatusRequest,
    current_user: User = Depends(require_member_session),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Persist acknowledgement or dismissal for a loyalty nudge."""

    service = LoyaltyService(db)
    member = await service.ensure_member(current_user.id)

    try:
        new_status = LoyaltyNudgeStatus(request.status)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid nudge status") from error

    record = await service.update_member_nudge_status(
        member,
        nudge_id,
        status=new_status,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Nudge not found")

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.get(
    "/guardrails",
    response_model=LoyaltyGuardrailSnapshotResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def get_loyalty_guardrails(
    db: AsyncSession = Depends(get_session),
) -> LoyaltyGuardrailSnapshotResponse:
    """Return aggregate guardrail posture for operators."""

    service = LoyaltyService(db)
    snapshot = await service.fetch_guardrail_snapshot()
    return LoyaltyGuardrailSnapshotResponse.from_snapshot(snapshot)


@router.post(
    "/guardrails/overrides",
    response_model=LoyaltyGuardrailOverrideResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_guardrail_override(
    payload: LoyaltyGuardrailOverrideCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> LoyaltyGuardrailOverrideResponse:
    """Create a guardrail override and append audit history."""

    service = LoyaltyService(db)
    override = await service.create_guardrail_override(
        scope=payload.scope,
        justification=payload.justification,
        actor_user_id=payload.actorUserId,
        target_member_id=payload.targetMemberId,
        expires_at=payload.expiresAt,
        metadata=payload.metadata,
    )
    await db.commit()
    await db.refresh(override)
    return LoyaltyGuardrailOverrideResponse.from_record(
        service._serialize_guardrail_override(override)
    )

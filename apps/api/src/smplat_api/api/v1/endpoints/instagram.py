from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.customer_profile import CustomerProfile
from smplat_api.models.fulfillment import InstagramAccount
from smplat_api.services.fulfillment import InstagramService


router = APIRouter(
    prefix="/instagram",
    tags=["instagram"],
    dependencies=[Depends(require_checkout_api_key)],
)


class InstagramSnapshot(BaseModel):
    date: str = Field(..., description="ISO timestamp for the analytics snapshot")
    followers: int = Field(..., description="Follower count")
    following: int = Field(..., description="Following count")
    engagement_rate: float = Field(..., description="Engagement rate as a percentage")
    avg_likes: int = Field(..., description="Average likes per post")
    avg_comments: int = Field(..., description="Average comments per post")
    reach: int = Field(..., description="Estimated reach")
    impressions: int = Field(..., description="Impressions captured")
    posts: int = Field(..., description="Total posts counted")
    stories: int = Field(..., description="Total stories counted")
    reels: int = Field(..., description="Total reels counted")


class InstagramAccountAnalytics(BaseModel):
    id: str = Field(..., description="Internal Instagram account identifier")
    username: str = Field(..., description="Instagram handle")
    follower_count: Optional[int] = Field(None, description="Latest follower count")
    following_count: Optional[int] = Field(None, description="Latest following count")
    media_count: Optional[int] = Field(None, description="Total media count")
    last_sync_at: Optional[str] = Field(None, description="Last synchronization timestamp")
    history: List[InstagramSnapshot] = Field(default_factory=list, description="Recent analytics snapshots")


@router.get(
    "/analytics",
    response_model=List[InstagramAccountAnalytics],
    summary="Fetch Instagram analytics for a client's accounts",
)
async def get_instagram_analytics(
    user_id: UUID = Query(..., description="User identifier that owns the Instagram accounts"),
    days: int = Query(30, ge=1, le=90, description="Number of days of analytics history to return"),
    db: AsyncSession = Depends(get_session),
) -> List[InstagramAccountAnalytics]:
    """Return Instagram analytics snapshots for all accounts tied to the provided user."""
    stmt = (
        select(InstagramAccount)
        .join(CustomerProfile)
        .where(CustomerProfile.user_id == user_id)
        .order_by(InstagramAccount.created_at.asc())
    )

    result = await db.execute(stmt)
    accounts = result.scalars().all()

    if not accounts:
        return []

    service = InstagramService(db)
    analytics: List[InstagramAccountAnalytics] = []

    for account in accounts:
        history_payload = await service.get_account_analytics_history(account.id, days=days)
        history = [
            InstagramSnapshot(
                date=entry["date"],
                followers=entry["followers"],
                following=entry["following"],
                engagement_rate=entry["engagement_rate"],
                avg_likes=entry["avg_likes"],
                avg_comments=entry["avg_comments"],
                reach=entry["reach"],
                impressions=entry["impressions"],
                posts=entry["posts"],
                stories=entry["stories"],
                reels=entry["reels"],
            )
            for entry in history_payload
        ]

        analytics.append(
            InstagramAccountAnalytics(
                id=str(account.id),
                username=account.username,
                follower_count=account.follower_count,
                following_count=account.following_count,
                media_count=account.media_count,
                last_sync_at=account.last_sync_at.isoformat() if account.last_sync_at else None,
                history=history,
            )
        )

    return analytics

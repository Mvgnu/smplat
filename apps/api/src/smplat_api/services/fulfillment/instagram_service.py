"""Instagram API integration service for account management and analytics."""

import asyncio
import httpx
from typing import Dict, Any, Optional, List
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from smplat_api.core.settings import get_settings
from smplat_api.models.fulfillment import InstagramAccount, InstagramAnalyticsSnapshot
from smplat_api.models.customer_profile import CustomerProfile


class InstagramService:
    """Service for Instagram API operations and account management."""
    
    def __init__(self, db_session: AsyncSession):
        """Initialize Instagram service.
        
        Args:
            db_session: Database session for operations
        """
        self.db = db_session
        self.settings = get_settings()
        self.base_url = "https://graph.instagram.com"
        
    async def verify_instagram_account(self, username: str, customer_profile_id: UUID) -> Optional[Dict[str, Any]]:
        """Verify and link an Instagram account to a customer profile.
        
        This method performs basic verification of the Instagram account
        and creates an InstagramAccount record.
        
        Args:
            username: Instagram username to verify
            customer_profile_id: Customer profile ID to link account to
            
        Returns:
            Dictionary with account information if successful, None otherwise
        """
        try:
            # Check if account already exists
            stmt = select(InstagramAccount).where(
                InstagramAccount.username == username,
                InstagramAccount.customer_profile_id == customer_profile_id
            )
            result = await self.db.execute(stmt)
            existing_account = result.scalar_one_or_none()
            
            if existing_account:
                logger.info(
                    "Instagram account already linked",
                    username=username,
                    customer_profile_id=str(customer_profile_id)
                )
                return self._account_to_dict(existing_account)
            
            # For production, this would use Instagram Basic Display API
            # For now, we'll create a placeholder account with basic verification
            account_data = await self._fetch_basic_account_info(username)
            
            if not account_data:
                return None
                
            # Create Instagram account record
            instagram_account = InstagramAccount(
                customer_profile_id=customer_profile_id,
                username=username,
                instagram_user_id=account_data.get("id"),
                is_business_account=account_data.get("is_business", False),
                is_verified=True,  # Set to verified after basic checks
                follower_count=account_data.get("followers_count", 0),
                following_count=account_data.get("following_count", 0),
                media_count=account_data.get("media_count", 0),
                profile_picture_url=account_data.get("profile_picture_url"),
                biography=account_data.get("biography"),
                website=account_data.get("website"),
                last_sync_at=datetime.utcnow()
            )
            
            self.db.add(instagram_account)
            await self.db.commit()
            await self.db.refresh(instagram_account)
            
            logger.info(
                "Created Instagram account record",
                account_id=str(instagram_account.id),
                username=username,
                customer_profile_id=str(customer_profile_id)
            )
            
            # Create initial analytics snapshot
            await self._create_initial_analytics_snapshot(instagram_account)
            
            return self._account_to_dict(instagram_account)
            
        except Exception as e:
            logger.error(
                "Failed to verify Instagram account",
                username=username,
                customer_profile_id=str(customer_profile_id),
                error=str(e)
            )
            await self.db.rollback()
            return None
            
    async def _fetch_basic_account_info(self, username: str) -> Optional[Dict[str, Any]]:
        """Fetch basic account information from Instagram.
        
        In production, this would use the Instagram Graph API.
        For now, we'll simulate the response with realistic data.
        
        Args:
            username: Instagram username
            
        Returns:
            Dictionary with account information or None if not found
        """
        # Simulate API call delay
        await asyncio.sleep(0.5)
        
        # Basic validation - check if username format is valid
        if not username or len(username) < 1 or len(username) > 30:
            return None
            
        # Simulate Instagram account data
        # In production, this would be actual API calls
        import random
        
        return {
            "id": f"{hash(username) % 1000000000}",  # Simulated Instagram user ID
            "username": username,
            "followers_count": random.randint(100, 10000),
            "following_count": random.randint(50, 2000),
            "media_count": random.randint(10, 500),
            "is_business": random.choice([True, False]),
            "profile_picture_url": f"https://example.com/profiles/{username}.jpg",
            "biography": f"Instagram user @{username}",
            "website": None
        }
        
    async def _create_initial_analytics_snapshot(self, instagram_account: InstagramAccount) -> None:
        """Create initial analytics snapshot for a new Instagram account.
        
        Args:
            instagram_account: Instagram account to create snapshot for
        """
        try:
            snapshot = InstagramAnalyticsSnapshot(
                instagram_account_id=instagram_account.id,
                snapshot_date=datetime.utcnow(),
                follower_count=instagram_account.follower_count or 0,
                following_count=instagram_account.following_count or 0,
                avg_likes_per_post=0,  # Will be updated with real data
                avg_comments_per_post=0,
                engagement_rate=0,
                reach=0,
                impressions=0,
                posts_count=instagram_account.media_count or 0,
                stories_count=0,
                reels_count=0,
                additional_metrics={"baseline": True}
            )
            
            self.db.add(snapshot)
            await self.db.commit()
            
            logger.info(
                "Created initial analytics snapshot",
                account_id=str(instagram_account.id),
                snapshot_id=str(snapshot.id)
            )
            
        except Exception as e:
            logger.error(
                "Failed to create initial analytics snapshot",
                account_id=str(instagram_account.id),
                error=str(e)
            )
            
    async def update_account_analytics(self, account_id: UUID) -> bool:
        """Update analytics for an Instagram account.
        
        Args:
            account_id: Instagram account ID
            
        Returns:
            True if update successful
        """
        try:
            stmt = select(InstagramAccount).where(InstagramAccount.id == account_id)
            result = await self.db.execute(stmt)
            account = result.scalar_one_or_none()
            
            if not account:
                return False
                
            # Fetch current metrics (simulated for now)
            current_metrics = await self._fetch_account_metrics(account.username)
            
            if not current_metrics:
                return False
                
            # Update account basic info
            account.follower_count = current_metrics.get("followers_count", account.follower_count)
            account.following_count = current_metrics.get("following_count", account.following_count)
            account.media_count = current_metrics.get("media_count", account.media_count)
            account.last_sync_at = datetime.utcnow()
            
            # Create new analytics snapshot
            snapshot = InstagramAnalyticsSnapshot(
                instagram_account_id=account.id,
                snapshot_date=datetime.utcnow(),
                follower_count=current_metrics.get("followers_count", 0),
                following_count=current_metrics.get("following_count", 0),
                avg_likes_per_post=current_metrics.get("avg_likes", 0),
                avg_comments_per_post=current_metrics.get("avg_comments", 0),
                engagement_rate=int(current_metrics.get("engagement_rate", 0) * 100),  # Store as percentage * 100
                reach=current_metrics.get("reach", 0),
                impressions=current_metrics.get("impressions", 0),
                posts_count=current_metrics.get("media_count", 0),
                stories_count=current_metrics.get("stories_count", 0),
                reels_count=current_metrics.get("reels_count", 0),
                additional_metrics=current_metrics.get("additional", {})
            )
            
            self.db.add(snapshot)
            await self.db.commit()
            
            logger.info(
                "Updated Instagram account analytics",
                account_id=str(account_id),
                followers=current_metrics.get("followers_count"),
                engagement_rate=current_metrics.get("engagement_rate")
            )
            
            return True
            
        except Exception as e:
            logger.error(
                "Failed to update account analytics",
                account_id=str(account_id),
                error=str(e)
            )
            await self.db.rollback()
            return False
            
    async def _fetch_account_metrics(self, username: str) -> Optional[Dict[str, Any]]:
        """Fetch current account metrics from Instagram API.
        
        In production, this would use Instagram Graph API with proper authentication.
        
        Args:
            username: Instagram username
            
        Returns:
            Dictionary with current metrics
        """
        # Simulate API call
        await asyncio.sleep(0.3)
        
        import random
        
        # Simulate realistic engagement and growth
        base_followers = random.randint(1000, 50000)
        
        return {
            "followers_count": base_followers,
            "following_count": random.randint(100, 2000),
            "media_count": random.randint(50, 1000),
            "avg_likes": random.randint(int(base_followers * 0.02), int(base_followers * 0.08)),
            "avg_comments": random.randint(int(base_followers * 0.001), int(base_followers * 0.005)),
            "engagement_rate": random.uniform(2.0, 8.0),  # Percentage
            "reach": random.randint(int(base_followers * 0.3), int(base_followers * 1.2)),
            "impressions": random.randint(int(base_followers * 0.5), int(base_followers * 2.0)),
            "stories_count": random.randint(0, 10),
            "reels_count": random.randint(5, 50),
            "additional": {
                "profile_views": random.randint(100, 5000),
                "website_clicks": random.randint(0, 100),
                "email_contacts": random.randint(0, 20)
            }
        }
        
    async def get_account_analytics_history(
        self, 
        account_id: UUID, 
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """Get analytics history for an Instagram account.
        
        Args:
            account_id: Instagram account ID
            days: Number of days of history to retrieve
            
        Returns:
            List of analytics snapshots
        """
        try:
            since_date = datetime.utcnow() - timedelta(days=days)
            
            stmt = (
                select(InstagramAnalyticsSnapshot)
                .where(
                    InstagramAnalyticsSnapshot.instagram_account_id == account_id,
                    InstagramAnalyticsSnapshot.snapshot_date >= since_date
                )
                .order_by(InstagramAnalyticsSnapshot.snapshot_date.desc())
            )
            
            result = await self.db.execute(stmt)
            snapshots = result.scalars().all()
            
            return [
                {
                    "date": snapshot.snapshot_date.isoformat(),
                    "followers": snapshot.follower_count,
                    "following": snapshot.following_count,
                    "engagement_rate": snapshot.engagement_rate / 100,  # Convert back to percentage
                    "avg_likes": snapshot.avg_likes_per_post,
                    "avg_comments": snapshot.avg_comments_per_post,
                    "reach": snapshot.reach,
                    "impressions": snapshot.impressions,
                    "posts": snapshot.posts_count,
                    "stories": snapshot.stories_count,
                    "reels": snapshot.reels_count
                }
                for snapshot in snapshots
            ]
            
        except Exception as e:
            logger.error(
                "Failed to get analytics history",
                account_id=str(account_id),
                error=str(e)
            )
            return []
            
    def _account_to_dict(self, account: InstagramAccount) -> Dict[str, Any]:
        """Convert InstagramAccount model to dictionary.
        
        Args:
            account: Instagram account model
            
        Returns:
            Dictionary representation of account
        """
        return {
            "id": str(account.id),
            "username": account.username,
            "instagram_user_id": account.instagram_user_id,
            "is_business_account": account.is_business_account,
            "is_verified": account.is_verified,
            "follower_count": account.follower_count,
            "following_count": account.following_count,
            "media_count": account.media_count,
            "profile_picture_url": account.profile_picture_url,
            "biography": account.biography,
            "website": account.website,
            "last_sync_at": account.last_sync_at.isoformat() if account.last_sync_at else None,
            "created_at": account.created_at.isoformat()
        }


# Add asyncio import for sleep function
import asyncio

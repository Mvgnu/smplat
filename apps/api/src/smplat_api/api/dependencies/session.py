"""Session-aware dependencies for storefront member APIs."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import get_session
from smplat_api.models.user import User


async def require_member_session(
    session_user: str | None = Header(None, alias="X-Session-User"),
    db: AsyncSession = Depends(get_session),
) -> User:
    """Resolve the authenticated user from forwarded session headers."""

    if not session_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing session user context",
        )

    try:
        user_id = UUID(session_user)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session user identifier",
        ) from error

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session user not found",
        )

    return user

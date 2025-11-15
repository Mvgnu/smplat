from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import get_session
from smplat_api.models.notification import NotificationPreference

router = APIRouter(prefix="/notifications", tags=["Notifications"])

DEFAULT_PREFERENCES = {
    "order_updates": True,
    "payment_updates": True,
    "fulfillment_alerts": True,
    "marketing_messages": False,
    "billing_alerts": False,
    "last_selected_order_id": None,
}


class NotificationPreferenceResponse(BaseModel):
    order_updates: bool = Field(..., description="Whether order updates are enabled")
    payment_updates: bool = Field(..., description="Whether payment updates are enabled")
    fulfillment_alerts: bool = Field(..., description="Whether fulfillment alerts are enabled")
    marketing_messages: bool = Field(..., description="Whether marketing messages are enabled")
    billing_alerts: bool = Field(..., description="Whether billing alerts are enabled")
    last_selected_order_id: UUID | None = Field(
        default=None, description="Last order selected in the dashboard"
    )

    model_config = ConfigDict(from_attributes=True)


class NotificationPreferenceUpdateRequest(BaseModel):
    order_updates: bool | None = None
    payment_updates: bool | None = None
    fulfillment_alerts: bool | None = None
    marketing_messages: bool | None = None
    billing_alerts: bool | None = None
    last_selected_order_id: UUID | None = Field(default=None)


async def _ensure_preference(session: AsyncSession, user_id: UUID) -> NotificationPreference:
    result = await session.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == user_id)
    )
    preference = result.scalar_one_or_none()
    if preference is not None:
        return preference

    preference = NotificationPreference(
        user_id=user_id,
        order_updates=DEFAULT_PREFERENCES["order_updates"],
        payment_updates=DEFAULT_PREFERENCES["payment_updates"],
        fulfillment_alerts=DEFAULT_PREFERENCES["fulfillment_alerts"],
        marketing_messages=DEFAULT_PREFERENCES["marketing_messages"],
        billing_alerts=DEFAULT_PREFERENCES["billing_alerts"],
        last_selected_order_id=DEFAULT_PREFERENCES["last_selected_order_id"],
    )
    session.add(preference)
    await session.commit()
    await session.refresh(preference)
    return preference


@router.get(
    "/preferences/{user_id}",
    response_model=NotificationPreferenceResponse,
    status_code=status.HTTP_200_OK,
)
async def get_notification_preferences(
    user_id: UUID, session: AsyncSession = Depends(get_session)
) -> NotificationPreferenceResponse:
    """Fetch notification preferences for the user, creating defaults if necessary."""

    preference = await _ensure_preference(session, user_id)
    return NotificationPreferenceResponse.model_validate(preference)


@router.patch(
    "/preferences/{user_id}",
    response_model=NotificationPreferenceResponse,
    status_code=status.HTTP_200_OK,
)
async def update_notification_preferences(
    user_id: UUID,
    payload: NotificationPreferenceUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> NotificationPreferenceResponse:
    """Update notification preferences for the user."""

    preference = await _ensure_preference(session, user_id)

    updated = False
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field != "last_selected_order_id":
            continue
        setattr(preference, field, value)
        updated = True

    if updated:
        await session.commit()
        await session.refresh(preference)

    return NotificationPreferenceResponse.model_validate(preference)

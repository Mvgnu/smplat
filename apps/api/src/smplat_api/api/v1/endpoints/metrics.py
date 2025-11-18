"""Metric sourcing + account validation endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.social_account import (
    CustomerSocialAccount,
    SocialAccountVerificationStatus,
    SocialPlatformEnum,
)
from smplat_api.services.metrics import (
    AccountValidationPayload,
    MetricSourcer,
    MetricValidationError,
)

router = APIRouter(prefix="/metrics", tags=["Metrics"])


class ManualMetricPayload(BaseModel):
    """Allows operators to override metrics when the scraper is unavailable."""

    followers: int | None = Field(default=None, ge=0)
    following: int | None = Field(default=None, ge=0)
    avgLikes: int | None = Field(default=None, ge=0)
    avgComments: int | None = Field(default=None, ge=0)
    engagementRatePct: float | None = Field(default=None, ge=0)
    sampleSize: int | None = Field(default=None, ge=0)
    lastPostAt: datetime | None = None


class AccountValidationRequest(BaseModel):
    """Request payload for `/metrics/accounts/validate`."""

    platform: SocialPlatformEnum = Field(..., description="Destination platform identifier.")
    handle: str = Field(..., min_length=1, description="Account handle (accepts leading @).")
    customerProfileId: UUID | None = Field(
        default=None,
        description="Optional link to an existing `customer_profile` record.",
    )
    manualMetrics: dict[str, Any] | ManualMetricPayload | None = Field(
        default=None,
        description="Optional metrics bundle used when forcing manual entry.",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Contextual metadata that should be persisted with the account.",
    )


class AccountSnapshotResponse(BaseModel):
    """Snapshot object sent back to the storefront/admin UI."""

    platform: SocialPlatformEnum
    handle: str
    metrics: dict[str, Any]
    scrapedAt: datetime
    source: str
    qualityScore: float | None = None
    latencyMs: int | None = None
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    accountId: str | None = None
    displayName: str | None = None
    profileUrl: str | None = None
    avatarUrl: str | None = None


class CustomerSocialAccountResponse(BaseModel):
    """Serialized representation of `CustomerSocialAccount`."""

    id: UUID
    platform: SocialPlatformEnum
    handle: str
    displayName: str | None = None
    profileUrl: str | None = None
    avatarUrl: str | None = None
    verificationStatus: SocialAccountVerificationStatus
    verificationMethod: str | None = None
    verificationNotes: str | None = None
    lastVerifiedAt: datetime | None = None
    lastScrapedAt: datetime | None = None
    baselineMetrics: dict[str, Any] | None = None
    deliverySnapshots: dict[str, Any] | None = None
    targetMetrics: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    customerProfileId: UUID | None = None


class AccountValidationResponse(BaseModel):
    """Response payload for account validation."""

    account: CustomerSocialAccountResponse
    snapshot: AccountSnapshotResponse
    created: bool = Field(
        default=False,
        description="Indicates whether a new social account record was created.",
    )


def _serialize_account(account: CustomerSocialAccount) -> CustomerSocialAccountResponse:
    metadata = account.metadata_json if isinstance(account.metadata_json, dict) else {}
    return CustomerSocialAccountResponse(
        id=account.id,
        platform=account.platform,
        handle=account.handle,
        displayName=account.display_name,
        profileUrl=account.profile_url,
        avatarUrl=account.avatar_url,
        verificationStatus=account.verification_status,
        verificationMethod=account.verification_method,
        verificationNotes=account.verification_notes,
        lastVerifiedAt=account.last_verified_at,
        lastScrapedAt=account.last_scraped_at,
        baselineMetrics=account.baseline_metrics if isinstance(account.baseline_metrics, dict) else None,
        deliverySnapshots=account.delivery_snapshots if isinstance(account.delivery_snapshots, dict) else None,
        targetMetrics=account.target_metrics if isinstance(account.target_metrics, dict) else None,
        metadata=metadata,
        customerProfileId=account.customer_profile_id,
    )


@router.post(
    "/accounts/validate",
    response_model=AccountValidationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def validate_social_account(
    request: AccountValidationRequest,
    _: None = Depends(require_checkout_api_key),
    session: AsyncSession = Depends(get_session),
) -> AccountValidationResponse:
    """Validate an account handle by proxying to the MetricSourcer service."""

    sourcer = MetricSourcer(session=session)
    manual_metrics_dict: dict[str, Any] | None = None
    if isinstance(request.manualMetrics, ManualMetricPayload):
        manual_metrics_dict = request.manualMetrics.model_dump(exclude_none=True)
    elif isinstance(request.manualMetrics, dict):
        manual_metrics_dict = request.manualMetrics

    try:
        result = await sourcer.validate_account(
            AccountValidationPayload(
                platform=request.platform,
                handle=request.handle,
                customer_profile_id=request.customerProfileId,
                manual_metrics=manual_metrics_dict,
                metadata=request.metadata,
            ),
        )
    except MetricValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": str(exc), "code": exc.code},
        ) from exc

    response = AccountValidationResponse(
        account=_serialize_account(result.account),
        snapshot=AccountSnapshotResponse(**MetricSourcer._snapshot_to_dict(result.snapshot)),
        created=result.created,
    )
    return response

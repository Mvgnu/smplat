"""Metric sourcing orchestration for customer social accounts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.social_account import (
    CustomerSocialAccount,
    SocialAccountVerificationStatus,
    SocialPlatformEnum,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_handle(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("@"):
        cleaned = cleaned[1:]
    return cleaned.strip().lower()


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float):
            if not value.isfinite():
                return None
            return int(value)
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value.strip()))
        except ValueError:
            return None
    return None


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _coerce_str(value: Any) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if value is None:
        return None
    return str(value)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    return None


@dataclass(slots=True)
class AccountSnapshot:
    """Structured metric snapshot returned by the metric sourcer."""

    platform: SocialPlatformEnum
    handle: str
    metrics: dict[str, Any]
    scraped_at: datetime
    source: str
    latency_ms: int | None = None
    quality_score: float | None = None
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    account_id: str | None = None
    display_name: str | None = None
    profile_url: str | None = None
    avatar_url: str | None = None


@dataclass(slots=True)
class AccountValidationPayload:
    """Incoming payload used to validate and persist an account."""

    platform: SocialPlatformEnum
    handle: str
    customer_profile_id: UUID | None = None
    manual_metrics: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class AccountValidationResult:
    """Result returned to API consumers."""

    account: CustomerSocialAccount
    snapshot: AccountSnapshot
    created: bool


class MetricValidationError(RuntimeError):
    """Exception raised when a validation request cannot be fulfilled."""

    def __init__(self, message: str, code: str = "validation_failed") -> None:
        super().__init__(message)
        self.code = code


class MetricScraperClient:
    """HTTP client for the upstream scraper API."""

    def __init__(
        self,
        base_url: str | None,
        api_token: str | None,
        timeout_seconds: float,
    ) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None
        self._api_token = api_token
        self._timeout_seconds = timeout_seconds

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url)

    async def fetch_snapshot(self, platform: SocialPlatformEnum, handle: str) -> dict[str, Any] | None:
        """Call the upstream scraper. Returns None when unavailable or failing."""

        if not self._base_url:
            return None

        target_url = f"{self._base_url}/accounts/lookup"
        headers = {"Content-Type": "application/json"}
        if self._api_token:
            headers["Authorization"] = (
                self._api_token if self._api_token.lower().startswith("bearer ") else f"Bearer {self._api_token}"
            )

        payload = {"platform": platform.value, "handle": handle}
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.post(target_url, json=payload, headers=headers)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Metric scraper returned HTTP error",
                status=exc.response.status_code,
                body=exc.response.text[:256] if exc.response else None,
            )
            return None
        except httpx.HTTPError as exc:
            logger.warning("Metric scraper request failed", error=str(exc))
            return None

        try:
            data = response.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        return data


class MetricSourcer:
    """Resolves storefront metric snapshots with scraper + manual fallbacks."""

    def __init__(
        self,
        session: AsyncSession,
        scraper_client: MetricScraperClient | None = None,
        allow_manual_fallback: bool | None = None,
    ) -> None:
        self._session = session
        self._scraper_client = scraper_client or MetricScraperClient(
            base_url=settings.metric_scraper_api_base_url,
            api_token=settings.metric_scraper_api_token,
            timeout_seconds=settings.metric_validation_timeout_seconds,
        )
        self._allow_manual_fallback = (
            settings.metric_validation_manual_fallback
            if allow_manual_fallback is None
            else allow_manual_fallback
        )

    async def validate_account(self, payload: AccountValidationPayload) -> AccountValidationResult:
        """Return a sanitized snapshot and persist the account metadata."""

        handle = _normalize_handle(payload.handle)
        snapshot = await self._resolve_snapshot(payload.platform, handle, payload.manual_metrics)
        account, created = await self._upsert_account(
            handle=handle,
            platform=payload.platform,
            snapshot=snapshot,
            customer_profile_id=payload.customer_profile_id,
            metadata=payload.metadata,
        )
        return AccountValidationResult(account=account, snapshot=snapshot, created=created)

    async def _resolve_snapshot(
        self,
        platform: SocialPlatformEnum,
        handle: str,
        manual_metrics: dict[str, Any] | None,
    ) -> AccountSnapshot:
        scraper_payload: dict[str, Any] | None = None
        if self._scraper_client.is_configured:
            scraper_payload = await self._scraper_client.fetch_snapshot(platform, handle)

        if scraper_payload:
            return self._snapshot_from_payload(platform, handle, scraper_payload, source="scraper")

        if manual_metrics:
            return self._snapshot_from_payload(platform, handle, manual_metrics, source="manual")

        if not self._allow_manual_fallback:
            raise MetricValidationError("Metric scraper unavailable and manual fallback disabled.", code="scraper_unavailable")

        return self._build_synthetic_snapshot(platform, handle)

    async def _upsert_account(
        self,
        *,
        platform: SocialPlatformEnum,
        handle: str,
        snapshot: AccountSnapshot,
        customer_profile_id: UUID | None,
        metadata: dict[str, Any] | None,
    ) -> tuple[CustomerSocialAccount, bool]:
        stmt = select(CustomerSocialAccount).where(
            CustomerSocialAccount.platform == platform,
            CustomerSocialAccount.handle == handle,
        )
        result = await self._session.execute(stmt)
        account = result.scalars().first()

        created = False
        if not account:
            account = CustomerSocialAccount(
                platform=platform,
                handle=handle,
                metadata_json=metadata or {},
                customer_profile_id=customer_profile_id,
                verification_status=SocialAccountVerificationStatus.PENDING,
            )
            self._session.add(account)
            created = True
        else:
            # merge metadata dictionaries while preserving historical context
            existing_meta = account.metadata_json if isinstance(account.metadata_json, dict) else {}
            merged_meta = {**existing_meta, **(metadata or {})}
            account.metadata_json = merged_meta
            if customer_profile_id and account.customer_profile_id is None:
                account.customer_profile_id = customer_profile_id

        account.account_id = snapshot.account_id or account.account_id
        account.display_name = snapshot.display_name or account.display_name
        account.profile_url = snapshot.profile_url or account.profile_url
        account.avatar_url = snapshot.avatar_url or account.avatar_url
        account.last_scraped_at = snapshot.scraped_at

        if snapshot.source != "manual":
            account.verification_status = SocialAccountVerificationStatus.VERIFIED
            account.last_verified_at = snapshot.scraped_at
        elif account.verification_status == SocialAccountVerificationStatus.PENDING:
            account.verification_notes = "Awaiting enriched verification signal from operator."

        snapshot_dict = self._snapshot_to_dict(snapshot)
        if account.baseline_metrics is None:
            account.baseline_metrics = snapshot_dict

        history: list[dict[str, Any]] = []
        if isinstance(account.delivery_snapshots, dict):
            history = account.delivery_snapshots.get("history", [])
            if not isinstance(history, list):
                history = []
        history = (history + [snapshot_dict])[-5:]
        account.delivery_snapshots = {"latest": snapshot_dict, "history": history}

        await self._session.commit()
        await self._session.refresh(account)
        return account, created

    def _snapshot_from_payload(
        self,
        platform: SocialPlatformEnum,
        handle: str,
        payload: dict[str, Any],
        *,
        source: str,
    ) -> AccountSnapshot:
        raw_metrics = payload.get("metrics")
        metrics_payload = raw_metrics if isinstance(raw_metrics, dict) else None
        sources = (metrics_payload, payload)
        follower_count = _coerce_int(_extract_value(sources, "followers", "followerCount"))
        normalized_metrics: dict[str, Any] = {
            "followerCount": follower_count,
            "followingCount": _coerce_int(_extract_value(sources, "followingCount")),
            "avgLikes": _coerce_int(_extract_value(sources, "avgLikes")),
            "avgComments": _coerce_int(_extract_value(sources, "avgComments")),
            "engagementRatePct": _coerce_float(_extract_value(sources, "engagementRatePct")),
            "sampleSize": _coerce_int(_extract_value(sources, "sampleSize")),
            "lastPostAt": None,
        }

        last_post = _extract_value(sources, "lastPostAt", "last_post_at")
        parsed_last_post = _parse_datetime(last_post)
        if parsed_last_post:
            normalized_metrics["lastPostAt"] = parsed_last_post.isoformat()

        scraped_at = (
            _parse_datetime(payload.get("sampledAt"))
            or _parse_datetime(_extract_value(sources, "sampledAt"))
            or _utcnow()
        )
        warnings: list[str] = []
        if normalized_metrics["sampleSize"] is None or normalized_metrics["sampleSize"] <= 0:
            warnings.append("sample_size_missing")
        if normalized_metrics["followerCount"] is None:
            warnings.append("follower_count_missing")

        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata["raw_metrics_present"] = isinstance(metrics_payload, dict)

        snapshot = AccountSnapshot(
            platform=platform,
            handle=handle,
            metrics=normalized_metrics,
            scraped_at=scraped_at,
            source=source,
            latency_ms=_coerce_int(payload.get("latencyMs")),
            quality_score=_coerce_float(payload.get("qualityScore")),
            warnings=warnings,
            metadata=metadata,
            account_id=_coerce_str(payload.get("accountId")),
            display_name=_coerce_str(payload.get("displayName")),
            profile_url=_coerce_str(payload.get("profileUrl")),
            avatar_url=_coerce_str(payload.get("avatarUrl")),
        )
        return snapshot

    def _build_synthetic_snapshot(self, platform: SocialPlatformEnum, handle: str) -> AccountSnapshot:
        seed = sum(ord(char) for char in handle) or 1
        follower_count = 500 + (seed % 7500)
        following_count = 80 + (seed % 450)
        avg_likes = max(25, follower_count // 25)
        avg_comments = max(3, avg_likes // 15)
        engagement_rate = round((avg_likes + avg_comments) / max(follower_count, 1) * 100, 2)
        sample_size = 12 + (seed % 6)
        now = _utcnow()

        metrics = {
            "followerCount": follower_count,
            "followingCount": following_count,
            "avgLikes": avg_likes,
            "avgComments": avg_comments,
            "engagementRatePct": engagement_rate,
            "sampleSize": sample_size,
            "lastPostAt": now.isoformat(),
        }
        metadata = {
            "synthesized": True,
            "reason": "scraper_unavailable",
        }
        return AccountSnapshot(
            platform=platform,
            handle=handle,
            metrics=metrics,
            scraped_at=now,
            source="manual",
            quality_score=0.35,
            warnings=["synthetic_snapshot"],
            metadata=metadata,
        )

    @staticmethod
    def _snapshot_to_dict(snapshot: AccountSnapshot) -> dict[str, Any]:
        return {
            "platform": snapshot.platform.value,
            "handle": snapshot.handle,
            "metrics": snapshot.metrics,
            "scrapedAt": snapshot.scraped_at.isoformat(),
            "source": snapshot.source,
            "qualityScore": snapshot.quality_score,
            "latencyMs": snapshot.latency_ms,
            "warnings": snapshot.warnings,
            "metadata": snapshot.metadata,
            "accountId": snapshot.account_id,
            "displayName": snapshot.display_name,
            "profileUrl": snapshot.profile_url,
            "avatarUrl": snapshot.avatar_url,
        }
def _extract_value(sources: tuple[dict[str, Any] | None, ...], *keys: str) -> Any:
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in keys:
            if key in source:
                candidate = source[key]
                if candidate is not None:
                    return candidate
    return None

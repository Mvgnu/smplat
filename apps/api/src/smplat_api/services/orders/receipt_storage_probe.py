"""Active probes for receipt storage readiness."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import Settings, get_settings
from smplat_api.models.receipt_storage_probe import ReceiptStorageProbeTelemetry


@dataclass(slots=True)
class ReceiptStorageProbeResult:
    """Outcome of a receipt storage probe run."""

    success: bool
    detail: str
    sentinel_key: str | None = None
    error: str | None = None
    checked_at: datetime | None = None


class ReceiptStorageProbeService:
    """Writes and verifies sentinel objects to confirm receipt storage health."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        settings: Settings | None = None,
        s3_client_factory: Callable[[], object] | None = None,
    ) -> None:
        self._session = session
        self._settings = settings or get_settings()
        self._s3_client_factory = s3_client_factory
        self._bucket = (self._settings.receipt_storage_bucket or "").strip()
        self._prefix = (self._settings.receipt_storage_prefix or "order-receipts").strip("/")
        self._acl = (self._settings.receipt_storage_acl or "private").strip() or "private"
        self._client = self._build_client()

    async def run_probe(self) -> ReceiptStorageProbeResult:
        """Write/read/delete a sentinel object to verify storage credentials."""

        if not self._bucket or self._client is None:
            detail = "Receipt storage bucket/client missing; skipping probe"
            logger.warning(detail)
            return ReceiptStorageProbeResult(success=False, detail=detail, error=detail)

        sentinel_key = self._build_sentinel_key()
        checked_at = datetime.now(timezone.utc)
        telemetry = await self._get_or_create_telemetry()

        try:
            await self._put_sentinel(sentinel_key)
            await self._read_sentinel(sentinel_key)
            await self._delete_sentinel(sentinel_key)
            detail = f"Sentinel {sentinel_key} verified at {checked_at.isoformat()}"
            telemetry.touch_success(sentinel_key=sentinel_key, detail=detail)
            await self._session.commit()
            logger.info(
                "Receipt storage probe successful",
                bucket=self._bucket,
                sentinel_key=sentinel_key,
            )
            return ReceiptStorageProbeResult(
                success=True,
                detail=detail,
                sentinel_key=sentinel_key,
                checked_at=checked_at,
            )
        except Exception as exc:
            await self._session.rollback()
            telemetry = await self._get_or_create_telemetry()
            telemetry.touch_failure(str(exc))
            telemetry.last_sentinel_key = sentinel_key
            telemetry.last_detail = f"Probe failure at {checked_at.isoformat()}"
            await self._session.commit()
            logger.error(
                "Receipt storage probe failed",
                error=str(exc),
                bucket=self._bucket,
                sentinel_key=sentinel_key,
            )
            return ReceiptStorageProbeResult(
                success=False,
                detail="Probe failed",
                sentinel_key=sentinel_key,
                error=str(exc),
                checked_at=checked_at,
            )

    async def _get_or_create_telemetry(self) -> ReceiptStorageProbeTelemetry:
        telemetry = await self._session.get(ReceiptStorageProbeTelemetry, "receipt_storage")
        if telemetry is None:
            telemetry = ReceiptStorageProbeTelemetry(component="receipt_storage")
            self._session.add(telemetry)
            await self._session.flush()
        return telemetry

    def _build_sentinel_key(self) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        parts = [part.strip("/") for part in (self._prefix, "_monitoring", f"probe-{timestamp}.pdf") if part]
        return "/".join(parts)

    async def _put_sentinel(self, key: str) -> None:
        client = self._client
        if client is None:
            raise RuntimeError("Receipt storage client unavailable")
        await asyncio.to_thread(
            client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=b"",
            ContentType="application/pdf",
            ACL=self._acl,
        )

    async def _read_sentinel(self, key: str) -> None:
        client = self._client
        if client is None:
            raise RuntimeError("Receipt storage client unavailable")
        try:
            await asyncio.to_thread(
                client.get_object,
                Bucket=self._bucket,
                Key=key,
            )
        except ClientError as exc:
            raise RuntimeError(f"Sentinel get failed ({exc.response.get('Error', {}).get('Code')})") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Sentinel get failed ({exc})") from exc

    async def _delete_sentinel(self, key: str) -> None:
        client = self._client
        if client is None:
            raise RuntimeError("Receipt storage client unavailable")
        await asyncio.to_thread(
            client.delete_object,
            Bucket=self._bucket,
            Key=key,
        )

    def _build_client(self):
        if self._s3_client_factory is not None:
            try:
                return self._s3_client_factory()
            except Exception:  # pragma: no cover - dependency injection guard
                return None

        if not self._bucket:
            return None
        config = None
        if self._settings.receipt_storage_force_path_style:
            config = Config(s3={"addressing_style": "path"})
        try:
            return boto3.client(
                "s3",
                region_name=self._settings.receipt_storage_region,
                endpoint_url=self._settings.receipt_storage_endpoint or None,
                config=config,
            )
        except Exception:  # pragma: no cover - boto client creation rarely fails
            return None


__all__ = ["ReceiptStorageProbeResult", "ReceiptStorageProbeService"]

"""Helpers for generating and persisting receipt artifacts."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import boto3
import httpx
from botocore.config import Config
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import Settings, get_settings
from smplat_api.models.order import Order


@dataclass(slots=True)
class ReceiptAttachmentResult:
    """Binary payload and metadata for an order receipt PDF."""

    filename: str
    content_type: str
    payload: bytes
    storage_key: str | None = None
    public_url: str | None = None
    uploaded_at: datetime | None = None


@dataclass(slots=True)
class StoredReceiptArtifact:
    """Snapshot of a persisted receipt artifact."""

    storage_key: str
    uploaded_at: datetime
    public_url: str | None


class ReceiptAttachmentService:
    """Fetch receipt PDFs from the storefront and persist them to object storage."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        settings: Settings | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._session = session
        self._settings = settings or get_settings()
        self._http_client = http_client
        self._storage_client = self._build_storage_client()
        prefix = (self._settings.receipt_storage_prefix or "order-receipts").strip("/")
        self._storage_prefix = prefix
        base_url = (self._settings.receipt_storage_public_base_url or "").strip()
        self._public_base_url = base_url.rstrip("/") if base_url else ""
        timeout = self._settings.receipt_pdf_fetch_timeout_seconds
        self._pdf_timeout = timeout if timeout and timeout > 0 else 10.0

    async def build_attachment(self, order: Order) -> ReceiptAttachmentResult | None:
        """Return a PDF payload (and optionally storage metadata) for the given order."""

        pdf_bytes = await self._fetch_pdf(order)
        if not pdf_bytes:
            return None

        filename = self._build_filename(order)
        storage: StoredReceiptArtifact | None = None
        if self._storage_client is not None and self._settings.receipt_storage_bucket:
            storage = await self._store(order, pdf_bytes, filename)

        return ReceiptAttachmentResult(
            filename=filename,
            content_type="application/pdf",
            payload=pdf_bytes,
            storage_key=storage.storage_key if storage else None,
            public_url=storage.public_url if storage else None,
            uploaded_at=storage.uploaded_at if storage else None,
        )

    async def _fetch_pdf(self, order: Order) -> bytes | None:
        base = (self._settings.frontend_url or "").strip()
        if not base:
            logger.warning("Frontend URL missing; cannot fetch receipt PDF", order_id=str(order.id))
            return None
        url = f"{base.rstrip('/')}/api/orders/{order.id}/receipt"
        close_client = False
        client = self._http_client
        if client is None:
            client = httpx.AsyncClient(timeout=self._pdf_timeout)
            close_client = True

        try:
            response = await client.get(
                url,
                headers={"Accept": "application/pdf"},
            )
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "application/pdf" not in content_type:
                logger.warning(
                    "Receipt endpoint returned unexpected content type",
                    order_id=str(order.id),
                    content_type=content_type,
                )
                return None
            return bytes(response.content)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to fetch receipt PDF", order_id=str(order.id), error=str(exc))
            return None
        finally:
            if close_client and client is not None:
                await client.aclose()

    async def _store(self, order: Order, payload: bytes, filename: str) -> StoredReceiptArtifact | None:
        bucket = self._settings.receipt_storage_bucket
        client = self._storage_client
        if not bucket or client is None:
            return None
        storage_key = self._build_storage_key(order, filename)
        acl = (self._settings.receipt_storage_acl or "private").strip() or "private"

        try:
            await asyncio.to_thread(
                client.put_object,
                Bucket=bucket,
                Key=storage_key,
                Body=payload,
                ContentType="application/pdf",
                ACL=acl,
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to upload receipt artifact", order_id=str(order.id), error=str(exc))
            return None

        uploaded_at = datetime.now(timezone.utc)
        public_url = self._build_public_url(storage_key)
        order.receipt_storage_key = storage_key
        order.receipt_storage_url = public_url
        order.receipt_storage_uploaded_at = uploaded_at
        await self._session.flush()
        await self._session.commit()
        return StoredReceiptArtifact(storage_key=storage_key, uploaded_at=uploaded_at, public_url=public_url)

    def _build_storage_client(self):
        bucket = self._settings.receipt_storage_bucket
        if not bucket:
            return None
        config = None
        if self._settings.receipt_storage_force_path_style:
            config = Config(s3={"addressing_style": "path"})
        return boto3.client(
            "s3",
            region_name=self._settings.receipt_storage_region,
            endpoint_url=self._settings.receipt_storage_endpoint or None,
            config=config,
        )

    def _build_filename(self, order: Order) -> str:
        reference = order.order_number or str(order.id)
        safe_reference = self._sanitize(reference)
        return f"smplat-order-{safe_reference}.pdf"

    def _build_storage_key(self, order: Order, filename: str) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        parts: list[str] = []
        if self._storage_prefix:
            parts.append(self._storage_prefix)
        parts.append(str(order.id))
        parts.append(f"{timestamp}-{self._sanitize(filename)}")
        return "/".join(part.strip("/") for part in parts if part)

    def _build_public_url(self, storage_key: str) -> str | None:
        base = self._public_base_url
        if not base:
            return None
        return f"{base}/{storage_key.lstrip('/')}"

    @staticmethod
    def _sanitize(value: str) -> str:
        sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-")
        return sanitized or "receipt"


__all__ = ["ReceiptAttachmentResult", "ReceiptAttachmentService"]

"""Shared helpers for delivery proof snapshots and aggregates."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models.order import Order, OrderItem, OrderStatusEnum
from smplat_api.models.product import Product
from smplat_api.models.social_account import CustomerSocialAccount


class DeliveryProofAccountResponse(BaseModel):
    id: Optional[str]
    handle: Optional[str]
    platform: Optional[str]
    displayName: Optional[str]
    verificationStatus: Optional[str]
    lastVerifiedAt: Optional[str]
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeliveryProofSnapshotResponse(BaseModel):
    metrics: Dict[str, Any] = Field(default_factory=dict)
    recordedAt: Optional[str]
    source: Optional[str]
    warnings: List[str] = Field(default_factory=list)


class OrderDeliveryProofItemResponse(BaseModel):
    itemId: str
    productTitle: str
    platformContext: Optional[Dict[str, Any]]
    account: Optional[DeliveryProofAccountResponse]
    baseline: Optional[DeliveryProofSnapshotResponse]
    latest: Optional[DeliveryProofSnapshotResponse]
    history: List[DeliveryProofSnapshotResponse] = Field(default_factory=list)


class OrderDeliveryProofResponse(BaseModel):
    orderId: str
    generatedAt: str
    items: List[OrderDeliveryProofItemResponse]


class DeliveryProofMetricAggregateResponse(BaseModel):
    metricId: str
    metricKey: str
    metricLabel: Optional[str]
    unit: Optional[str]
    sampleSize: int
    baselineAverage: Optional[float]
    latestAverage: Optional[float]
    deltaAverage: Optional[float]
    deltaPercent: Optional[float]
    formattedDelta: Optional[str]
    formattedLatest: Optional[str]
    formattedPercent: Optional[str]


class DeliveryProofProductAggregateResponse(BaseModel):
    productId: str
    productSlug: Optional[str]
    productTitle: Optional[str]
    sampleSize: int
    platforms: List[str] = Field(default_factory=list)
    lastSnapshotAt: Optional[str]
    metrics: List[DeliveryProofMetricAggregateResponse]


class DeliveryProofAggregatesEnvelope(BaseModel):
    generatedAt: str
    windowDays: int
    products: List[DeliveryProofProductAggregateResponse]


async def fetch_order_delivery_proof(
    db: AsyncSession,
    order_id: UUID,
) -> OrderDeliveryProofResponse | None:
    stmt = (
        select(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.customer_social_account),
        )
        .where(Order.id == order_id)
    )
    result = await db.execute(stmt)
    order = result.scalar_one_or_none()
    if not order:
        return None

    items: list[OrderDeliveryProofItemResponse] = []
    for item in order.items:
        account = item.customer_social_account
        baseline = _coerce_snapshot(item.baseline_metrics) or _coerce_snapshot(
            account.baseline_metrics if account else None
        )
        latest_payload = _extract_latest_snapshot(item, account)
        items.append(
            OrderDeliveryProofItemResponse(
                itemId=str(item.id),
                productTitle=item.product_title,
                platformContext=item.platform_context,
                account=_serialize_account(account) if account else None,
                baseline=baseline,
                latest=latest_payload["latest"],
                history=latest_payload["history"],
            )
        )

    return OrderDeliveryProofResponse(
        orderId=str(order.id),
        generatedAt=order.updated_at.isoformat(),
        items=items,
    )


async def fetch_delivery_proof_aggregates(
    db: AsyncSession,
    *,
    product_ids: Optional[List[UUID]] = None,
    window_days: int = 90,
    limit_per_product: int = 50,
) -> DeliveryProofAggregatesEnvelope:
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    updated_column = func.coalesce(Order.updated_at, Order.created_at, func.now())

    stmt = (
        select(
            OrderItem.product_id,
            OrderItem.product_title,
            OrderItem.platform_context,
            OrderItem.baseline_metrics,
            OrderItem.delivery_snapshots,
            updated_column.label("order_updated_at"),
            Product.slug.label("product_slug"),
        )
        .join(Order, OrderItem.order_id == Order.id)
        .outerjoin(Product, Product.id == OrderItem.product_id)
        .where(OrderItem.delivery_snapshots.isnot(None))
        .where(
            Order.status.in_(
                [
                    OrderStatusEnum.ACTIVE,
                    OrderStatusEnum.COMPLETED,
                ]
            )
        )
        .order_by(updated_column.desc())
    )
    if product_ids:
        stmt = stmt.where(OrderItem.product_id.in_(product_ids))

    result = await db.execute(stmt)
    rows = result.all()

    buckets: dict[str, dict[str, Any]] = {}
    per_product_counts: dict[str, int] = defaultdict(int)

    for row in rows:
        product_id = row.product_id
        if product_id is None:
            continue
        updated_at = _parse_timestamp(row.order_updated_at)
        if updated_at and updated_at < cutoff:
            continue
        product_id_str = str(product_id)
        if per_product_counts[product_id_str] >= limit_per_product:
            continue
        snapshot = _extract_snapshot_payload(row.delivery_snapshots)
        if not snapshot:
            continue
        latest_metrics = _extract_numeric_metrics(snapshot)
        if not latest_metrics:
            continue
        baseline_metrics = _extract_numeric_metrics(row.baseline_metrics)
        per_product_counts[product_id_str] += 1
        bucket = buckets.setdefault(
            product_id_str,
            {
                "product_id": product_id_str,
                "product_title": row.product_title,
                "product_slug": row.product_slug,
                "sample_size": 0,
                "platforms": set(),
                "last_snapshot": None,
                "metrics": defaultdict(list),
            },
        )
        bucket["sample_size"] += 1
        platform = _extract_platform(row.platform_context)
        if platform:
            bucket["platforms"].add(platform)
        snapshot_at = _parse_timestamp(snapshot.get("recordedAt") or snapshot.get("scrapedAt"))
        if snapshot_at and (bucket["last_snapshot"] is None or snapshot_at > bucket["last_snapshot"]):
            bucket["last_snapshot"] = snapshot_at
        metrics_store: dict[str, list[tuple[float | None, float | None]]] = bucket["metrics"]
        for key, latest_value in latest_metrics.items():
            metrics_store[key].append((baseline_metrics.get(key), latest_value))

    products: list[DeliveryProofProductAggregateResponse] = []
    for product_id, payload in buckets.items():
        metric_entries: list[DeliveryProofMetricAggregateResponse] = []
        metrics_store: dict[str, list[tuple[float | None, float | None]]] = payload["metrics"]
        for metric_key, samples in metrics_store.items():
            if not samples:
                continue
            latest_values = [latest for _, latest in samples if latest is not None]
            if not latest_values:
                continue
            baseline_values = [baseline for baseline, _ in samples if baseline is not None]
            delta_values = [
                latest - baseline
                for baseline, latest in samples
                if baseline is not None and latest is not None
            ]
            delta_percent_values = [
                (latest - baseline) / baseline
                for baseline, latest in samples
                if baseline not in (None, 0) and latest is not None
            ]
            baseline_avg = sum(baseline_values) / len(baseline_values) if baseline_values else None
            latest_avg = sum(latest_values) / len(latest_values) if latest_values else None
            delta_avg = sum(delta_values) / len(delta_values) if delta_values else None
            delta_pct = (
                sum(delta_percent_values) / len(delta_percent_values)
                if delta_percent_values
                else None
            )
            meta = _DELIVERY_PROOF_METRIC_METADATA.get(metric_key, {})
            metric_id = f"delivery_proof/{payload['product_slug'] or product_id}/{metric_key}"
            metric_entries.append(
                DeliveryProofMetricAggregateResponse(
                    metricId=metric_id,
                    metricKey=metric_key,
                    metricLabel=meta.get("label"),
                    unit=meta.get("unit"),
                    sampleSize=len(samples),
                    baselineAverage=baseline_avg,
                    latestAverage=latest_avg,
                    deltaAverage=delta_avg,
                    deltaPercent=delta_pct,
                    formattedDelta=_format_compact(delta_avg, unit=meta.get("unit")),
                    formattedLatest=_format_compact(latest_avg, unit=meta.get("unit"), signed=False),
                    formattedPercent=_format_percent(delta_pct),
                )
            )

        last_snapshot = payload["last_snapshot"]
        products.append(
            DeliveryProofProductAggregateResponse(
                productId=product_id,
                productSlug=payload["product_slug"],
                productTitle=payload["product_title"],
                sampleSize=payload["sample_size"],
                platforms=sorted(payload["platforms"]),
                lastSnapshotAt=last_snapshot.isoformat() if last_snapshot else None,
                metrics=metric_entries,
            )
        )

    return DeliveryProofAggregatesEnvelope(
        generatedAt=datetime.now(timezone.utc).isoformat(),
        windowDays=window_days,
        products=products,
    )


def _serialize_account(account: CustomerSocialAccount) -> DeliveryProofAccountResponse:
    return DeliveryProofAccountResponse(
        id=str(account.id),
        handle=account.handle,
        platform=account.platform.value if account.platform else None,
        displayName=account.display_name,
        verificationStatus=account.verification_status.value
        if account.verification_status
        else None,
        lastVerifiedAt=account.last_verified_at.isoformat() if account.last_verified_at else None,
        metadata=account.metadata or {},
    )


def _coerce_snapshot(raw: Dict[str, Any] | None) -> DeliveryProofSnapshotResponse | None:
    if not isinstance(raw, dict):
        return None
    recorded_at = raw.get("recordedAt") or raw.get("scrapedAt")
    parsed_recorded = _parse_timestamp(recorded_at)
    recorded_text = parsed_recorded.isoformat() if parsed_recorded else None
    warnings = raw.get("warnings")
    snapshot = DeliveryProofSnapshotResponse(
        metrics=raw.get("metrics") if isinstance(raw.get("metrics"), dict) else raw,
        recordedAt=recorded_text,
        source=raw.get("source"),
        warnings=warnings if isinstance(warnings, list) else [],
    )
    return snapshot


def _extract_latest_snapshot(
    item: OrderItem,
    account: CustomerSocialAccount | None,
) -> dict[str, list | None | DeliveryProofSnapshotResponse]:
    payload = item.delivery_snapshots
    if isinstance(payload, dict):
        latest = payload.get("latest")
        history = payload.get("history")
        latest_snapshot = _coerce_snapshot(latest) if isinstance(latest, dict) else None
        history_snapshots = (
            [
                snapshot
                for snapshot in (
                    _coerce_snapshot(entry) for entry in history if isinstance(entry, dict)
                )
                if snapshot is not None
            ]
            if isinstance(history, list)
            else []
        )
        return {
            "latest": latest_snapshot,
            "history": history_snapshots,
        }
    if account and isinstance(account.delivery_snapshots, dict):
        latest = account.delivery_snapshots.get("latest")
        history = account.delivery_snapshots.get("history")
        latest_snapshot = _coerce_snapshot(latest) if isinstance(latest, dict) else None
        history_snapshots = (
            [
                snapshot
                for snapshot in (
                    _coerce_snapshot(entry) for entry in history if isinstance(entry, dict)
                )
                if snapshot is not None
            ]
            if isinstance(history, list)
            else []
        )
        return {
            "latest": latest_snapshot,
            "history": history_snapshots,
        }
    return {"latest": None, "history": []}


_DELIVERY_PROOF_METRIC_METADATA: dict[str, dict[str, str]] = {
    "followerCount": {"label": "Follower lift", "unit": "followers"},
    "avgViewCount": {"label": "Average views", "unit": "views"},
    "avgEngagementRate": {"label": "Engagement rate", "unit": "%"},
}


def _extract_numeric_metrics(payload: Any) -> dict[str, float]:
    record = _as_mapping(payload)
    if not record:
        return {}
    if isinstance(record.get("metrics"), dict):
        record = _as_mapping(record.get("metrics")) or record
    metrics: dict[str, float] = {}
    for key, value in record.items():
        number = _to_float(value)
        if number is None:
            continue
        metrics[key] = number
    return metrics


def _extract_snapshot_payload(payload: Any) -> dict[str, Any] | None:
    record = _as_mapping(payload)
    if not record:
        return None
    latest = record.get("latest")
    if isinstance(latest, dict):
        return latest
    history = record.get("history")
    if isinstance(history, list):
        for entry in reversed(history):
            if isinstance(entry, dict):
                return entry
    return None


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    return None


def _format_compact(value: float | None, *, unit: str | None = None, signed: bool = True) -> str | None:
    if value is None:
        return None
    magnitude = abs(value)
    if magnitude >= 1_000_000:
        formatted = f"{value / 1_000_000:.1f}M"
    elif magnitude >= 1_000:
        formatted = f"{value / 1_000:.1f}k"
    elif magnitude >= 1:
        formatted = f"{value:.0f}"
    else:
        formatted = f"{value:.2f}"
    if signed and value > 0:
        formatted = f"+{formatted}"
    if unit:
        return f"{formatted} {unit}".strip()
    return formatted


def _format_percent(value: float | None, *, signed: bool = True) -> str | None:
    if value is None:
        return None
    pct = value * 100
    formatted = f"{pct:.1f}%"
    if signed and pct > 0:
        formatted = f"+{formatted}"
    return formatted


def _extract_platform(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("platform", "platformType", "platform_type"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None
    if isinstance(value, list):
        for entry in value:
            platform = _extract_platform(entry)
            if platform:
                return platform
    return None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _as_mapping(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None

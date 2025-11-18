"""Utilities for dispatching weekly digest notifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote_plus
from uuid import UUID

from loguru import logger as app_logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.core.settings import get_settings
from smplat_api.models.fulfillment import (
    FulfillmentProviderOrder,
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
)
from smplat_api.models.notification import NotificationPreference
from smplat_api.models.order import Order, OrderItem, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.analytics.experiment_analytics import (
    ExperimentAnalyticsService,
    ExperimentConversionDigest,
)
from smplat_api.services.provider_telemetry import (
    ProviderAutomationTelemetrySummary,
    summarize_provider_orders,
)
from .service import NotificationService


@dataclass
class DigestContext:
    user: User
    highlighted_orders: Sequence[Order]
    pending_actions: Sequence[str]
    conversion_snapshot: list[dict[str, object]]
    automation_actions: list[dict[str, object]]
    conversion_cursor: str | None
    conversion_href: str
    provider_telemetry: ProviderAutomationTelemetrySummary | None
    workflow_telemetry: Mapping[str, Any] | None


class WeeklyDigestDispatcher:
    """Aggregate customer activity and send weekly digest notifications."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        notification_service: NotificationService | None = None,
    ) -> None:
        self._session = session
        self._notifications = notification_service or NotificationService(session)
        self._frontend_url = get_settings().frontend_url.rstrip("/")

    async def run(self) -> int:
        """Send weekly digest emails to eligible users.

        Returns:
            Number of digests dispatched.
        """
        digests_sent = 0
        conversion_snapshot, conversion_cursor = await self._build_conversion_snapshot(limit=3)
        automation_actions, workflow_summary = await self._fetch_guardrail_auto_actions(limit=5)
        conversion_href = self._build_conversion_link(conversion_cursor)
        for context in await self._gather_contexts(
            conversion_snapshot,
            automation_actions,
            workflow_summary,
            conversion_cursor,
            conversion_href,
        ):
            if context.user.email is None:
                continue

            if not context.highlighted_orders and not context.pending_actions:
                # Skip empty digests to avoid noisy emails.
                continue

            await self._notifications.send_weekly_digest(
                context.user,
                highlighted_orders=context.highlighted_orders,
                pending_actions=context.pending_actions,
                conversion_metrics=context.conversion_snapshot,
                automation_actions=context.automation_actions,
                conversion_cursor=context.conversion_cursor,
                conversion_href=context.conversion_href,
                provider_telemetry=context.provider_telemetry,
                workflow_telemetry=context.workflow_telemetry,
            )
            digests_sent += 1

        if digests_sent:
            app_logger.info("Weekly digests dispatched", count=digests_sent)
        else:
            app_logger.info("Weekly digest run completed with no outgoing messages")
        return digests_sent

    async def _gather_contexts(
        self,
        conversion_snapshot: list[dict[str, object]],
        automation_actions: list[dict[str, object]],
        workflow_summary: Mapping[str, Any] | None,
        conversion_cursor: str | None,
        conversion_href: str,
    ) -> list[DigestContext]:
        result = await self._session.execute(
            select(User)
            .join(NotificationPreference, NotificationPreference.user_id == User.id)
            .where(
                NotificationPreference.marketing_messages.is_(True),
                User.status == UserStatusEnum.ACTIVE,
                User.role == UserRoleEnum.CLIENT,
            )
            .order_by(User.created_at)
        )
        users: Iterable[User] = result.scalars().all()

        contexts: list[DigestContext] = []
        for user in users:
            orders = await self._load_orders(user)
            provider_orders_map = await self._load_provider_orders_for_orders([order.id for order in orders])
            highlighted = self._select_highlighted_orders(orders)
            pending_actions = self._build_pending_actions(orders)
            provider_orders: list[FulfillmentProviderOrder] = []
            for order in highlighted:
                provider_orders.extend(provider_orders_map.get(order.id, []))
            provider_summary = summarize_provider_orders(provider_orders)
            provider_telemetry = provider_summary if provider_summary.total_orders > 0 else None
            contexts.append(
                DigestContext(
                    user=user,
                    highlighted_orders=highlighted,
                    pending_actions=pending_actions,
                    conversion_snapshot=conversion_snapshot,
                    automation_actions=automation_actions,
                    workflow_telemetry=workflow_summary,
                    conversion_cursor=conversion_cursor,
                    conversion_href=conversion_href,
                    provider_telemetry=provider_telemetry,
                )
            )
        return contexts

    async def _load_orders(self, user: User) -> list[Order]:
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.fulfillment_tasks))
            .where(Order.user_id == user.id)
            .order_by(Order.updated_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def _load_provider_orders_for_orders(
        self,
        order_ids: Sequence[UUID],
    ) -> dict[UUID, list[FulfillmentProviderOrder]]:
        if not order_ids:
            return {}
        stmt = (
            select(FulfillmentProviderOrder)
            .where(FulfillmentProviderOrder.order_id.in_(order_ids))
            .order_by(FulfillmentProviderOrder.created_at.desc())
        )
        result = await self._session.execute(stmt)
        grouped: dict[UUID, list[FulfillmentProviderOrder]] = {order_id: [] for order_id in order_ids}
        for provider_order in result.scalars():
            grouped.setdefault(provider_order.order_id, []).append(provider_order)
        return grouped

    def _select_highlighted_orders(self, orders: Sequence[Order]) -> list[Order]:
        prioritized = [
            order
            for order in orders
            if order.status
            and order.status
            in {
                OrderStatusEnum.ON_HOLD,
                OrderStatusEnum.ACTIVE,
                OrderStatusEnum.PROCESSING,
            }
        ]

        if not prioritized:
            prioritized = list(orders)

        # Limit to the 5 most relevant orders for the digest.
        return list(prioritized[:5])

    def _build_pending_actions(self, orders: Sequence[Order]) -> list[str]:
        on_hold = sum(1 for order in orders if order.status == OrderStatusEnum.ON_HOLD)

        failed_tasks = 0
        pending_tasks = 0
        for order in orders:
            for item in getattr(order, "items", []):
                tasks: Iterable[FulfillmentTask] = getattr(item, "fulfillment_tasks", [])
                for task in tasks:
                    if task.status == FulfillmentTaskStatusEnum.FAILED:
                        failed_tasks += 1
                    elif task.status == FulfillmentTaskStatusEnum.PENDING:
                        pending_tasks += 1

        pending_messages: list[str] = []
        if on_hold:
            pending_messages.append(f"{on_hold} order(s) are currently on hold.")
        if failed_tasks:
            pending_messages.append(f"{failed_tasks} fulfillment task(s) need review.")
        if pending_tasks:
            pending_messages.append(f"{pending_tasks} fulfillment task(s) are waiting to start.")

        return pending_messages

    def _build_conversion_link(self, cursor: str | None) -> str:
        base = self._frontend_url or "http://localhost:3000"
        base = base.rstrip("/")
        if cursor:
            return f"{base}/admin/reports?conversionCursor={quote_plus(cursor)}#experiment-analytics"
        return f"{base}/admin/reports#experiment-analytics"

    async def _build_conversion_snapshot(self, limit: int = 3) -> tuple[list[dict[str, object]], str | None]:
        """Aggregate top experiment conversions for weekly digest context."""
        service = ExperimentAnalyticsService(self._session)
        try:
            snapshot = await service.fetch_conversion_snapshot(limit=limit)
        except Exception as exc:  # pragma: no cover - defensive logging
            app_logger.warning("Unable to load experiment conversion snapshot for digest", error=str(exc))
            return [], None
        return [self._serialize_conversion_metric(metric) for metric in snapshot.metrics], snapshot.cursor

    @staticmethod
    def _serialize_conversion_metric(metric: ExperimentConversionDigest) -> dict[str, object]:
        return {
            "slug": metric.slug,
            "orderCurrency": metric.order_currency,
            "orderTotal": float(metric.order_total),
            "orderCount": metric.order_count,
            "journeyCount": metric.journey_count,
            "loyaltyPoints": metric.loyalty_points,
            "lastActivity": metric.last_activity,
        }

    async def _fetch_guardrail_auto_actions(self, limit: int = 5) -> tuple[list[dict[str, object]], Mapping[str, Any] | None]:
        from smplat_api.services.fulfillment.provider_automation_run_service import (
            ProviderAutomationRunService,
            ProviderAutomationRunTypeEnum,
        )

        service = ProviderAutomationRunService(self._session)
        try:
            runs = await service.list_recent_runs(limit=1, run_type=ProviderAutomationRunTypeEnum.ALERT)
        except Exception as exc:  # pragma: no cover - defensive logging
            app_logger.warning("Failed to load automation runs for weekly digest", error=str(exc))
            return [], None

        if not runs:
            return [], None

        latest_run = runs[0]
        metadata = latest_run.metadata_json if isinstance(latest_run.metadata_json, Mapping) else {}
        summary = latest_run.summary if isinstance(latest_run.summary, Mapping) else {}
        ran_at = latest_run.created_at.isoformat() if latest_run.created_at else None

        workflow_summary = metadata.get("workflowTelemetry") or summary.get("workflowTelemetry")
        actions: list[dict[str, object]] = []
        actions.extend(self._normalize_guardrail_action_list(metadata.get("autoPausedProviders") or summary.get("autoPausedProviders"), "pause", ran_at))
        actions.extend(self._normalize_guardrail_action_list(metadata.get("autoResumedProviders") or summary.get("autoResumedProviders"), "resume", ran_at))
        if not actions:
            paused_count = summary.get("autoPaused")
            resumed_count = summary.get("autoResumed")
            if paused_count or resumed_count:
                actions.append(
                    {
                        "providerName": None,
                        "providerId": None,
                        "action": "pause" if (paused_count or 0) >= (resumed_count or 0) else "resume",
                        "notes": f"{paused_count or 0} paused / {resumed_count or 0} resumed automatically",
                        "reasons": [],
                        "ranAt": ran_at,
                    }
                )
        return actions[:limit], workflow_summary if isinstance(workflow_summary, Mapping) else None

    def _normalize_guardrail_action_list(
        self,
        payload: Any,
        action: str,
        ran_at: str | None,
    ) -> list[dict[str, object]]:
        if not isinstance(payload, Iterable) or isinstance(payload, (str, bytes)):
            return []
        normalized: list[dict[str, object]] = []
        for entry in payload:
            if not isinstance(entry, Mapping):
                continue
            provider_id_raw = entry.get("providerId")
            provider_id = str(provider_id_raw).strip() if provider_id_raw else ""
            provider_name_raw = entry.get("providerName") or provider_id
            provider_name = str(provider_name_raw).strip() or provider_id or None
            reasons_raw = entry.get("reasons")
            reasons = (
                [str(reason).strip() for reason in reasons_raw if str(reason).strip()]
                if isinstance(reasons_raw, Iterable) and not isinstance(reasons_raw, (str, bytes))
                else []
            )
            notes = entry.get("notes")
            normalized.append(
                {
                    "providerName": provider_name or provider_id or "Provider",
                    "providerId": provider_id or None,
                    "action": action,
                    "notes": notes if isinstance(notes, str) and notes.strip() else None,
                    "reasons": reasons,
                    "ranAt": ran_at,
                }
            )
        return normalized

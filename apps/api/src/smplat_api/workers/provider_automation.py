"""Worker utilities for fulfillment provider order replays."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Mapping
from uuid import uuid4

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.services.fulfillment import ProviderAutomationService
from smplat_api.services.orders.state_machine import (
    OrderStateActorTypeEnum,
    OrderStateEventTypeEnum,
    OrderStateMachine,
)

SessionFactory = Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]]
AutomationFactory = Callable[[AsyncSession], ProviderAutomationService]
Clock = Callable[[], datetime]


class ProviderOrderReplayWorker:
    """Executes scheduled provider order replays."""

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        automation_factory: AutomationFactory | None = None,
        clock: Clock | None = None,
        interval_seconds: int | None = None,
        limit: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._automation_factory = automation_factory or (lambda session: ProviderAutomationService(session))
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.interval_seconds = interval_seconds or 300
        self._limit = limit or 25
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False

    async def process_scheduled(self, *, limit: int | None = None) -> dict[str, int]:
        """Trigger due scheduled replays and persist execution metadata."""

        effective_limit = limit or self._limit
        if effective_limit <= 0:
            return {"processed": 0, "succeeded": 0, "failed": 0}

        session = await self._ensure_session()
        summary = {"processed": 0, "succeeded": 0, "failed": 0}

        async with session as db:
            automation = self._automation_factory(db)
            machine = OrderStateMachine(db)
            stmt = (
                select(FulfillmentProviderOrder)
                .where(FulfillmentProviderOrder.payload.isnot(None))
                .order_by(FulfillmentProviderOrder.updated_at.asc())
                .limit(max(effective_limit * 4, 50))
            )
            result = await db.execute(stmt)
            orders = result.scalars().all()

            for order in orders:
                due_entries = self._collect_due_entries(order)
                for entry in due_entries:
                    if summary["processed"] >= effective_limit:
                        break
                    summary["processed"] += 1
                    requested_amount = self._safe_float(entry.get("requestedAmount"))
                    entry_id = entry.get("id")
                    try:
                        replay_entry = await automation.replay_provider_order(order, amount=requested_amount)
                        self._mark_schedule_entry(
                            order,
                            entry_id,
                            status="executed",
                            performed_at=self._clock().isoformat(),
                            response=replay_entry,
                        )
                        summary["succeeded"] += 1
                        rule_ids = replay_entry.get("ruleIds")
                        rule_labels = ProviderAutomationService._summarize_rule_labels(
                            rule_ids,
                            replay_entry.get("ruleMetadata"),
                        )
                        logger.info(
                            "Provider scheduled replay executed",
                            provider_order_id=str(order.id),
                            schedule_id=entry_id,
                            rule_ids=rule_ids,
                            rule_labels=rule_labels,
                        )
                        await self._record_timeline_event(
                            machine,
                            order,
                            event_type=OrderStateEventTypeEnum.REPLAY_EXECUTED,
                            actor_type=OrderStateActorTypeEnum.AUTOMATION,
                            metadata=ProviderAutomationService.build_timeline_metadata(
                                order,
                                entry=replay_entry,
                                extra={
                                    "scheduleId": entry_id,
                                    "trigger": "scheduled_replay",
                                },
                            ),
                            notes="Automation replay executed from schedule",
                        )
                    except Exception as exc:
                        failure_entry = self._record_failed_replay(
                            order,
                            requested_amount=requested_amount,
                            error=str(exc),
                        )
                        self._mark_schedule_entry(
                            order,
                            entry_id,
                            status="failed",
                            performed_at=self._clock().isoformat(),
                            response={"error": str(exc)},
                        )
                        summary["failed"] += 1
                        schedule_rule_ids = entry.get("ruleIds")
                        schedule_rule_labels = ProviderAutomationService._summarize_rule_labels(
                            schedule_rule_ids,
                            entry.get("ruleMetadata"),
                        )
                        logger.warning(
                            "Provider scheduled replay failed",
                            provider_order_id=str(order.id),
                            schedule_id=entry_id,
                            error=str(exc),
                            rule_ids=schedule_rule_ids,
                            rule_labels=schedule_rule_labels,
                        )
                        await self._record_timeline_event(
                            machine,
                            order,
                            event_type=OrderStateEventTypeEnum.REPLAY_EXECUTED,
                            actor_type=OrderStateActorTypeEnum.AUTOMATION,
                            metadata=ProviderAutomationService.build_timeline_metadata(
                                order,
                                entry=failure_entry,
                                extra={
                                    "scheduleId": entry_id,
                                    "trigger": "scheduled_replay",
                                    "error": str(exc),
                                },
                            ),
                            notes="Automation replay attempt failed",
                        )

                if summary["processed"] >= effective_limit:
                    break

            if summary["processed"]:
                await db.commit()
            else:
                await db.rollback()

        backlog_metrics = await automation.calculate_replay_backlog_metrics()
        summary["scheduledBacklog"] = backlog_metrics.get("scheduledBacklog", 0)
        next_eta = backlog_metrics.get("nextScheduledAt")
        if next_eta:
            summary["nextScheduledAt"] = next_eta
        return summary

    async def run_once(self, *, limit: int | None = None) -> dict[str, int]:
        """Run a single iteration respecting the configured limit."""

        return await self.process_scheduled(limit=limit)

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        self.is_running = True
        logger.info(
            "Provider order replay worker started",
            interval_seconds=self.interval_seconds,
            limit=self._limit,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        logger.info("Provider order replay worker stopped")

    def _collect_due_entries(self, order: FulfillmentProviderOrder) -> list[dict[str, Any]]:
        payload = self._safe_payload(order.payload)
        schedule = payload.get("scheduledReplays")
        if not isinstance(schedule, list):
            return []

        due: list[dict[str, Any]] = []
        now = self._clock()
        for entry in schedule:
            if not isinstance(entry, dict):
                continue
            if entry.get("status", "scheduled") != "scheduled":
                continue
            entry_id = entry.get("id")
            if not entry_id:
                continue
            scheduled_for = self._parse_datetime(entry.get("scheduledFor"))
            if scheduled_for is None or scheduled_for <= now:
                due.append(entry)
        return due

    def _mark_schedule_entry(
        self,
        order: FulfillmentProviderOrder,
        entry_id: str | None,
        *,
        status: str | None = None,
        performed_at: str | None = None,
        response: Mapping[str, Any] | None = None,
    ) -> None:
        if not entry_id:
            return

        payload = self._safe_payload(order.payload)
        schedule = payload.get("scheduledReplays")
        if not isinstance(schedule, list):
            return
        for entry in schedule:
            if not isinstance(entry, dict):
                continue
            if entry.get("id") != entry_id:
                continue
            if status:
                entry["status"] = status
            if performed_at:
                entry["performedAt"] = performed_at
            if response is not None:
                entry["response"] = response
            if not entry.get("ruleMetadata"):
                _, rule_metadata = ProviderAutomationService._extract_rule_context(payload)
                if rule_metadata:
                    entry["ruleMetadata"] = rule_metadata
            break
        self._apply_payload(order, payload)

    def _record_failed_replay(
        self,
        order: FulfillmentProviderOrder,
        *,
        requested_amount: float | None,
        error: str,
    ) -> dict[str, Any]:
        payload = self._safe_payload(order.payload)
        rule_ids, rule_metadata = ProviderAutomationService._extract_rule_context(payload)
        entry = {
            "id": str(uuid4()),
            "requestedAmount": requested_amount,
            "currency": order.currency,
            "performedAt": self._clock().isoformat(),
            "status": "failed",
            "response": {"error": error},
        }
        if rule_ids:
            entry["ruleIds"] = rule_ids
        if rule_metadata:
            entry["ruleMetadata"] = rule_metadata
        replays = payload.get("replays")
        if isinstance(replays, list):
            replays.append(entry)
        else:
            payload["replays"] = [entry]
        self._apply_payload(order, payload)
        return entry

    @staticmethod
    def _safe_payload(payload: Mapping[str, Any] | None) -> dict[str, Any]:
        return dict(payload) if isinstance(payload, Mapping) else {}

    @staticmethod
    def _safe_float(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        cleaned = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(cleaned)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session

    @staticmethod
    def _apply_payload(order: FulfillmentProviderOrder, payload: dict[str, Any]) -> None:
        order.payload = payload
        flag_modified(order, "payload")

    async def _record_timeline_event(
        self,
        machine: OrderStateMachine,
        provider_order: FulfillmentProviderOrder,
        *,
        event_type: OrderStateEventTypeEnum,
        actor_type: OrderStateActorTypeEnum,
        metadata: Mapping[str, Any],
        notes: str | None = None,
    ) -> None:
        if not provider_order.order_id:
            return
        try:
            await machine.record_event(
                order_id=provider_order.order_id,
                event_type=event_type,
                actor_type=actor_type,
                actor_id=str(provider_order.id),
                actor_label=None,
                notes=notes,
                metadata=dict(metadata),
            )
        except Exception:
            logger.exception(
                "Failed to record automation replay timeline event",
                order_id=str(provider_order.order_id),
                event_type=event_type.value,
            )

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.process_scheduled()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Provider order replay iteration failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue


__all__ = ["ProviderOrderReplayWorker"]

"""CLI + helpers for provider order replay workflows.

This module exists so external schedulers/queues (Celery, BullMQ, cron) can
trigger the same replay logic without importing FastAPI or the full worker
stack.  It keeps the session factory injectable for tests and queue runners.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
from typing import Any, Callable, Mapping
from uuid import UUID

from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.db.session import async_session
from smplat_api.services.fulfillment import (
    ProviderAutomationService,
    ProviderAutomationRunService,
    ProviderAutomationRunTypeEnum,
)
from smplat_api.services.fulfillment.automation_status_service import AutomationStatusService
from smplat_api.services.orders.state_machine import (
    OrderStateActorTypeEnum,
    OrderStateEventTypeEnum,
    OrderStateMachine,
)
from smplat_api.workers.provider_automation import AutomationFactory, ProviderOrderReplayWorker, SessionFactory


def _default_session_factory() -> SessionFactory:
    return async_session()


async def run_scheduled_replays(
    *,
    limit: int | None = None,
    session_factory: SessionFactory | None = None,
    automation_factory: AutomationFactory | None = None,
) -> dict[str, int]:
    """Process due scheduled replays once and return the worker summary."""

    factory = session_factory or _default_session_factory
    worker = ProviderOrderReplayWorker(
        factory,
        automation_factory=automation_factory,
        interval_seconds=settings.provider_replay_worker_interval_seconds,
        limit=settings.provider_replay_worker_limit,
    )
    summary = await worker.process_scheduled(limit=limit)
    logger.info("Scheduled provider replays processed", summary=summary)
    await _record_replay_status(summary)
    await _record_run_history(
        ProviderAutomationRunTypeEnum.REPLAY,
        summary,
        session_factory=factory,
    )
    return summary


async def replay_single_order(
    *,
    provider_id: str,
    provider_order_id: UUID,
    amount: float | None = None,
    session_factory: SessionFactory | None = None,
    automation_factory: Callable[[Any], ProviderAutomationService] | None = None,
) -> dict[str, Any]:
    """Replay a specific provider order immediately."""

    async_factory = session_factory or _default_session_factory
    async with async_factory() as session:  # type: ignore[misc]
        automation = automation_factory(session) if automation_factory else ProviderAutomationService(session)
        provider_order = await automation.get_provider_order(provider_id, provider_order_id)
        if not provider_order:
            raise ValueError("Provider order not found")
        entry = await automation.replay_provider_order(provider_order, amount=amount)
        service = AutomationStatusService()
        try:
            await service.record_replay_summary(
                {
                    "processed": 1,
                    "succeeded": 1 if entry.get("status") == "executed" else 0,
                    "failed": 1 if entry.get("status") == "failed" else 0,
                }
            )
        except Exception as exc:  # pragma: no cover - best effort logging
            logger.warning("Failed to record replay status", error=str(exc))
        rule_ids = entry.get("ruleIds")
        rule_labels = ProviderAutomationService._summarize_rule_labels(
            rule_ids,
            entry.get("ruleMetadata"),
        )
        logger.info(
            "Provider order replayed",
            provider_id=provider_id,
            provider_order_id=str(provider_order_id),
            status=entry.get("status"),
            rule_ids=rule_ids,
            rule_labels=rule_labels,
        )
        if provider_order.order_id:
            machine = OrderStateMachine(session)
            metadata = ProviderAutomationService.build_timeline_metadata(
                provider_order,
                entry=entry,
                extra={"trigger": "cli_replay"},
            )
            try:
                await machine.record_event(
                    order_id=provider_order.order_id,
                    event_type=OrderStateEventTypeEnum.REPLAY_EXECUTED,
                    actor_type=OrderStateActorTypeEnum.AUTOMATION,
                    actor_id=str(provider_order.id),
                    actor_label=None,
                    notes="Automation replay executed via CLI",
                    metadata=metadata,
                )
            except Exception:
                logger.exception("Failed to record CLI replay timeline event", order_id=str(provider_order.order_id))
        return entry


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Provider automation replay utilities.")
    sub = parser.add_subparsers(dest="command", required=True)

    scheduled = sub.add_parser("scheduled", help="Process due scheduled replays once.")
    scheduled.add_argument("--limit", type=int, default=None, help="Max scheduled entries to process.")

    replay = sub.add_parser("replay", help="Replay a single provider order immediately.")
    replay.add_argument("--provider-id", required=True)
    replay.add_argument("--provider-order-id", required=True, help="UUID of the provider order row.")
    replay.add_argument("--amount", type=float, default=None, help="Optional override for requested amount.")

    return parser


async def _async_main(args: argparse.Namespace) -> None:
    if args.command == "scheduled":
        await run_scheduled_replays(limit=args.limit)
    elif args.command == "replay":
        provider_order_id = UUID(args.provider_order_id)
        await replay_single_order(
            provider_id=args.provider_id,
            provider_order_id=provider_order_id,
            amount=args.amount,
        )
    else:  # pragma: no cover - argparse guards this.
        raise ValueError(f"Unsupported command {args.command}")


def cli() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    asyncio.run(_async_main(args))


if __name__ == "__main__":  # pragma: no cover
    cli()


def run_scheduled_replays_sync(
    *,
    limit: int | None = None,
    session_factory: SessionFactory | None = None,
    automation_factory: AutomationFactory | None = None,
) -> dict[str, int]:
    """Synchronous helper so Celery/cron jobs can reuse the async worker."""

    return asyncio.run(
        run_scheduled_replays(
            limit=limit,
            session_factory=session_factory,
            automation_factory=automation_factory,
        )
    )


async def _record_replay_status(summary: Mapping[str, Any]) -> None:
    service = AutomationStatusService()
    try:
        await service.record_replay_summary(summary)
    except Exception as exc:  # pragma: no cover - metrics shouldn't break worker
        logger.warning("Failed to record replay status", error=str(exc))


async def _record_run_history(
    run_type: ProviderAutomationRunTypeEnum,
    summary: Mapping[str, Any],
    *,
    session_factory: SessionFactory,
    status: str = "success",
    metadata: Mapping[str, Any] | None = None,
) -> None:
    try:
        session_ctx = session_factory()  # type: ignore[call-arg]
        async with session_ctx as session:  # type: ignore[attr-defined]
            service = ProviderAutomationRunService(session)
            await service.record_run(
                run_type=run_type,
                summary=dict(summary),
                status=status,
                metadata=dict(metadata) if metadata else None,
                backlog_total=_safe_int(summary.get("scheduledBacklog")),
                next_scheduled_at=_parse_timestamp(summary.get("nextScheduledAt")),
                alerts_sent=_safe_int(summary.get("alertsSent")),
            )
    except Exception as exc:  # pragma: no cover - don't break workers on metrics failures
        logger.warning("Failed to record automation run history", error=str(exc), run_type=run_type.value)


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None

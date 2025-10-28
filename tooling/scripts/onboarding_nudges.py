"""Dispatch concierge onboarding nudges for idle journeys.

Designed for cron/automation contexts. Emits manual log entries even when
notification preferences block delivery so operators can audit SLA coverage.

Example:
    python tooling/scripts/onboarding_nudges.py --idle-hours 24 --limit 50
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dispatch concierge onboarding nudges")
    parser.add_argument(
        "--idle-hours",
        type=int,
        default=24,
        help="Minimum idle window (in hours) before nudges trigger.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum number of journeys to evaluate in this run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate delivery using the in-memory backend without sending real emails.",
    )
    return parser.parse_args()


async def _run(idle_hours: int, limit: int, dry_run: bool) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.models import Order  # type: ignore import-position
    from smplat_api.models.onboarding import (  # type: ignore import-position
        OnboardingActorType,
        OnboardingInteractionChannel,
    )
    from smplat_api.services.notifications import NotificationService  # type: ignore import-position
    from smplat_api.services.orders import OnboardingService  # type: ignore import-position

    async with async_session() as session:
        notification_service = NotificationService(session)
        if dry_run:
            notification_service.use_in_memory_backend()

        service = OnboardingService(session)
        opportunities = await service.compute_nudge_opportunities(
            idle_threshold_hours=idle_hours,
            limit=limit,
        )
        dispatched = 0

        for opportunity in opportunities:
            journey = await service.fetch_journey_by_id(opportunity.journey_id)
            if journey is None:
                continue

            task = None
            if opportunity.task_id:
                task = next((candidate for candidate in journey.tasks if candidate.id == opportunity.task_id), None)

            order = await session.get(Order, opportunity.order_id)
            if order is None:
                continue

            delivered = False
            if opportunity.recommended_channel == OnboardingInteractionChannel.EMAIL:
                delivered = await notification_service.send_onboarding_concierge_nudge(
                    order,
                    subject=opportunity.subject,
                    message_text=opportunity.message,
                    triggered_by="automation",
                )

            await service.log_nudge(
                journey,
                task=task,
                channel=opportunity.recommended_channel,
                actor=OnboardingActorType.SYSTEM,
                triggered_by="automation",
                subject=opportunity.subject,
                message=opportunity.message,
                dedupe_key=opportunity.dedupe_key,
                delivery_status="sent" if delivered else "skipped",
                metadata={
                    "automated": True,
                    "idle_hours": opportunity.idle_hours,
                    "dry_run": dry_run,
                },
            )

            if delivered:
                dispatched += 1

        await session.commit()
        return dispatched


def main() -> int:
    args = parse_args()
    count = asyncio.run(_run(args.idle_hours, args.limit, args.dry_run))
    logger.success(
        "Onboarding nudge automation run complete",
        dispatched=count,
        idle_hours=args.idle_hours,
        limit=args.limit,
        dry_run=args.dry_run,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Trigger weekly digest notifications for eligible users.

Intended usage: schedule via cron or a workflow runner (GitHub Actions, etc).

Example:
    python tooling/scripts/run_weekly_digest.py

Use `--dry-run` to exercise aggregation and template rendering without sending
real emails (messages are captured by the in-memory backend).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dispatch weekly digest notifications")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use the in-memory email backend instead of SMTP delivery.",
    )
    return parser.parse_args()


async def _run(dry_run: bool) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.services.notifications import NotificationService  # type: ignore import-position
    from smplat_api.services.notifications.digest_dispatcher import (  # type: ignore import-position
        WeeklyDigestDispatcher,
    )

    async with async_session() as session:
        notification_service: NotificationService | None = None
        if dry_run:
            notification_service = NotificationService(session)
            notification_service.use_in_memory_backend()

        dispatcher = WeeklyDigestDispatcher(session, notification_service=notification_service)
        count = await dispatcher.run()
        return count


def main() -> int:
    args = parse_args()
    count = asyncio.run(_run(args.dry_run))
    logger.success("Weekly digest run completed", digests_sent=count, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

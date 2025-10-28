"""Trigger hosted session recovery automation once.

Intended usage: schedule via cron or manual invocation when performing
ad-hoc recovery sweeps.

Example:
    python tooling/scripts/run_hosted_session_recovery.py --trigger cron
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Execute hosted session recovery once")
    parser.add_argument(
        "--trigger",
        default="manual",
        help="Label recorded in run metadata to describe the invocation source.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Override the number of sessions processed in this sweep.",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=None,
        help="Override the retry cap enforced during this sweep.",
    )
    return parser.parse_args()


async def _run(trigger: str, limit: int | None, max_attempts: int | None) -> dict[str, int]:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.core.settings import settings  # type: ignore import-position
    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.workers import HostedSessionRecoveryWorker  # type: ignore import-position

    worker = HostedSessionRecoveryWorker(
        async_session,  # type: ignore[arg-type]
        interval_seconds=settings.hosted_recovery_interval_seconds,
        limit=limit or settings.hosted_recovery_limit,
        max_attempts=max_attempts or settings.hosted_recovery_max_attempts,
        trigger_label=settings.hosted_recovery_trigger_label,
    )
    summary = await worker.run_once(triggered_by=trigger)
    return summary


def main() -> int:
    args = parse_args()
    summary = asyncio.run(_run(args.trigger, args.limit, args.max_attempts))
    logger.success(
        "Hosted session recovery run completed",
        scheduled=summary.get("scheduled", 0),
        notified=summary.get("notified", 0),
        trigger=args.trigger,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

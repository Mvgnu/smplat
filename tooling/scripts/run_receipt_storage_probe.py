#!/usr/bin/env python3
"""Execute the receipt storage probe once for cron/CI workflows."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the receipt storage sentinel probe")
    parser.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Exit with status 1 when the probe fails.",
    )
    return parser.parse_args()


async def _run_once() -> bool:
    repo_root = Path(__file__).resolve().parents[2]
    api_src = repo_root / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))

    from smplat_api.db.session import async_session  # type: ignore import-position
    from smplat_api.services.orders.receipt_storage_probe import (  # type: ignore import-position
        ReceiptStorageProbeService,
    )

    async with async_session() as session:
        service = ReceiptStorageProbeService(session)
        result = await service.run_probe()
        logger.info(
            "Receipt storage probe complete",
            success=result.success,
            detail=result.detail,
            sentinel_key=result.sentinel_key,
        )
        return result.success


def main() -> int:
    args = parse_args()
    success = asyncio.run(_run_once())
    if not success and args.fail_on_error:
        logger.error("Receipt storage probe reported a failure")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

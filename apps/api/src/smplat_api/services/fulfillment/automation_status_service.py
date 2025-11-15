from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Mapping

from loguru import logger
from redis.asyncio import Redis

from smplat_api.core.settings import settings


class AutomationStatusService:
    """Stores and retrieves provider automation run metadata."""

    _REPLAY_KEY = "provider_automation:status:replay"
    _ALERT_KEY = "provider_automation:status:alerts"

    def __init__(self, redis_client: Redis | None = None) -> None:
        self._redis = redis_client or Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )

    async def record_replay_summary(self, summary: Mapping[str, Any]) -> None:
        await self._store(self._REPLAY_KEY, summary)

    async def record_alert_summary(self, summary: Mapping[str, Any]) -> None:
        await self._store(self._ALERT_KEY, summary)

    async def get_status(self) -> dict[str, Any | None]:
        return {
            "replay": await self._fetch(self._REPLAY_KEY),
            "alerts": await self._fetch(self._ALERT_KEY),
        }

    async def _store(self, key: str, summary: Mapping[str, Any]) -> None:
        payload = {
            "ranAt": datetime.now(timezone.utc).isoformat(),
            "summary": summary,
        }
        await self._redis.set(key, json.dumps(payload))

    async def _fetch(self, key: str) -> dict[str, Any] | None:
        raw = await self._redis.get(key)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Failed to decode automation status payload", key=key)
            return None


__all__ = ["AutomationStatusService"]

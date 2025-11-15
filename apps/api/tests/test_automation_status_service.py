from __future__ import annotations

import pytest

from smplat_api.services.fulfillment.automation_status_service import AutomationStatusService


class FakeRedis:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str) -> None:
        self._store[key] = value

    async def get(self, key: str) -> str | None:
        return self._store.get(key)


@pytest.mark.asyncio
async def test_automation_status_service_records_and_fetches():
    redis = FakeRedis()
    service = AutomationStatusService(redis_client=redis)  # type: ignore[arg-type]

    await service.record_replay_summary({"processed": 1})
    await service.record_alert_summary({"alertsSent": 2})

    status = await service.get_status()
    assert status["replay"]["summary"]["processed"] == 1
    assert status["alerts"]["summary"]["alertsSent"] == 2

from __future__ import annotations

import pytest

from smplat_api.tasks.provider_alerts import run_provider_alerts


@pytest.fixture(autouse=True)
def _patch_alert_history(monkeypatch):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr("smplat_api.tasks.provider_alerts._record_alert_run_history", _noop)
    monkeypatch.setattr("smplat_api.tasks.provider_alerts._record_alert_status", _noop)


class StubAlertWorker:
    def __init__(self) -> None:
        self.calls = 0

    async def run_once(self):
        self.calls += 1
        return {
            "alerts": 2,
            "alertsSent": 2,
            "alertsDigest": [],
            "loadAlerts": 1,
            "loadAlertsDigest": [],
        }


@pytest.mark.asyncio
async def test_run_provider_alerts_invokes_worker_once():
    worker = StubAlertWorker()
    summary = await run_provider_alerts(worker=worker)
    assert summary["alerts"] == 2
    assert summary["loadAlerts"] == 1
    assert worker.calls == 1

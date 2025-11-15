from __future__ import annotations

import pytest

from smplat_api.celery_tasks import provider_automation as tasks
from smplat_api.core.settings import settings


def test_replay_task_skips_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "provider_replay_worker_enabled", False)
    result = tasks.run_provider_replay_batch()
    assert result["skipped"] is True
    assert result["processed"] == 0


def test_replay_task_invokes_helper(monkeypatch):
    monkeypatch.setattr(settings, "provider_replay_worker_enabled", True)

    captured = {}

    def fake_run(limit=None, session_factory=None, automation_factory=None):
        captured["limit"] = limit
        return {"processed": 2, "succeeded": 2, "failed": 0}

    monkeypatch.setattr(tasks, "run_scheduled_replays_sync", fake_run)

    result = tasks.run_provider_replay_batch(limit=5)
    assert result["processed"] == 2
    assert captured["limit"] == 5


def test_alert_task_skips_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "provider_automation_alert_worker_enabled", False)
    result = tasks.run_provider_alert_evaluation()
    assert result["skipped"] is True
    assert result["alertsSent"] == 0


def test_alert_task_invokes_helper(monkeypatch):
    monkeypatch.setattr(settings, "provider_automation_alert_worker_enabled", True)

    def fake_alerts(worker=None):
        return {"alertsSent": 1}

    monkeypatch.setattr(tasks, "run_provider_alerts_sync", fake_alerts)

    result = tasks.run_provider_alert_evaluation()
    assert result["alertsSent"] == 1

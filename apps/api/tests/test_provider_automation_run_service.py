from __future__ import annotations

import pytest

from datetime import datetime, timedelta, timezone

from smplat_api.services.fulfillment import (
    ProviderAutomationRunService,
    ProviderAutomationRunTypeEnum,
)


@pytest.mark.asyncio
async def test_provider_automation_run_service_records_history(session_factory):
    async with session_factory() as session:
        service = ProviderAutomationRunService(session)
        run = await service.record_run(
            run_type=ProviderAutomationRunTypeEnum.REPLAY,
            summary={"processed": 1},
        )
        runs = await service.list_recent_runs(limit=5, run_type=ProviderAutomationRunTypeEnum.REPLAY)
    assert runs
    assert runs[0].id == run.id


@pytest.mark.asyncio
async def test_run_service_to_status_payload_merges_optional_fields(session_factory):
    async with session_factory() as session:
        service = ProviderAutomationRunService(session)
        next_eta = datetime.now(timezone.utc)
        run = await service.record_run(
            run_type=ProviderAutomationRunTypeEnum.REPLAY,
            summary={"processed": 3},
            backlog_total=5,
            next_scheduled_at=next_eta,
            metadata={"alertsDigest": [{"providerId": "prov-a"}], "loadAlertsDigest": [{"presetId": "preset-1"}]},
        )
        payload = service.to_status_payload(run)

    assert payload["summary"]["scheduledBacklog"] == 5
    recorded_eta = datetime.fromisoformat(payload["summary"]["nextScheduledAt"])
    assert abs((recorded_eta - next_eta).total_seconds()) < 1
    assert payload["summary"]["alertsDigest"] == [{"providerId": "prov-a"}]
    assert payload["summary"]["loadAlertsDigest"] == [{"presetId": "preset-1"}]
    assert payload["metadata"] == {
        "alertsDigest": [{"providerId": "prov-a"}],
        "loadAlertsDigest": [{"presetId": "preset-1"}],
    }


@pytest.mark.asyncio
async def test_run_service_populates_auto_action_counts(session_factory):
    async with session_factory() as session:
        service = ProviderAutomationRunService(session)
        run = await service.record_run(
            run_type=ProviderAutomationRunTypeEnum.ALERT,
            summary={"alertsSent": 2},
            metadata={
                "autoPausedProviders": [
                    {"providerId": "prov-1", "providerName": "Alpha"},
                    {"providerId": "prov-2", "providerName": "Beta"},
                ],
                "autoResumedProviders": [{"providerId": "prov-3", "providerName": "Gamma"}],
            },
        )
        payload = service.to_status_payload(run)

    summary = payload["summary"]
    assert summary["autoPaused"] == 2
    assert summary["autoResumed"] == 1
    assert isinstance(summary["autoPausedProviders"], list)
    assert isinstance(summary["autoResumedProviders"], list)

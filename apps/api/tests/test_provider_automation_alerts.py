from __future__ import annotations

import json
import types

import httpx
import pytest
from sqlalchemy import select

from smplat_api.core.settings import Settings
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.models.provider_automation_run import ProviderAutomationRun
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.analytics.experiment_analytics import ExperimentConversionDigest
from smplat_api.services.fulfillment.provider_automation_alerts import (
    ProviderAutomationAlert,
    ProviderAutomationAlertEvaluator,
    ProviderAutomationAlertNotifier,
    ProviderLoadAlert,
)
from smplat_api.services.notifications.backend import InMemoryEmailBackend
from smplat_api.workers.provider_automation_alerts import ProviderAutomationAlertWorker
from smplat_api.tasks import provider_alerts


def _build_snapshot(
    *,
    provider_id: str = "prov-a",
    fails: int = 0,
    warns: int = 0,
    replay_failed: int = 0,
    replay_total: int = 0,
) -> ProviderAutomationSnapshotResponse:
    return ProviderAutomationSnapshotResponse.model_validate(
        {
            "aggregated": {
                "totalOrders": 0,
                "replays": {"total": 0, "executed": 0, "failed": 0, "scheduled": 0},
                "guardrails": {"evaluated": 0, "pass": 0, "warn": 0, "fail": 0},
                "guardrailHitsByService": {},
            },
            "providers": [
                {
                    "id": provider_id,
                    "name": "Provider A",
                    "telemetry": {
                        "totalOrders": 2,
                        "replays": {
                            "total": replay_total,
                            "executed": replay_total - replay_failed,
                            "failed": replay_failed,
                            "scheduled": 0,
                        },
                        "guardrails": {
                            "evaluated": fails + warns,
                            "pass": max(0, 2 - fails - warns),
                            "warn": warns,
                            "fail": fails,
                        },
                        "guardrailHitsByService": {
                            "svc-a": {"evaluated": fails + warns, "pass": 0, "warn": warns, "fail": fails}
                        },
                    },
                }
            ],
        }
    )


def test_alert_evaluator_flags_guardrail_and_replay_thresholds():
    snapshot = _build_snapshot(fails=2, warns=1, replay_failed=3, replay_total=4)
    evaluator = ProviderAutomationAlertEvaluator(
        guardrail_fail_threshold=1,
        guardrail_warn_threshold=2,
        replay_failure_threshold=2,
    )
    alerts = evaluator.evaluate(snapshot)
    assert len(alerts) == 1
    alert = alerts[0]
    assert "guardrail fail" in ", ".join(alert.reasons)
    assert alert.replay_failures == 3


@pytest.mark.asyncio
async def test_alert_notifier_sends_email_and_slack():
    snapshot = _build_snapshot(fails=1, warns=0, replay_failed=2, replay_total=3)
    evaluator = ProviderAutomationAlertEvaluator(
        guardrail_fail_threshold=1,
        guardrail_warn_threshold=5,
        replay_failure_threshold=2,
    )
    alerts = evaluator.evaluate(snapshot)

    base_settings = Settings()
    test_settings = base_settings.model_copy(
        update={
            "provider_automation_alert_email_recipients": ["ops@example.com"],
            "provider_automation_alert_slack_webhook_url": "https://hooks.example.invalid/slack",
            "provider_automation_alert_slack_channel": "#ops",
        }
    )

    email_backend = InMemoryEmailBackend()
    captured: dict[str, str] = {}

    async def slack_handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = request.content.decode()
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(slack_handler)
    load_alerts = [
        ProviderLoadAlert(
            provider_id="prov-b",
            provider_name="Provider B",
            preset_id="preset-growth",
            preset_label="Growth Sprint",
            service_id="svc-b",
            service_action="qa_support",
            currency="USD",
            short_window_days=7,
            long_window_days=90,
            short_share=0.85,
            long_share=0.35,
            share_delta=0.5,
            short_engagements=12,
            long_engagements=40,
            short_amount_total=600.0,
            long_amount_total=900.0,
            merchandising_url="https://admin.example.com/admin/merchandising?presetId=preset-growth",
            fulfillment_url="https://admin.example.com/admin/fulfillment/providers?providerId=prov-b",
            orders_url="https://admin.example.com/admin/orders?presetId=preset-growth&providerId=prov-b",
        )
    ]
    telemetry_payload = {
        "totalEvents": 6,
        "lastCapturedAt": "2025-01-02T00:00:00.000Z",
        "actionCounts": [{"action": "attachment.upload", "count": 3, "lastOccurredAt": "2025-01-02T00:00:00.000Z"}],
        "attachmentTotals": {"upload": 3, "remove": 1, "copy": 0, "tag": 0},
        "providerActivity": [],
    }

    async with httpx.AsyncClient(transport=transport) as http_client:
        notifier = ProviderAutomationAlertNotifier(
            test_settings,
            email_backend=email_backend,
            http_client=http_client,
        )
        async def fake_conversion(self, limit=3):
            return (
                [
                    ExperimentConversionDigest(
                        slug="spring-offer",
                        order_currency="USD",
                        order_total=1250.0,
                        order_count=5,
                        journey_count=7,
                        loyalty_points=4200,
                        last_activity=None,
                    )
                ],
                "spring-offer",
            )
        notifier._fetch_conversion_snapshot = types.MethodType(fake_conversion, notifier)
        auto_summary = {
            "autoPausedProviders": [
                {"providerId": "prov-a", "providerName": "Provider A", "reasons": ["guardrail fail threshold met"]},
            ],
            "autoResumedProviders": [
                {"providerId": "prov-b", "providerName": "Provider B", "notes": "Alerts cleared"},
            ],
        }
        await notifier.notify(alerts, load_alerts, auto_summary, telemetry_payload)

    assert email_backend.sent_messages
    body = email_backend.sent_messages[0].get_body().get_content()
    assert "Provider A" in body
    assert "Provider B" in body
    assert "cohort" in body.lower()
    assert "Merchandising: https://admin.example.com/admin/merchandising?presetId=preset-growth" in body
    assert "Automation guardrail actions" in body
    assert "Paused: Provider A" in body
    assert "Resumed: Provider B" in body
    assert "Guardrail workflow telemetry snapshot" in body
    assert "Actions captured: 6" in body

    assert "payload" in captured
    slack_payload = json.loads(captured["payload"])
    assert "Provider A" in slack_payload["text"]
    assert "Provider B" in slack_payload["text"]
    assert slack_payload["channel"] == "#ops"
    assert "Merchandising" in slack_payload["text"]
    assert "spring-offer" in slack_payload["text"]
    assert "Auto-pause" in slack_payload["text"]
    assert "Auto-resume" in slack_payload["text"]
    assert "Historical conversions" in slack_payload["text"]
    assert "conversionCursor=spring-offer" in slack_payload["text"]
    assert "Workflow telemetry snapshot" in slack_payload["text"]
    assert "Actions captured: 6" in slack_payload["text"]


@pytest.mark.asyncio
async def test_alert_worker_runs_with_stubs(session_factory):
    snapshot = _build_snapshot(fails=1, warns=0, replay_failed=0, replay_total=1)
    alert = ProviderAutomationAlert(
        provider_id="prov-a",
        provider_name="Provider A",
        guardrail_failures=1,
        guardrail_warnings=0,
        replay_failures=0,
        replay_total=1,
        guardrail_hotspots={"svc-a": {"fail": 1, "warn": 0}},
        rule_overrides={},
    )

    class StubAutomation:
        def __init__(self, snap: ProviderAutomationSnapshotResponse) -> None:
            self._snapshot = snap
            self.received_limit: int | None = None

        async def build_snapshot(self, limit_per_provider: int = 25) -> ProviderAutomationSnapshotResponse:
            self.received_limit = limit_per_provider
            return self._snapshot

    class StubEvaluator:
        def evaluate(self, snap: ProviderAutomationSnapshotResponse):
            assert snap.providers[0].id == "prov-a"
            return [alert]

    class StubNotifier:
        def __init__(self) -> None:
            self.alerts: list[ProviderAutomationAlert] = []
            self.load_alerts: list[ProviderLoadAlert] = []
            self.auto_summaries: list[dict[str, Any] | None] = []

        async def notify(self, alerts, load_alerts=None, auto_summary=None, workflow_summary=None):
            self.alerts.extend(alerts or [])
            if load_alerts:
                self.load_alerts.extend(load_alerts)
            self.auto_summaries.append(auto_summary)

    stub_automation = StubAutomation(snapshot)
    stub_evaluator = StubEvaluator()
    stub_notifier = StubNotifier()

    worker = ProviderAutomationAlertWorker(
        session_factory,
        automation_factory=lambda session: stub_automation,
        evaluator=stub_evaluator,
        notifier=stub_notifier,
        interval_seconds=1,
        snapshot_limit=5,
    )
    worker._load_alert_enabled = False  # type: ignore[attr-defined]

    summary = await worker.run_once()
    assert summary["alerts"] == 1
    await provider_alerts._record_alert_run_history(summary)
    assert summary["loadAlerts"] == 0
    assert stub_notifier.alerts[0].provider_id == "prov-a"


@pytest.mark.asyncio
async def test_alert_history_includes_workflow_telemetry(monkeypatch, session_factory):
    snapshot = _build_snapshot(fails=1, warns=0, replay_failed=0, replay_total=1)
    alert = ProviderAutomationAlert(
        provider_id="prov-meta",
        provider_name="Meta Provider",
        guardrail_failures=1,
        guardrail_warnings=0,
        replay_failures=0,
        replay_total=1,
        guardrail_hotspots={},
        rule_overrides={},
    )

    class StubAutomation:
        def __init__(self, snap: ProviderAutomationSnapshotResponse) -> None:
            self._snapshot = snap

        async def build_snapshot(self, limit_per_provider: int = 25) -> ProviderAutomationSnapshotResponse:
            return self._snapshot

    class StubEvaluator:
        def evaluate(self, snap: ProviderAutomationSnapshotResponse):
            return [alert]

    class StubNotifier:
        async def notify(self, alerts, load_alerts=None, auto_summary=None, workflow_summary=None):
            return None

    telemetry_payload = {
        "totalEvents": 6,
        "lastCapturedAt": "2025-01-02T00:00:00.000Z",
        "actionCounts": [{"action": "attachment.upload", "count": 3, "lastOccurredAt": "2025-01-02T00:00:00.000Z"}],
        "attachmentTotals": {"upload": 3, "remove": 1, "copy": 0, "tag": 0},
        "providerActivity": [],
    }

    async def fake_workflow_summary():
        return telemetry_payload

    monkeypatch.setattr(
        "smplat_api.tasks.provider_alerts._fetch_guardrail_workflow_summary",
        fake_workflow_summary,
    )
    monkeypatch.setattr(provider_alerts, "async_session", session_factory)

    worker = ProviderAutomationAlertWorker(
        session_factory,
        automation_factory=lambda session: StubAutomation(snapshot),
        evaluator=StubEvaluator(),
        notifier=StubNotifier(),
        interval_seconds=1,
        snapshot_limit=5,
    )
    worker._load_alert_enabled = False  # type: ignore[attr-defined]
    summary = await worker.run_once()
    assert summary["alerts"] == 1
    await provider_alerts._record_alert_run_history(summary)

    async with session_factory() as session:
        result = await session.execute(select(ProviderAutomationRun))
        run = result.scalars().first()
        assert run is not None
        assert run.metadata_json is not None
        assert run.metadata_json["workflowTelemetry"]["totalEvents"] == telemetry_payload["totalEvents"]


@pytest.mark.asyncio
async def test_alert_worker_auto_pause_and_resume(session_factory):
    snapshot = _build_snapshot(fails=2, warns=0, replay_failed=0, replay_total=0)
    alert = ProviderAutomationAlert(
        provider_id="prov-auto",
        provider_name="Automation Provider",
        guardrail_failures=2,
        guardrail_warnings=0,
        replay_failures=0,
        replay_total=0,
        guardrail_hotspots={},
        rule_overrides={},
    )

    class StubAutomation:
        def __init__(self, snap: ProviderAutomationSnapshotResponse) -> None:
            self._snapshot = snap

        async def build_snapshot(self, limit_per_provider: int = 25) -> ProviderAutomationSnapshotResponse:
            return self._snapshot

    class MutableEvaluator:
        def __init__(self, current_alerts: list[ProviderAutomationAlert]) -> None:
            self._alerts = current_alerts

        def set_alerts(self, alerts: list[ProviderAutomationAlert]) -> None:
            self._alerts = alerts

        def evaluate(self, snapshot: ProviderAutomationSnapshotResponse):
            return list(self._alerts)

    class StubNotifier:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def notify(self, alerts, load_alerts=None, auto_summary=None, workflow_summary=None):
            self.calls.append(
                {
                    "alerts": list(alerts or []),
                    "load_alerts": list(load_alerts or []),
                    "auto_summary": auto_summary,
                    "workflow_summary": workflow_summary,
                }
            )

    class StubFollowUpNotifier:
        def __init__(self) -> None:
            self.actions: list[str] = []

        async def notify(self, *, entry, status):
            self.actions.append(entry.action)
            return None

    stub_automation = StubAutomation(snapshot)
    evaluator = MutableEvaluator([alert])
    follow_up_notifier = StubFollowUpNotifier()

    stub_notifier = StubNotifier()
    worker = ProviderAutomationAlertWorker(
        session_factory,
        automation_factory=lambda session: stub_automation,
        evaluator=evaluator,
        notifier=stub_notifier,
        follow_up_notifier=follow_up_notifier,
        interval_seconds=1,
        snapshot_limit=5,
    )
    worker._load_alert_enabled = False  # type: ignore[attr-defined]
    worker._guardrail_fail_threshold = 1  # type: ignore[attr-defined]
    worker._replay_failure_threshold = 1  # type: ignore[attr-defined]

    summary = await worker.run_once()
    assert summary["alerts"] == 1
    assert summary["autoPaused"] == 1
    assert summary["autoResumed"] == 0
    assert follow_up_notifier.actions[-1] == "pause"
    assert isinstance(summary["autoPausedProviders"], list)
    assert summary["autoPausedProviders"][0]["providerId"] == "prov-auto"
    assert summary["autoPausedProviders"][0]["action"] == "pause"

    async with session_factory() as session:
        result = await session.execute(select(ProviderGuardrailStatus))
        status = result.scalar_one()
        assert status.is_paused is True
        assert status.last_source == "automation"
    assert len(stub_notifier.calls) == 1
    assert len(stub_notifier.calls[0]["alerts"]) == 1
    assert stub_notifier.calls[0]["auto_summary"]["autoPaused"] == 1

    evaluator.set_alerts([])
    summary_second = await worker.run_once()
    assert summary_second["autoPaused"] == 0
    assert summary_second["autoResumed"] == 1
    assert isinstance(summary_second["autoResumedProviders"], list)
    assert summary_second["autoResumedProviders"][0]["providerId"] == "prov-auto"
    assert summary_second["autoResumedProviders"][0]["action"] == "resume"
    assert follow_up_notifier.actions[-1] == "resume"

    async with session_factory() as session:
        result = await session.execute(select(ProviderGuardrailStatus))
        status = result.scalar_one()
        assert status.is_paused is False
        assert status.last_source == "automation"
    assert len(stub_notifier.calls) == 2
    assert len(stub_notifier.calls[1]["alerts"]) == 0
    assert stub_notifier.calls[1]["auto_summary"]["autoResumed"] == 1

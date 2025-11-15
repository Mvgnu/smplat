from __future__ import annotations

import json

import httpx
import pytest

from smplat_api.core.settings import Settings
from smplat_api.schemas.fulfillment_provider import ProviderAutomationSnapshotResponse
from smplat_api.services.fulfillment.provider_automation_alerts import (
    ProviderAutomationAlert,
    ProviderAutomationAlertEvaluator,
    ProviderAutomationAlertNotifier,
    ProviderLoadAlert,
)
from smplat_api.services.notifications.backend import InMemoryEmailBackend
from smplat_api.workers.provider_automation_alerts import ProviderAutomationAlertWorker


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

    async with httpx.AsyncClient(transport=transport) as http_client:
        notifier = ProviderAutomationAlertNotifier(
            test_settings,
            email_backend=email_backend,
            http_client=http_client,
        )
        await notifier.notify(alerts, load_alerts)

    assert email_backend.sent_messages
    body = email_backend.sent_messages[0].get_body().get_content()
    assert "Provider A" in body
    assert "Provider B" in body
    assert "cohort" in body.lower()
    assert "Merchandising: https://admin.example.com/admin/merchandising?presetId=preset-growth" in body

    assert "payload" in captured
    slack_payload = json.loads(captured["payload"])
    assert "Provider A" in slack_payload["text"]
    assert "Provider B" in slack_payload["text"]
    assert slack_payload["channel"] == "#ops"
    assert "Merchandising" in slack_payload["text"]


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

        async def notify(self, alerts, load_alerts=None):
            self.alerts.extend(alerts or [])
            if load_alerts:
                self.load_alerts.extend(load_alerts)

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
    assert summary["loadAlerts"] == 0
    assert stub_notifier.alerts[0].provider_id == "prov-a"

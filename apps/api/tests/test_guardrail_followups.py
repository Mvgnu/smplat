from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from httpx import AsyncClient

from smplat_api.core.settings import settings
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.provider_guardrail_followup import ProviderGuardrailFollowUp
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.reporting.guardrail_followup_notifier import GuardrailFollowUpNotifier
from smplat_api.services.provider_telemetry import load_provider_telemetry_summary
from smplat_api.services.provider_telemetry import (
    GuardrailSummary,
    ProviderAutomationTelemetrySummary,
    ReplaySummary,
    RuleOverrideServiceSummary,
    RuleOverrideStat,
)


@pytest.mark.asyncio
async def test_record_guardrail_followup(app_with_db):
    app, _ = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "guardrails-key"

    try:
        payload = {
            "providerId": "provider-123",
            "providerName": "Provider 123",
            "action": "pause",
            "notes": "Paused automation pending replay stability.",
            "platformContext": {
                "id": "instagram::@brand",
                "label": "Instagram @brand",
                "handle": "@brand",
                "platformType": "instagram",
            },
            "conversionCursor": "spring-offer",
            "conversionHref": "https://app.smplat.local/admin/reports?conversionCursor=spring-offer#experiment-analytics",
        }
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/reporting/guardrails/followups",
                json=payload,
                headers={"X-API-Key": "guardrails-key"},
            )
        assert response.status_code == 201
        body = response.json()
        entry = body["entry"]
        status = body["status"]
        assert entry["providerId"] == payload["providerId"]
        assert entry["action"] == "pause"
        assert entry["platformContext"]["platformType"] == "instagram"
        assert entry["conversionCursor"] == payload["conversionCursor"]
        assert entry["conversionHref"] == payload["conversionHref"]
        assert "createdAt" in entry
        assert status["isPaused"] is True
        assert status["providerId"] == payload["providerId"]
        assert "providerTelemetry" in body
        assert body["providerTelemetry"] is None
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_guardrail_followup_response_includes_provider_telemetry(app_with_db):
    app, session_factory = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "guardrails-key"

    try:
        async with session_factory() as session:
            user = User(
                email="telemetry@example.com",
                display_name="Telemetry Client",
                role=UserRoleEnum.CLIENT,
                status=UserStatusEnum.ACTIVE,
            )
            session.add(user)
            await session.flush()

            order = Order(
                order_number="SMT-500",
                status=OrderStatusEnum.ACTIVE,
                source=OrderSourceEnum.CHECKOUT,
                subtotal=Decimal("120.00"),
                tax=Decimal("0"),
                total=Decimal("120.00"),
                currency=CurrencyEnum.USD,
                user_id=user.id,
            )
            item = OrderItem(
                order=order,
                product_title="Growth bundle",
                quantity=1,
                unit_price=Decimal("120.00"),
                total_price=Decimal("120.00"),
            )
            provider_order = FulfillmentProviderOrder(
                order=order,
                order_item=item,
                provider_id="provider-telemetry",
                provider_name="Telemetry Provider",
                service_id="svc-growth",
                service_action="growth",
                amount=Decimal("120.00"),
                currency="USD",
                payload={
                    "providerCostAmount": "100",
                    "guardrails": {
                        "minimumMarginPercent": 10,
                        "warningMarginPercent": 20,
                    },
                    "replays": [{"status": "executed"}],
                    "serviceRules": [{"id": "margin-floor", "label": "Margin Floor"}],
                },
            )
            session.add_all([order, item, provider_order])
            await session.commit()

        async with session_factory() as verify_session:
            summary = await load_provider_telemetry_summary(verify_session, "provider-telemetry")
            assert summary is not None

        payload = {
            "providerId": "provider-telemetry",
            "providerName": "Telemetry Provider",
            "action": "pause",
            "notes": "Logged for telemetry test",
        }
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/reporting/guardrails/followups",
                json=payload,
                headers={"X-API-Key": "guardrails-key"},
            )
        assert response.status_code == 201
        body = response.json()
        telemetry = body.get("providerTelemetry")
        assert telemetry is not None, body
        assert telemetry["totalOrders"] == 1
        assert telemetry["guardrails"]["evaluated"] >= 1
        assert telemetry["replays"]["executed"] == 1
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_list_guardrail_followups(app_with_db):
    app, _ = app_with_db
    previous_key = settings.checkout_api_key
    settings.checkout_api_key = "guardrails-key"

    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            for action in ("pause", "resume"):
                response = await client.post(
                    "/api/v1/reporting/guardrails/followups",
                    json={
                        "providerId": "provider-abc",
                        "providerName": "Provider ABC",
                        "action": action,
                        "notes": f"{action} guardrail",
                        "platformContext": {
                            "id": "tiktok::@brand",
                            "label": "TikTok @brand",
                            "handle": "@brand",
                            "platformType": "tiktok",
                        },
                    },
                    headers={"X-API-Key": "guardrails-key"},
                )
                assert response.status_code == 201

            response = await client.get(
                "/api/v1/reporting/guardrails/followups",
                params={"providerId": "provider-abc", "limit": 1},
                headers={"X-API-Key": "guardrails-key"},
            )
        assert response.status_code == 200
        body = response.json()
        assert len(body["entries"]) == 1
        assert body["entries"][0]["action"] == "resume"
        assert body["entries"][0]["platformContext"]["platformType"] == "tiktok"
        assert body["entries"][0]["conversionCursor"] is None
        assert body["nextCursor"] is not None
        assert body["status"]["isPaused"] is False
        assert "providerTelemetry" in body
        assert body["providerTelemetry"] is None

        async with AsyncClient(app=app, base_url="http://test") as client:
            response_next = await client.get(
                "/api/v1/reporting/guardrails/followups",
                params={"providerId": "provider-abc", "cursor": body["nextCursor"]},
                headers={"X-API-Key": "guardrails-key"},
            )
        assert response_next.status_code == 200
        next_body = response_next.json()
        assert len(next_body["entries"]) == 1
        assert next_body["entries"][0]["action"] == "pause"
        assert next_body["status"]["isPaused"] is False
        assert "providerTelemetry" in next_body
    finally:
        settings.checkout_api_key = previous_key


@pytest.mark.asyncio
async def test_guardrail_followup_notifier_includes_conversion_link(monkeypatch):
    previous_webhook = settings.provider_automation_alert_slack_webhook_url
    previous_channel = settings.provider_automation_alert_slack_channel
    previous_frontend = settings.frontend_url
    settings.provider_automation_alert_slack_webhook_url = "https://hooks.slack.test/test"
    settings.provider_automation_alert_slack_channel = None
    settings.frontend_url = "https://app.smplat.local"

    class StubClient:
        def __init__(self):
            self.payloads: list[dict[str, str]] = []

        async def post(self, url, json):
            self.payloads.append({"url": url, "json": json})

            class Response:
                def raise_for_status(self):
                    return None

            return Response()

        async def aclose(self):
            return None

    client = StubClient()

    entry = ProviderGuardrailFollowUp(
        provider_id="provider-456",
        provider_name="Provider 456",
        action="pause",
        notes="Paused via notifier test",
        platform_context=None,
    )
    entry.created_at = datetime.now(timezone.utc)

    status = ProviderGuardrailStatus(provider_id="provider-456")
    status.provider_name = "Provider 456"
    status.is_paused = True

    telemetry = ProviderAutomationTelemetrySummary(
        total_orders=3,
        replays=ReplaySummary(total=2, executed=1, failed=1, scheduled=1),
        guardrails=GuardrailSummary(evaluated=2, passed=1, warned=0, failed=1),
    )
    telemetry.guardrail_hits_by_service["svc-growth"] = GuardrailSummary(evaluated=2, passed=1, warned=0, failed=1)
    summary = RuleOverrideServiceSummary(total_overrides=2)
    summary.rules["margin-floor"] = RuleOverrideStat(label="Margin Floor", count=2)
    telemetry.rule_overrides_by_service["svc-growth"] = summary

    notifier = GuardrailFollowUpNotifier(http_client=client)

    try:
        await notifier.notify(
            entry=entry,
            status=status,
            conversion_cursor="spring-offer",
            conversion_href="https://app.smplat.local/admin/reports?conversionCursor=spring-offer#experiment-analytics",
            telemetry_summary=telemetry,
        )
        assert client.payloads, "Slack payloads should be recorded"
        payload = client.payloads[0]["json"]["text"]
        assert "Historical conversion slice" in payload
        assert "spring-offer" in payload
        assert "Open conversions" in payload
        assert "Provider automation telemetry" in payload
        assert "svc-growth" in payload
    finally:
        settings.provider_automation_alert_slack_webhook_url = previous_webhook
        settings.provider_automation_alert_slack_channel = previous_channel
        settings.frontend_url = previous_frontend

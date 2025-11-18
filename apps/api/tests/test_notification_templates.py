from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.user import User, UserRoleEnum, UserStatusEnum
from smplat_api.services.provider_telemetry import (
    GuardrailSummary,
    ProviderAutomationTelemetrySummary,
    RuleOverrideServiceSummary,
    RuleOverrideStat,
)
from smplat_api.services.notifications.templates import render_weekly_digest


def _build_order() -> Order:
    return Order(
        order_number="SM100",
        status=OrderStatusEnum.ACTIVE,
        source=OrderSourceEnum.CHECKOUT,
        subtotal=Decimal("100"),
        tax=Decimal("0"),
        total=Decimal("100"),
        currency=CurrencyEnum.EUR,
    )


def test_render_weekly_digest_includes_conversion_metrics():
    user = User(
        email="ops@example.com",
        display_name="Ops Team",
        role=UserRoleEnum.CLIENT,
        status=UserStatusEnum.ACTIVE,
    )
    order = _build_order()
    conversion_metrics = [
        {
            "slug": "spring-offer",
            "orderCurrency": "USD",
            "orderTotal": 1500.0,
            "orderCount": 6,
            "journeyCount": 8,
            "loyaltyPoints": 4200,
            "lastActivity": datetime(2025, 1, 15, tzinfo=timezone.utc),
        }
    ]

    template = render_weekly_digest(
        user,
        highlighted_orders=[order],
        pending_actions=[],
        conversion_metrics=conversion_metrics,
        automation_actions=[],
    )

    assert "Experiment conversion impact" in template.text_body
    assert "spring-offer" in template.text_body
    assert "spring-offer" in template.html_body


def test_render_weekly_digest_includes_guardrail_actions():
    user = User(
        email="ops@example.com",
        display_name="Ops Team",
        role=UserRoleEnum.CLIENT,
        status=UserStatusEnum.ACTIVE,
    )
    order = _build_order()
    actions = [
        {
            "providerName": "Alpha Air",
            "providerId": "prov-1",
            "action": "pause",
            "reasons": ["3 guardrail fails"],
            "notes": None,
            "ranAt": datetime(2025, 1, 14, tzinfo=timezone.utc),
        }
    ]

    template = render_weekly_digest(
        user,
        highlighted_orders=[order],
        pending_actions=[],
        conversion_metrics=[],
        automation_actions=actions,
    )

    assert "Guardrail automation actions" in template.text_body
    assert "Alpha Air" in template.text_body
    assert "Auto-pause" in template.html_body


def test_render_weekly_digest_includes_provider_telemetry():
    user = User(
        email="ops@example.com",
        display_name="Ops Team",
        role=UserRoleEnum.CLIENT,
        status=UserStatusEnum.ACTIVE,
    )
    order = _build_order()
    telemetry = ProviderAutomationTelemetrySummary(total_orders=2)
    telemetry.replays.total = 3
    telemetry.replays.executed = 2
    telemetry.replays.failed = 1
    telemetry.replays.scheduled = 1
    telemetry.guardrails.evaluated = 2
    telemetry.guardrails.failed = 1
    telemetry.guardrail_hits_by_service["svc-growth"] = GuardrailSummary(evaluated=1, failed=1)
    telemetry.rule_overrides_by_service["svc-growth"] = RuleOverrideServiceSummary(
        total_overrides=1,
        rules={"margin_floor": RuleOverrideStat(label="Margin Floor", count=1)},
    )

    template = render_weekly_digest(
        user,
        highlighted_orders=[order],
        pending_actions=[],
        conversion_metrics=[],
        automation_actions=[],
        provider_telemetry=telemetry,
    )

    assert "Provider automation telemetry" in template.text_body
    assert "Routed orders" in template.text_body
    assert "Provider automation telemetry" in template.html_body


def test_render_weekly_digest_includes_workflow_telemetry():
    user = User(
        email="ops@example.com",
        display_name="Ops Team",
        role=UserRoleEnum.CLIENT,
        status=UserStatusEnum.ACTIVE,
    )
    order = _build_order()
    workflow_summary = {
        "totalEvents": 5,
        "lastCapturedAt": "2025-01-15T00:00:00.000Z",
        "attachmentTotals": {"upload": 2, "remove": 1, "copy": 1, "tag": 0},
        "actionCounts": [{"action": "attachment.upload", "count": 2}],
    }

    template = render_weekly_digest(
        user,
        highlighted_orders=[order],
        pending_actions=[],
        conversion_metrics=[],
        automation_actions=[],
        workflow_telemetry=workflow_summary,
    )

    assert "Guardrail workflow telemetry" in template.text_body
    assert "Actions captured: 5" in template.text_body
    assert "Guardrail workflow telemetry" in template.html_body

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from smplat_api.models.analytics import CheckoutOfferEvent
from smplat_api.services.analytics.preset_events import PresetEventAnalyticsService


@pytest.mark.asyncio
async def test_preset_event_analytics_counts_and_timeline(session_factory):
    async with session_factory() as session:
        now = datetime.now(timezone.utc)
        events = [
            CheckoutOfferEvent(
                offer_slug="growth-kit",
                event_type="preset_cta_apply",
                metadata_json={"presetId": "preset-alpha", "source": "marketing-card"},
                created_at=now - timedelta(days=1),
            ),
            CheckoutOfferEvent(
                offer_slug="growth-kit",
                event_type="preset_cta_apply",
                metadata_json={"presetId": "preset-alpha", "source": "marketing-card"},
                created_at=now,
            ),
            CheckoutOfferEvent(
                offer_slug="growth-kit",
                event_type="preset_configurator_apply",
                metadata_json={"presetId": "preset-beta", "source": "configurator"},
                created_at=now - timedelta(days=2),
            ),
            CheckoutOfferEvent(
                offer_slug="growth-kit",
                event_type="preset_configurator_clear",
                metadata_json={"presetId": "preset-beta", "source": "configurator"},
                created_at=now - timedelta(days=2),
            ),
        ]
        session.add_all(events)
        await session.commit()

        service = PresetEventAnalyticsService(session)
        payload = await service.fetch_summary(window_days=7)

        assert payload["totals"]["preset_cta_apply"] == 2
        assert payload["totals"]["preset_configurator_apply"] == 1
        assert payload["totals"]["preset_configurator_clear"] == 1

        timeline = payload["timeline"]
        assert timeline, "timeline should include the requested window"
        timeline_by_date = {entry["date"]: entry for entry in timeline}
        today_key = now.date().isoformat()
        assert timeline_by_date[today_key]["counts"]["presetCtaApply"] == 1
        assert timeline_by_date[today_key]["totals"]["applies"] >= 1
        assert "trend" in timeline_by_date[today_key]

        assert any(entry["source"] == "marketing-card" for entry in payload["sources"])
        assert any(entry["source"] == "configurator" for entry in payload["sources"])
        breakdowns = payload["breakdowns"]
        assert breakdowns["presets"], "expected preset breakdown entries"
        preset_ids = {entry["presetId"] for entry in breakdowns["presets"]}
        assert "preset-alpha" in preset_ids
        assert breakdowns["sources"], "expected channel breakdown entries"
        preset_alpha = next(entry for entry in breakdowns["presets"] if entry["presetId"] == "preset-alpha")
        assert "isRisky" in preset_alpha

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from smplat_api.core.settings import Settings
from smplat_api.models.analytics import CheckoutOfferEvent
from smplat_api.models.preset_event_alert_run import PresetEventAlertRun
from smplat_api.services.analytics.preset_event_alerts import PresetEventAlertJob


class RecordingNotifier:
    def __init__(self) -> None:
        self.alert_batches: list[list[object]] = []
        self.summaries: list[dict[str, object]] = []

    async def notify(self, alerts, *, summary) -> None:  # type: ignore[no-untyped-def]
        self.alert_batches.append(list(alerts))
        self.summaries.append(dict(summary))


@pytest.mark.asyncio
async def test_preset_alert_job_records_and_notifies(session_factory):
    async with session_factory() as session:
        now = datetime.now(timezone.utc)
        events = []
        for _ in range(6):
            events.append(
                CheckoutOfferEvent(
                    offer_slug="growth-kit",
                    event_type="preset_cta_apply",
                    metadata_json={"presetId": "alpha", "source": "marketing-card"},
                    created_at=now - timedelta(days=1),
                )
            )
        for _ in range(4):
            events.append(
                CheckoutOfferEvent(
                    offer_slug="growth-kit",
                    event_type="preset_configurator_apply",
                    metadata_json={"presetId": "alpha", "source": "configurator"},
                    created_at=now - timedelta(days=1),
                )
            )
        for _ in range(5):
            events.append(
                CheckoutOfferEvent(
                    offer_slug="growth-kit",
                    event_type="preset_configurator_clear",
                    metadata_json={"presetId": "alpha", "source": "configurator"},
                    created_at=now - timedelta(days=1),
                )
            )
        session.add_all(events)
        await session.commit()

    notifier = RecordingNotifier()
    job_settings = Settings(preset_event_alert_notifications_enabled=True)
    job = PresetEventAlertJob(
        session_factory,
        notifier=notifier,
        settings=job_settings,
        window_days=7,
    )

    result = await job.run_once()
    assert result["alerts"] == 2
    assert notifier.alert_batches

    async with session_factory() as session:
        rows = await session.execute(select(PresetEventAlertRun))
        runs = rows.scalars().all()
        assert len(runs) == 1
        run = runs[0]
        assert run.alerts_sent == 2
        assert set(run.alert_codes) == {"high_clear_rate", "preset_specific_clear_rate"}


@pytest.mark.asyncio
async def test_preset_alert_job_records_without_alerts(session_factory):
    notifier = RecordingNotifier()
    job_settings = Settings(preset_event_alert_notifications_enabled=True)
    job = PresetEventAlertJob(session_factory, notifier=notifier, settings=job_settings, window_days=7)

    result = await job.run_once()
    assert result["alerts"] == 0
    assert not notifier.alert_batches

    async with session_factory() as session:
        rows = await session.execute(select(PresetEventAlertRun))
        runs = rows.scalars().all()
        assert len(runs) == 1
        assert runs[0].alerts_sent == 0

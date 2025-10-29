from pathlib import Path

import pytest

from smplat_api.scheduling.config import JobDefinition, ScheduleConfig, load_job_definitions
from smplat_api.scheduling.runner import CatalogJobScheduler
from smplat_api.observability.scheduler import get_catalog_scheduler_store


@pytest.mark.asyncio
async def test_scheduler_retries_and_records_metrics(tmp_path: Path) -> None:
    store = get_catalog_scheduler_store()
    store.reset()

    scheduler = CatalogJobScheduler(session_factory=lambda: None, config_path=tmp_path / "noop.toml")

    attempts = 0

    async def flaky_job(*, session_factory) -> None:  # pragma: no cover - exercised in tests
        nonlocal attempts
        attempts += 1
        if attempts < 2:
            raise RuntimeError("boom")

    job = JobDefinition(
        id="job-alpha",
        task="tests.flaky",
        cron="* * * * *",
        kwargs={},
        max_attempts=3,
        base_backoff_seconds=0.0,
        backoff_multiplier=1.0,
        max_backoff_seconds=0.0,
        jitter_seconds=0.0,
    )

    runner = scheduler._wrap_callable(flaky_job, job)
    await runner()

    snapshot = store.snapshot()
    assert snapshot.totals["runs"] == 1
    assert snapshot.totals["success"] == 1
    assert snapshot.totals["attempt_failures"] == 1
    assert snapshot.totals["retries"] == 1
    job_snapshot = snapshot.jobs[job.id]
    assert job_snapshot.last_success_at is not None
    assert job_snapshot.last_error is None
    assert attempts == 2


@pytest.mark.asyncio
async def test_scheduler_records_final_failure(tmp_path: Path) -> None:
    store = get_catalog_scheduler_store()
    store.reset()

    scheduler = CatalogJobScheduler(session_factory=lambda: None, config_path=tmp_path / "noop.toml")

    async def failing_job(*, session_factory) -> None:  # pragma: no cover - exercised in tests
        raise RuntimeError("boom")

    job = JobDefinition(
        id="job-failure",
        task="tests.failing",
        cron="* * * * *",
        kwargs={},
        max_attempts=2,
        base_backoff_seconds=0.0,
        backoff_multiplier=1.0,
        max_backoff_seconds=0.0,
        jitter_seconds=0.0,
    )

    runner = scheduler._wrap_callable(failing_job, job)
    await runner()

    snapshot = store.snapshot()
    assert snapshot.totals["run_failures"] == 1
    job_snapshot = snapshot.jobs[job.id]
    assert job_snapshot.totals["consecutive_failures"] == 2
    assert job_snapshot.last_error == "boom"
    assert job_snapshot.last_error_at is not None


@pytest.mark.asyncio
async def test_scheduler_health_snapshot(tmp_path: Path) -> None:
    store = get_catalog_scheduler_store()
    store.reset()

    scheduler = CatalogJobScheduler(session_factory=lambda: None, config_path=tmp_path / "noop.toml")

    async def successful_job(*, session_factory) -> None:
        return None

    job = JobDefinition(
        id="job-health",
        task="tests.success",
        cron="* * * * *",
        kwargs={},
        max_attempts=1,
        base_backoff_seconds=0.0,
        backoff_multiplier=1.0,
        max_backoff_seconds=0.0,
        jitter_seconds=0.0,
    )

    runner = scheduler._wrap_callable(successful_job, job)
    await runner()

    scheduler._config = ScheduleConfig(timezone="UTC", jobs=[job])
    scheduler._is_running = True

    health = scheduler.health()
    assert health["running"] is True
    assert health["configured_jobs"] == 1
    assert health["totals"]["runs"] == 1
    assert health["jobs"][0]["metrics"]["totals"]["runs"] == 1
    assert health["jobs"][0]["metrics"]["last_success_at"] is not None


def test_load_job_definitions_parses_retry_fields(tmp_path: Path) -> None:
    config_path = tmp_path / "schedules.toml"
    config_path.write_text(
        """
        timezone = "UTC"

        [jobs.sample]
        task = "module.task"
        cron = "*/5 * * * *"
        max_attempts = 5
        base_backoff_seconds = 2
        backoff_multiplier = 3
        max_backoff_seconds = 30
        jitter_seconds = 1.5
        """
    )

    config = load_job_definitions(config_path)
    assert config.timezone == "UTC"
    assert len(config.jobs) == 1
    job = config.jobs[0]
    assert job.max_attempts == 5
    assert job.base_backoff_seconds == 2.0
    assert job.backoff_multiplier == 3.0
    assert job.max_backoff_seconds == 30.0
    assert job.jitter_seconds == 1.5


@pytest.mark.asyncio
async def test_scheduler_tracks_consecutive_failures_and_resets(tmp_path: Path) -> None:
    store = get_catalog_scheduler_store()
    store.reset()

    scheduler = CatalogJobScheduler(session_factory=lambda: None, config_path=tmp_path / "noop.toml")

    run_count = 0

    async def sometimes_failing_job(*, session_factory) -> None:  # pragma: no cover - exercised in tests
        nonlocal run_count
        run_count += 1
        if run_count < 3:
            raise RuntimeError("boom")

    job = JobDefinition(
        id="job-consecutive",
        task="tests.sometimes_failing",
        cron="* * * * *",
        kwargs={},
        max_attempts=1,
        base_backoff_seconds=0.0,
        backoff_multiplier=1.0,
        max_backoff_seconds=0.0,
        jitter_seconds=0.0,
    )

    runner = scheduler._wrap_callable(sometimes_failing_job, job)

    # First two runs fail and should increment consecutive failure counters.
    await runner()
    await runner()

    snapshot = store.snapshot()
    job_snapshot = snapshot.jobs[job.id]
    assert snapshot.totals["runs"] == 2
    assert snapshot.totals["run_failures"] == 2
    assert job_snapshot.totals["consecutive_failures"] == 2
    assert job_snapshot.last_error == "boom"
    assert job_snapshot.last_success_at is None

    # Third run succeeds and should reset failure streak tracking.
    await runner()

    snapshot = store.snapshot()
    job_snapshot = snapshot.jobs[job.id]
    assert snapshot.totals["runs"] == 3
    assert snapshot.totals["run_failures"] == 2
    assert snapshot.totals["success"] == 1
    assert job_snapshot.totals["consecutive_failures"] == 0
    assert job_snapshot.last_error is None
    assert job_snapshot.last_success_at is not None

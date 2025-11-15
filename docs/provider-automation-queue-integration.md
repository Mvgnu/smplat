# Provider Automation Queue Integration

Provider automation now exposes CLI helpers so schedulers/queues can execute the same logic we run in-process. Use this guide to wire Celery, BullMQ, or cron without importing FastAPI or re-implementing services.

## Prerequisites

- Environment variables from `.env.example`:
  - `PROVIDER_REPLAY_WORKER_*` for cadence/limits.
  - `PROVIDER_AUTOMATION_ALERT_*` for guardrail thresholds and notification channels.
  - `PROVIDER_LOAD_ALERT_*` to toggle/tune preset→provider overload alerts (7d vs 90d windows by default).
  - `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_DEFAULT_QUEUE`, `PROVIDER_AUTOMATION_REPLAY_TASK_QUEUE`, `PROVIDER_AUTOMATION_ALERT_TASK_QUEUE` when running native Celery workers.
  - Helm/Terraform overlays: `infra/helm/values-staging.yaml` and `infra/helm/values-production.yaml` now pin the same `PROVIDER_LOAD_ALERT_*` values (and keep `PROVIDER_AUTOMATION_ALERT_WORKER_ENABLED=true`) so staging/prod mirrors `.env.example` without manual drift.
- Database and API connectivity identical to the FastAPI app (these commands use the same SQLAlchemy session factory).
- Poetry virtualenv (run everything via `poetry run …`).

## CLI Entry Points

### Scheduled Replays

```bash
poetry run provider-replay scheduled --limit 50
```

- Processes due `payload.scheduledReplays` entries once, respecting the same validation and logging as `ProviderOrderReplayWorker`.
- `--limit` overrides the default batch size (falls back to `PROVIDER_REPLAY_WORKER_LIMIT`).

### Single Order Replay

```bash
poetry run provider-replay replay \
  --provider-id=prov_abc \
  --provider-order-id=15f3c1e6-4e2b-4c0a-9c9d-8d4a764f1a3c \
  --amount=125.0
```

- Immediately replays the specified provider order and persists the replay entry.
- `--amount` is optional; omit it to reuse the original amount/payload.

### Alert Evaluations

```bash
poetry run provider-alerts
```

- Executes a single iteration of `ProviderAutomationAlertWorker`, emitting Slack/email alerts when guardrail or replay thresholds breach.
- Schedule this command via cron or an async queue for continuous monitoring.

## Native Celery Tasks

Celery ships with the API service (see `smplat_api/celery_app.py`). Start a worker with:

```bash
poetry run celery -A smplat_api.celery_app worker -Q provider-replay,provider-alerts
```

Registers two tasks:

- `provider_automation.run_replay_batch` → Executes `ProviderOrderReplayWorker` once.
- `provider_automation.evaluate_alerts` → Executes `ProviderAutomationAlertWorker` once.

When the corresponding `PROVIDER_*_WORKER_ENABLED` flag is `false`, the task returns immediately with `{"skipped": true}` so you can keep beat entries enabled across environments.

### Celery Beat Schedule

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "provider-replay-scheduled": {
        "task": "provider_automation.run_replay_batch",
        "schedule": crontab(minute="*/5"),
        "kwargs": {"limit": 50},
    },
    "provider-automation-alerts": {
        "task": "provider_automation.evaluate_alerts",
        "schedule": crontab(minute="*/15"),
    },
}
```

Queues default to `PROVIDER_AUTOMATION_REPLAY_TASK_QUEUE` / `PROVIDER_AUTOMATION_ALERT_TASK_QUEUE`, so align your worker `-Q` arguments (or override the env vars) when scaling horizontally.

## Status & Observability

- Every replay/alert execution records a status blob in Redis via `AutomationStatusService`. Hit
  `/api/v1/fulfillment/providers/automation/status` to retrieve the latest `ranAt` timestamp + summary payloads.
  The summaries now include `scheduledBacklog` / `nextScheduledAt` for replay cadence and `alertsDigest` for alert
  notifications so operators can see backlog pressure + alert reasons inline.
- Admin pages now surface this telemetry inline (Orders dashboard + Provider catalog). If your Celery workers are idle,
  these cards will show “No runs recorded,” giving ops a quick heartbeat for scheduler health.
- For on-demand automation, POST to `/api/v1/fulfillment/providers/automation/replay/run` (optionally `?limit=50`) or
  `/api/v1/fulfillment/providers/automation/alerts/run`. The admin UI’s “Run now” buttons call the same endpoints via
  server actions, reusing the Redis-backed status feed for immediate feedback.
- Postgres now stores a full automation run history (`provider_automation_runs`) with backlog counts, next scheduled ETA,
  alert send counts, and serialized digests. Fetch it via
  `/api/v1/fulfillment/providers/automation/status/history?limit=50` for BI exports or to audit cadence beyond the
  Redis rolling window. The `/automation/status` endpoint backfills the Redis summaries from this table whenever fields
  are missing, guaranteeing the UI/API always exposes backlog + alert digests even after service restarts.

## Preset Cohort Pressure Maps

- `/api/v1/reporting/blueprint-metrics` now emits a `presetProviderEngagements` block that maps presets → provider/service
  engagements across 7/30/90 day windows. The service joins `order_items.selected_options.presetId` to
  `fulfillment_provider_orders` so we can attribute automation load back to merchandising cohorts.
- `/admin/fulfillment/providers` renders these cohorts inside the new “Preset-driven provider load” panel. Each window
  card lists the top presets fueling provider traffic (engagement count, share of preset load, provider spend), giving ops
  an at-a-glance read before replaying or throttling automation.
- The same panel mirrors merchandising’s preset risk alerts. When a preset-specific alert fires, ops can follow the
  breadcrumb: alert → cohort panel → provider card/order history → automation runbook. This keeps merchandising context
  attached to every provider triage session without jumping between dashboards.
- Runbook note: if a single provider shoulders >60% of a preset’s engagements in the 7d window (share field), review the
  provider automation settings before replaying orders. Consider routing overflow to a secondary provider or pausing
  merchandising promo until automation capacity catches up.

## Provider Load Alert Configuration

- `PROVIDER_LOAD_ALERT_ENABLED` toggles the evaluator that compares short vs long lookback windows (defaults 7d vs 90d).
- Thresholds:
  - `PROVIDER_LOAD_ALERT_SHARE_THRESHOLD` – minimum portion of preset traffic the provider must own in the short window (default 0.6 = 60%).
  - `PROVIDER_LOAD_ALERT_DELTA_THRESHOLD` – minimum increase over the long-window baseline (default 0.2 = +20pp).
  - `PROVIDER_LOAD_ALERT_MIN_ENGAGEMENTS` – minimum automation runs recorded in the short window.
- Coverage: `PROVIDER_LOAD_ALERT_SHORT_WINDOW_DAYS`, `PROVIDER_LOAD_ALERT_LONG_WINDOW_DAYS`, and
  `PROVIDER_LOAD_ALERT_MAX_RESULTS` control the lookbacks and per-run cap.
- When enabled, the `provider-alerts` worker appends `loadAlertsDigest` to Redis history, Slack/email payloads, and the
  admin dashboards so ops can react before fulfillment queues saturate.
- Each load alert now ships deep links (`/admin/merchandising?presetId=…`, `/admin/fulfillment/providers?providerId=…`, `/admin/orders?...`) inside both the API payload and worker digest. Slack/email templates embed the same CTAs so responders can jump directly into preset or provider runbooks.
- `/admin/orders` (`ProviderLoadAlertsCallout`), `/admin/fulfillment/providers` (`ProviderCohortAnalyticsSection`), and the shared `AutomationStatusPanel` all render “View preset / View provider / Orders” buttons sourced from those links, keeping merchandising + fulfillment dashboards aligned with alert routing.

## Run History Export

- A CLI helper (`tooling/scripts/export_provider_automation_runs.py`) now fetches the `/automation/status/history`
  payload, flattens replay + alert runs, and emits JSON or CSV suitable for BI/warehouse ingestion. It automatically
  honors `SMPLAT_API_BASE_URL`, `SMPLAT_AUTOMATION_EXPORT_DIR`, and `SMPLAT_AUTOMATION_AUTH_TOKEN`, so prod/test
  environments simply inject their host + output directory + bearer token via secrets/vars.
- Example usage:

```bash
poetry run python tooling/scripts/export_provider_automation_runs.py \
  --base-url http://localhost:8000 \
  --limit 100 \
  --format csv \
  --output automation_runs.csv
```

- Pass `--auth-token` if the API requires bearer authentication; the script automatically adds the header.
- In the monorepo root you can also run `pnpm automation:export-runs -- --limit 200`
  so CI/cron jobs can invoke the export via a single package script. Pair it with cron (example: `0 * * * * cd /srv/smplat && SMPLAT_API_BASE_URL=https://api.smplat.prod SMPLAT_AUTOMATION_AUTH_TOKEN="$API_TOKEN" pnpm automation:export-runs`)
  to keep BI tables hydrated hourly. The exporter will drop files into `SMPLAT_AUTOMATION_EXPORT_DIR`
  (or stdout when unset).
- GitHub Actions workflow `.github/workflows/provider-automation-export.yml` is hooked up to run hourly with a
  prod/test matrix. Configure environment variables (`SMPLAT_API_BASE_URL`, optional `SMPLAT_AUTOMATION_EXPORT_DIR`)
  and the secret `SMPLAT_AUTOMATION_API_TOKEN` per environment to enable the schedule. Artifacts are uploaded for
  downstream ingestion, so you can wire the export loop without provisioning servers.

## BullMQ / Node Runner

When using BullMQ or other Node-based queues, invoke the same commands via child processes or HTTP RPC calls. For example:

```ts
import { execa } from "execa";

queue.add("provider-replay", {}, { repeat: { every: 5 * 60 * 1000 } });

queue.process("provider-replay", async () => {
  await execa("poetry", ["run", "provider-replay", "scheduled"]);
});
```

## Verification & Tests

Before wiring new jobs, run the provider automation suites to ensure endpoints and workers remain healthy:

```bash
poetry run pytest \
  tests/test_provider_automation_service.py \
  tests/test_provider_order_replay_worker.py \
  tests/test_provider_automation_alerts.py \
  tests/test_provider_replay_tasks.py \
  tests/test_provider_alert_tasks.py
```

These tests cover:
- `/api/v1/fulfillment/providers/automation/snapshot`
- Replay scheduling/execution
- Alert evaluation + notification plumbing
- The new CLI/task helpers

Re-run the suites whenever you change queue wiring or automation settings.

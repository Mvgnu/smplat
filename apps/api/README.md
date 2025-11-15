## Local Development
```bash
poetry install
poetry run uvicorn smplat_api.app:create_app --factory --reload
```

## Testing
```bash
poetry install  # ensures pytest-asyncio and other plugins are present
poetry run pytest
```

## Development Seed Data
Run the shortcut seed to provision the demo customer/admin accounts expected by the web app:
```bash
poetry run python tooling/seed_dev_users.py
```
Set `DEV_SHORTCUT_*` environment variables before running if you need custom emails.

See `/docs` for full architecture decisions.

## Product Configuration APIs
- `PUT /api/v1/products/{productId}/options` transactionally replaces option groups, add-ons, custom fields, and subscription plans. Omitted collections are deleted.
- `POST /api/v1/products` and `PATCH /api/v1/products/{productId}` accept a `configuration` payload to provision nested relationships alongside base product fields.
- Price deltas are validated in the range [-100000, 100000] and subscription billing cycles are limited to `one_time`, `monthly`, `quarterly`, or `annual`.

## Billing Gateway Integration
- Hosted Stripe Checkout session endpoint: `POST /api/v1/billing/invoices/{invoiceId}/checkout` (requires `X-API-Key`) persists durable session rows linked to invoices for lifecycle analytics.
- Hosted checkout lifecycle endpoints: `GET /api/v1/billing/sessions` + `GET /api/v1/billing/sessions/{sessionId}` expose workspace-scoped visibility, while `POST /api/v1/billing/sessions/{sessionId}/regenerate` triggers operator retries with optimistic locking on `updatedAt`.
- Lifecycle automation: `smplat_api.services.billing.sessions.sweep_hosted_sessions` performs expiry/abandonment sweeps and is safe to run on a scheduler or async worker tick.
- Recovery automation: `HostedSessionRecoveryWorker` runs continuously when `HOSTED_RECOVERY_WORKER_ENABLED=true`, logging sweeps to `hosted_session_recovery_runs` and coordinating notifications through SendGrid/Slack when configured.
- Webhook receiver: `POST /api/v1/billing/webhooks/stripe` validates Stripe signatures, persists the raw payload, and applies payment lifecycle updates.
- Processor event ledger: `/api/v1/billing/webhooks/stripe` writes to `processor_events` before mutating invoices. Replay operations live under `/api/v1/billing/replays` for deterministic reprocessing.
- Reconciliation endpoints under `/api/v1/billing/reconciliation` expose runs, discrepancies, and resolution actions for finance teams.
- Durable ingestion cursors are persisted in the `billing_sync_cursors` table. Each reconciliation run logs per-workspace cursor checkpoints so operators can monitor ingestion progress (see `docs/billing/reconciliation.md`).
- Run `poetry run pytest apps/api/tests/test_billing_gateway.py` before deployments touching billing flows.
- Stripe credentials are resolved per workspace through the Vault-backed resolver in `smplat_api.services.secrets.stripe`. Configure `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_STRIPE_MOUNT_PATH` for secure multi-tenant rollouts; development environments fall back to `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`.

## Hosted Session Recovery Configuration
- `HOSTED_RECOVERY_WORKER_ENABLED`: toggle the background worker.
- `HOSTED_RECOVERY_INTERVAL_SECONDS`, `HOSTED_RECOVERY_LIMIT`, `HOSTED_RECOVERY_MAX_ATTEMPTS`: cadence controls for scheduling.
- `HOSTED_RECOVERY_EMAIL_ENABLED`, `SENDGRID_API_KEY`, `SENDGRID_SENDER_EMAIL`, `HOSTED_RECOVERY_EMAIL_RECIPIENTS`: enable SendGrid dispatch for early-attempt emails.
- `HOSTED_RECOVERY_SLACK_ENABLED`, `HOSTED_RECOVERY_SLACK_WEBHOOK_URL`, `HOSTED_RECOVERY_SLACK_CHANNEL`: enable Slack escalation for higher-risk attempts.
- Invoke one-off sweeps with `python tooling/scripts/run_hosted_session_recovery.py --trigger manual`.

## Catalog Experimentation Automation
- `CATALOG_JOB_SCHEDULER_ENABLED`: start the APScheduler-backed automation runner that consumes `config/schedules.toml`.
- `CATALOG_JOB_SCHEDULE_PATH`: override the schedule file location (defaults to `config/schedules.toml`).
- `BUNDLE_ACCEPTANCE_AGGREGATION_ENABLED`: allow the scheduler to execute `run_aggregation` for bundle acceptance metrics.
- `BUNDLE_EXPERIMENT_GUARDRAIL_WORKER_ENABLED`: enable guardrail pauses + notifier dispatch (used by both the scheduler and the legacy interval worker).
- Scheduler retries + observability: each job definition supports `max_attempts`, `base_backoff_seconds`, `backoff_multiplier`, `max_backoff_seconds`, and `jitter_seconds`. Runtime metrics surface through `CatalogJobScheduler.health()` and `/api/v1/observability/prometheus` (counters for runs, retries, failures, timestamps).

## Provider Automation Replay Worker
- `PROVIDER_REPLAY_WORKER_ENABLED`: start the replay daemon that consumes `payload.scheduledReplays` on `fulfillment_provider_orders`.
- `PROVIDER_REPLAY_WORKER_INTERVAL_SECONDS`, `PROVIDER_REPLAY_WORKER_LIMIT`: control cadence and per-tick throughput (defaults to 5 minutes / 25 replays).
- Queue-friendly entrypoint: `poetry run provider-replay scheduled --limit 50` processes due replays once, while `poetry run provider-replay replay --provider-id=<id> --provider-order-id=<uuid>` triggers a single order immediately. Both commands reuse the same automation service, making it safe to wire Celery/BullMQ jobs or cron invocations without touching FastAPI internals.
- See `docs/provider-automation-queue-integration.md` for end-to-end queue wiring examples (Celery, BullMQ, cron).

## Provider Automation Alerts
- `PROVIDER_AUTOMATION_ALERT_WORKER_ENABLED`: enables the telemetry monitor that inspects replay/guardrail data on a cadence (15 minutes by default).
- `PROVIDER_AUTOMATION_ALERT_INTERVAL_SECONDS`, `PROVIDER_AUTOMATION_ALERT_SNAPSHOT_LIMIT`: tune the polling window and per-provider order sample size.
- Thresholds: `PROVIDER_AUTOMATION_ALERT_GUARDRAIL_FAIL_THRESHOLD`, `PROVIDER_AUTOMATION_ALERT_GUARDRAIL_WARN_THRESHOLD`, and `PROVIDER_AUTOMATION_ALERT_REPLAY_FAILURE_THRESHOLD` drive alert creation.
- Notifications: populate `PROVIDER_AUTOMATION_ALERT_EMAIL_RECIPIENTS` for SMTP dispatch and/or `PROVIDER_AUTOMATION_ALERT_SLACK_WEBHOOK_URL` (with optional `PROVIDER_AUTOMATION_ALERT_SLACK_CHANNEL`) for Slack escalations.
- Cohort load alerts: use `PROVIDER_LOAD_ALERT_ENABLED`, `PROVIDER_LOAD_ALERT_SHORT_WINDOW_DAYS`, `PROVIDER_LOAD_ALERT_LONG_WINDOW_DAYS`, `PROVIDER_LOAD_ALERT_SHARE_THRESHOLD`, `PROVIDER_LOAD_ALERT_DELTA_THRESHOLD`, `PROVIDER_LOAD_ALERT_MIN_ENGAGEMENTS`, and `PROVIDER_LOAD_ALERT_MAX_RESULTS` to tune when preset/provider overload notifications should be emitted (defaults 7d vs 90d with ≥60% share and 10+ engagements).
- Queue-friendly entrypoint: `poetry run provider-alerts` executes a single telemetry evaluation/notification cycle, making it easy to wire cron, Celery beat, or BullMQ jobs without booting the FastAPI app.

> meta: docs: hosted-recovery

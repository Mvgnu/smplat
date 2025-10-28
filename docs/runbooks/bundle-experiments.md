# Bundle Experimentation Runbook

## Overview
- **Service**: `CatalogExperimentService`
- **API Surface**: `/api/v1/catalog/experiments`
- **Tables**:
  - `catalog_bundle_experiments` – experiment definitions + guardrails.
  - `catalog_bundle_experiment_variants` – control/test overrides referencing bundles.
  - `catalog_bundle_experiment_metrics` – time-series telemetry with lift + guardrail flags.

## Launch Checklist
1. Ensure checkout acceptance aggregation jobs are scheduled via the catalog job scheduler or run `BundleAcceptanceAggregator.recompute()` manually.
2. Validate control/test bundles exist with up-to-date acceptance metrics.
3. Use `/admin/merchandising/bundles` → Experimentation control center to create a draft experiment with:
   - Control + test bundle slugs.
   - Sample size guardrail (e.g., `250`).
   - Acceptance guardrail (`min_acceptance_rate`, optional).
4. Publish overrides via "Publish overrides" button once draft is ready. Status flips to `running`.
5. Confirm storefront loaders ingest the new overrides (payload provenance should include `catalog-experiment-service`).

## Automation & Scheduling
- **Catalog job scheduler:** Set `CATALOG_JOB_SCHEDULER_ENABLED=true` and point `CATALOG_JOB_SCHEDULE_PATH` (defaults to `config/schedules.toml`) to load cron definitions. The default bundle experimentation schedule registers two jobs:
  - `bundle-acceptance-aggregation` → `smplat_api.jobs.bundle_acceptance.run_aggregation` (`*/30 * * * *`). Requires `BUNDLE_ACCEPTANCE_AGGREGATION_ENABLED=true`.
  - `bundle-guardrail-evaluation` → `smplat_api.jobs.bundle_guardrails.run_guardrail_evaluation` (`*/5 * * * *`). Respects `BUNDLE_EXPERIMENT_GUARDRAIL_WORKER_ENABLED` and reuses notifier plumbing.
- **Backfill telemetry:** Run `python tooling/scripts/backfill_bundle_experiments.py --lookback-days 30` nightly (e.g., `0 2 * * *`) before publishing new overrides. Pass `--dry-run` during rehearsals.
- **Guardrail worker (legacy):** When the scheduler is disabled, set `BUNDLE_EXPERIMENT_GUARDRAIL_WORKER_ENABLED=true` to run the interval loop every `bundle_experiment_guardrail_interval_seconds` (default 900s). Configure `bundle_experiment_guardrail_email_recipients` and `bundle_experiment_guardrail_slack_webhook_url` for alert delivery.
- **Storefront sync:** `ProductDetailPage` fetches experiments on each request; ensure `CHECKOUT_API_KEY` is populated wherever storefront pages render experiments.

## QA Fixtures
- Seed deterministic bundles + metrics via `python tooling/scripts/seed_bundle_experiments.py --slug qa-catalog` (supports `--dry-run`). The script rewires acceptance metrics, experiment variants, and guardrail flags for consistent demos.
- Use Playwright smoke flows or the new storefront experiment overlay (product page) to confirm variants, guardrail badges, and acceptance telemetry display.

## Guardrail Configuration
- `sample_size_guardrail`: minimum sample size before decisions. Aggregator flags guardrail breach when `sample_size < guardrail`.
- `guardrail_config.min_acceptance_rate`: minimum acceptance rate (0-1). Breach when latest metric dips below threshold.
- `guardrail_config.max_acceptance_rate`: optional ceiling (e.g., catch anomalous spikes).
- Guardrail evaluation is exposed via `POST /api/v1/catalog/experiments/{slug}/evaluate` and surfaced in the admin UI. Breaches are highlighted per variant.
- The `BundleExperimentGuardrailWorker` automatically pauses experiments when breaches persist and dispatches notifications. Review alerts before resuming.

## Monitoring & Dashboards
- Metrics persisted each aggregation run (daily by default) with lift vs. control.
- Admin UI cards show latest acceptance, conversions, lift, and guardrail status.
- Operators should pause experiments via the UI when guardrails trip and investigate CMS overrides / fulfillment signals.

## Rollback & Override Expiry
1. **Guardrail breach**: Click "Pause" in the admin UI. This updates status to `paused`; storefront will stop prioritizing experiment overrides on next publish.
2. **Manual rollback**: Use `PUT /api/v1/catalog/experiments/{slug}` with `status="paused"` or `status="completed"`.
3. **Override expiry**: When pausing, optionally push CMS overrides back to baseline bundles. Future aggregator runs keep telemetry for audit, but storefront should rely on control metadata after pause.

## Troubleshooting
- **No telemetry**: Ensure `BundleAcceptanceService` is recording orders and aggregator job ran after experiment launch.
- **API 401**: Confirm `CHECKOUT_API_KEY` configured for admin tooling/server functions.
- **Lift missing**: Requires a control variant with non-zero acceptance rate. Without control data lift remains `null`.
- **Guardrail stuck**: Check guardrail thresholds; a high `min_acceptance_rate` can lock experiments even with healthy control.

## SOP Notes
- Document learnings per experiment in merchandising retro notes.
- Archive experiments by setting status to `completed` once overrides are rolled back.
- Keep CMS override payload snapshots in the variant record (`override_payload`) for provenance.

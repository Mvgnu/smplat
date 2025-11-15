# 2025-12 · Configuration Presets & Validation Parity

## 1. Alignment With Goals
- The OptionMatrixEditor now uses the same FieldValidationPanel as the `/admin/products` flow, so helper text, regex testers, passthrough toggles, and sample guidance are serialized exactly once and honored by FastAPI + storefront.
- The new configuration preset builder lets operators craft curated bundles (labels, imagery, price hints) without hand-editing JSON, keeping Iteration 3 focused on tangible merchandising gains.
- Server + client validation paths share the same contract, so presets and custom-field metadata land in the DB ready for storefront previews and automation telemetry.

## 2. Challenges & Tracking
- **Preset integrity:** Draft presets often referenced groups/add-ons without persisted IDs; we added UI guards plus a server-side validator in `updateProductConfigurationActionImpl` to block invalid submissions before they hit FastAPI.
- **State divergence:** The old custom-field draft shape lacked visibility into passthroughs, defaults, and regex testers, so OptionMatrix edits dropped metadata. Rebuilding the draft model and converting to/from `ProductCustomFieldMetadata` eliminated the drift without needing a separate tracker.

## 3. Principle Feedback
- Iterative enhancement worked well—starting with shared helpers from the products admin minimized bespoke logic in OptionMatrix. The living documentation requirement nudged us to refresh the runbook + roadmap immediately, keeping operators informed about the new presets workflow.
- The 5-step cycle highlighted where tests were missing (API preset serialization), guiding us to add coverage instead of relying on manual QA.

## 4. Innovations
- Shared helpers (`buildCustomFieldMetadata`, preset normalization) now live in the merchandising editor, enabling future extract-to-hook work for broader state management.
- The preset builder UI piggybacks on live option/add-on IDs, so captured presets can be replayed from storefront previews or telemetry snapshots without extra mapping layers.

## 5. Outcome vs. Goals
- Iteration 3 called for “configuration blueprints”; with the preset builder, validated metadata, and documentation in place, admins can author blueprints end-to-end while the API enforces data contracts. Remaining work centers on storefront consumption and calculator previews, not basic CRUD plumbing.

## 6. Recent Iteration Notes (2025-11-14)
- Storefront marketing cards now expose an “Apply in configurator” CTA that reuses the same preset payload ProductConfigurator expects, so prospects can jump straight from a curated hero card to a configured cart without reselecting dozens of options.
- Preset identifiers/labels now travel through the cart store, checkout payload, and `/api/v1/reporting/blueprint-metrics`, letting analytics surfaces report which blueprints get adopted (and how often) instead of inferring from selected options.
- The admin CreationPreview preset grid now mirrors storefront metadata—option/add-on summaries, plan hints, and hero art—so operators can sanity-check the exact blueprint the storefront will display before publishing.
- Merchandising now consumes the reporting endpoint directly; operators see top presets/add-ons/providers in the dashboard, closing the feedback loop between authoring and storefront behavior without exporting raw JSON.
- CTA clicks are logged through `/api/analytics/offer-events`, giving instrumentation teams a lightweight funnel metric for “Viewed preset card → Applied preset” before any checkout traffic occurs.
- Configurator-side preset applies now emit the same analytics events, so marketing CTA performance and operator-led preset replays can be compared without spelunking through checkout payloads.
- The new preset analytics section in Merchandising surfaces CTA vs configurator applies/clears per day, powered by `/api/v1/analytics/preset-events`, so ops can react before those trends show up in checkout exports.
- Preset alert dispatch now lives in `poetry run preset-alerts`, which calls `PresetEventAlertJob`, ensures the daily metric window is hydrated, sends Slack/email digests when enabled, and snapshots each run into `preset_event_alert_runs` for traceability.
- The catalog scheduler calls `preset-event-alerts` nightly (02:30 UTC) so alert history shows up with other automation jobs and ops can audit cadence without manual shells.
- Metric backfills run via `poetry run preset-metrics --days 90` (and the new `preset-event-metrics` scheduler entry at 02:00 UTC), keeping at least three months of persisted timeline data available for dashboard sparklines.
- Each `preset_event_daily_metrics` row now stores `trend_stats` (7/30-day averages, min/max totals, clear-rate snapshots), and the admin dashboard sparkline consumes those stats to plot applies vs clears directly from persisted data.
- Cohort breakdowns (top presets, risky presets, channel cohorts) plus preset-specific alerting ensure ops can jump straight from an alert to the exact blueprint or channel responsible without exporting raw events.
- 90-day cohorts now sit beside the 7d/30d slices, so ops can instantly tell whether a regression is a blip or a trend when triaging merchandising health.
- Blueprint KPIs consume those cohorts too, showing 7d vs 30d vs 90d run rates alongside a provider automation pulse card that links directly into the fulfillment tooling, keeping merchandising and provider ops aligned.

## 7. Provider Cohort Alignment (2026-01-18)
- `BlueprintMetricsService` now emits a `presetProviderEngagements` bundle (7/30/90d windows) that joins `order_items.selected_options.presetId` with `fulfillment_provider_orders`, so every provider/service combo is attributable to the preset that triggered it.
- `/admin/fulfillment/providers` renders the new “Preset-driven provider load” panel plus mirrored preset risk alerts, letting ops spot spikes (share-of-preset + provider spend) before replaying automation.
- The provider automation runbook has been updated to call out this workflow: alert → cohort panel → provider card/order history → automation action. This keeps merchandising telemetry visible during every fulfillment escalation.
- `ProviderAutomationAlertWorker` now attaches these cohort load alerts to its Slack/email digests, so admins receive proactive notifications whenever a single provider shoulders most of a preset’s traffic in the short window.
- Load alert digests now carry `/admin/merchandising`, `/admin/fulfillment/providers`, and `/admin/orders` links. The AutomationStatusPanel and both dashboards render matching CTA buttons, so responding to a spike is literally one click away from the relevant preset/provider surface.

# Admin Merchandising Experience Upgrade Plan

## Context Snapshot
- Current operator surface: `/admin/merchandising/page.tsx` renders channel/status controls, point asset uploads, and the `OptionMatrixEditor`, backed by `updateProductConfigurationAction`.
- Configuration data flows through `ProductConfigurator` types in `src/components/products/product-configurator.tsx` and persists via `/apps/web/src/server/catalog/products.ts`.
- Product media uploads land in `public/uploads` with minimal metadata and single-file coverage.
- There is no cohesive UX for composing multi-image galleries, enriched form fields, or scenario-driven configuration presets and calculators.
- Journey-driven product workflows (e.g. fetching Instagram account data) are not yet represented in the merchandising contract.
- Advanced add-on pricing now travels through shared helpers (`product-pricing.ts`), exposing computed deltas, percentage multipliers, and fulfillment override metadata to storefront/cart/admin experiences.
- Fulfillment overrides are backed by a new provider/service registry and `fulfillment_provider_orders` log, allowing us to reason about downstream provider engagements per order item.

## Goals
- Enable operators to manage structured product assets (multi-upload, ordering, labeling) without leaving the dashboard.
- Provide a richer form-field builder with explicit required/optional controls, validation hints, and storefront preview.
- Introduce configurable product configurations that support tiered offerings, contextual descriptions, and price/time calculators.
- Lay groundwork for pluggable “journey components” that can execute scripts (e.g. IG handle lookup) and surface interactive inputs during checkout.
- Maintain compatibility with existing API contracts while iteratively extending the merchandising schema.
- Establish provider-aware fulfillment orchestration so merchandising can route service overrides to vetted partners with clear auditing, reconciliation hooks, and downstream reporting.

## Status Update · Advanced Add-ons
- **Shared pricing metadata**: `product-pricing.ts` now normalizes add-on pricing snapshots (flat, percentage, service override) and exposes computed totals, ensuring storefront, cart, admin preview, and checkout payloads stay in sync.
- **Fulfillment provider registry**: A static registry and schema validation prevent unknown override IDs; order processing writes `fulfillment_provider_orders` rows capturing provider, service action, requested amounts, and payload context.
- **Persisted provider catalog**: Alembic migrations are upgraded through `20251210_39_fulfillment_provider_catalog` (applied to Postgres on 2025-01-10). Providers/services live in `fulfillment_{providers,services}`, seeded with `xyz` + overrides, and surfaced via the new admin page at `/admin/fulfillment/providers`.
- **API + caching parity**: `ProviderCatalogService` refreshes the domain cache, `service_exists` reads from persistence, and enum wiring now stores lower-case labels while keeping Python `Enum` ergonomics.
- **Checkout + cart serialization**: Cart selections and checkout payloads now forward service override information (mode, amount, provider IDs) enabling reconciliation and future provider dashboards.
- **Admin parity**: `ProductsClient` resolves add-on metadata into clean payloads; the admin preview and storefront configurator render provider-aware copy for overrides.
- **Verification**: `poetry run alembic upgrade head`, `pnpm --filter @smplat/web test:unit -- product-configurator.test.tsx`, and an async smoke check of `ProviderCatalogService.list_providers()` validated the path end-to-end.
- **Provider automation parity**: Fulfillment provider orders now store preview quantities, payload templates, and full rule sets, and the admin orders UI exposes those rules to operators. Provider automation endpoints (order replay + scheduled replays) reuse this metadata to render exact provider payloads during replays and future cron executions.
- **Automation execution layer**: `ProviderOrderReplayWorker` now scans scheduled provider order entries, calls `ProviderAutomationService.replay_provider_order`, and records success/failure trails so admin surfaces and future cron hooks stay in sync.
- **Admin replay controls**: `/admin/fulfillment/providers` and `/admin/orders` now surface replay + scheduling forms per provider order, along with rule blocks and response payloads so operators can triage automation without switching contexts.
- **Provider rule telemetry**: Analytics helpers (`apps/web/src/lib/provider-service-insights.ts`) now summarize replay executions vs failures, pending scheduled runs, and guardrail pass/warn/fail counts per service so dashboards and docs can render Provider Rule Insights without duplicating payload parsing.
- **Automation health dashboard**: The provider catalog surfaces telemetry cards (per-provider) covering replay executions, failure cadence, scheduled backlog, and guardrail posture per service, giving operators an inline “Provider Rule Insights” view before they touch the replay forms.
- **Order-level insights**: `/admin/orders` now pairs each order’s provider automation log with a telemetry summary (provider orders, replay successes/failures, scheduled backlog, guardrail posture) so operators see automation health without leaving the fulfillment drill-down. A new “Provider automation insights” section at the top of the page aggregates the same metrics across the catalog and highlights the noisiest providers so leadership dashboards remain in lockstep with on-the-ground tooling.

## Current State · Preset Analytics
- Preset interactions flow from ProductConfigurator + marketing cards → `/api/analytics/offer-events` → the `PresetEventDailyMetricService`, which persists rollups in `preset_event_daily_metrics`.
- `/api/v1/analytics/preset-events` now returns windowed stats (totals, sources, timeline, alerts) backed by the persisted data instead of raw fan-out queries. Alerts flag high clear rates (clears ≥40 % of applies over the last 7 days with ≥10 applies).
- `/admin/merchandising/page.tsx` renders blueprint KPIs, preset cards, alert callouts, and stacked timelines sourced from `apps/web/src/server/analytics/preset-events.ts`.
- The dashboard now features a multi-series applies-vs-clears sparkline plus “Top presets” and “Risky presets” cards powered by the enriched breakdown payload coming from `/api/v1/analytics/preset-events`.
- The new `PresetEventAlertJob` (see `apps/api/src/smplat_api/services/analytics/preset_event_alerts.py`) runs via `poetry run preset-alerts`, ensures the metric window exists, dispatches Slack/email digests when enabled, and records audit history in `preset_event_alert_runs`.
- `preset_event_daily_metrics` now persist `trend_stats` (rolling 7/30-day averages, min/max windows, and clear-rate ratios), powering the multi-series applies-vs-clears sparkline and rolling average callouts in the merchandising dashboard.
- Per-preset cohort breakdowns now capture CTA/configurator applies, clears, net deltas, and risk flags for 7d/30d/90d windows, while channel cohorts summarize applies vs clears per source; alerts also flag specific risky presets so ops knows exactly which blueprint to revisit.
- Blueprint KPIs now query 7d/30d/90d windows in parallel, surfacing long-baseline order/preset/revenue run rates plus a “Provider automation pulse” card that links operators directly into the fulfillment provider tooling.

## Open Threads / Next Steps
1. **Alert Dispatch**
   - ✅ `poetry run preset-alerts` (wired through `smplat_api.tasks.preset_alerts`) executes the nightly job, evaluates alerts, and persists results. When `PRESET_EVENT_ALERT_NOTIFICATIONS_ENABLED` and `PRESET_EVENT_ALERT_EMAIL_RECIPIENTS` / Slack webhook envs are configured, the notifier pushes digests linking back to the merchandising dashboard.
   - ✅ The catalog scheduler now dispatches `preset-event-alerts` at `02:30 UTC` via `smplat_api.jobs.preset_event_alerts.run_preset_alerts`, so alert runs show up beside other automation jobs in observability dashboards.
   - Files to watch: `apps/api/src/smplat_api/jobs/preset_event_alerts.py`, `apps/api/src/smplat_api/services/analytics/preset_event_alerts.py`, `apps/api/src/smplat_api/tasks/preset_alerts.py`, `apps/api/src/smplat_api/models/preset_event_alert_run.py`, `apps/api/config/schedules.toml`.
2. **Historical Backfill & Sparkline Fidelity**
   - ✅ `poetry run preset-metrics --days 90` (or the nightly `preset-event-metrics` scheduler job at 02:00 UTC) backfills daily metrics so dashboards always have a 90-day window without on-demand fan-out.
   - ✅ Rolling averages/min/max now live in the `trend_stats` JSON blob, smoothing sparkline rendering and exposing rolling net/apply averages directly in the dashboard.
   - ✅ 90-day cohort slices now back the breakdown cards, blueprint KPIs, and preset alerts so ops can compare short-term spikes vs long-term baselines without exporting raw data.
   - Next: push the same aggregates into provider automation dashboards + runbooks so merch + fulfillment owners share the exact risk signal.
3. **Journey Components (Iteration 4)**
   - Define schemas (`packages/types/src/merchandising/journey.ts`), Alembic migrations, FastAPI models, admin drawer UI, and runtime wiring per the Iteration 4 scope below.
   - Before coding, re-read the Iteration 4 plan and prepare contracts between Next.js admin and FastAPI so API + UI remain in sync.
4. **Hardening & Docs (Iteration 5)**
   - Once Journey Components work begins, schedule E2E coverage (Playwright) plus doc updates across `docs/runbooks/` and admin README references.

## Testing & Ops Notes
- `poetry run pytest tests/test_analytics_preset_events.py tests/test_preset_event_alerts.py`
- `pnpm --filter @smplat/web test:unit -- product-configurator`
- `poetry run preset-alerts` to smoke test alert dispatch (ensure env recipients/webhooks are set when enabling notifications).

## Status Update · Field Composer & Validation
- **Schema extensions**: Custom field metadata now carries validation ranges, regex rules, default values, passthrough flags, and conditional visibility descriptors (`ProductCustomFieldMetadata`, `normalizeCustomFieldMetadata`, and `serializeCustomFieldMetadata`).
- **Admin builder**: `/admin/products` composer surfaces numeric guardrails, default value inputs, and a visibility rule editor that links conditions to option groups, add-ons, channels, and plans while persisting the enriched metadata payload.
- **Runtime gating**: `ProductConfigurator` applies default values automatically, enforces numeric validation, and hides/clears inputs until their visibility conditions are satisfied—keeping `onChange` payloads aligned with storefront expectations.
- **Regression coverage**: Added unit tests for metadata helpers and configurator visibility/default handling (`product-metadata.test.ts`, `product-configurator.test.tsx`) alongside targeted runs of the web unit suite.

## Status Update · Configuration Blueprints
- **Blueprint metadata contract**: `ProductOptionMetadata` now models marketing taglines, fulfillment SLAs, hero imagery, and calculator descriptors via strongly typed helpers (`normalizeOptionMetadata`, `serializeOptionMetadata`), ensuring admin composer payloads round-trip safely across API boundaries.
- **Storefront preview parity**: `ProductConfigurator` renders blueprint callouts—hero preview, tagline, SLA badge, and calculator sample—using sanitized expressions evaluated against provided sample inputs so operators and buyers see consistent short-form pricing narratives.
- **Unit coverage**: Added `renders blueprint metadata preview` regression in `product-configurator.test.tsx`, exercising hero previews, SLA copy, and calculator output under the targeted Jest suite (`pnpm --filter @smplat/web test:unit -- product-configurator.test.tsx`).
- **Admin ergonomics**: `/admin/products` now ships hero media quick-picks, inline calculator validation with sample output, and blueprint preview cards that mirror storefront layout for faster iteration.
- **API persistence**: `parseConfigurationPayload` + `replaceProductConfiguration` normalize blueprint metadata before issuing API writes, keeping hero/calculator fields in sync for storefront mappers.

## Status Update · Journey Components (Iteration 4)
- **Contracts + storage**: Shared TypeScript definitions (`packages/types/src/merchandising/journey.ts`) plus Alembic migrations, SQLAlchemy models, and Pydantic schemas landed for `journey_components` and `product_journey_components`. FastAPI now exposes `/api/v1/journey-components` CRUD and enriches product detail responses with journey assignments.
- **Admin composer integration**: `/admin/products` fetches the journey registry, lets operators attach components with ordered display slots, channel eligibility hints, metadata JSON, and per-input bindings (static, product field, runtime). Product create/update payloads now serialize these attachments, so the API stays in sync with operator intent.
- **Runtime scaffolding**: Journey runs persist via the new `journey_component_runs` table, surfaced through `POST /api/v1/journey-components/run` (enqueue) and `GET /api/v1/products/{id}/journeys` (overview + recent runs). A `JourneyRuntimeService` validates product/component bindings, stores resolved inputs, and dispatches Celery tasks so future worker implementations can plug in without reshaping the API contract.
- **Runtime execution backend**: `JourneyRuntimeExecutor` now swaps in a configurable HTTP runner (`JOURNEY_RUNTIME_RUNNER_URL`, API key, timeout) that sends structured `JourneyScriptRequest` payloads to the actual script host. Each run records telemetry (`runner`, latency, binding count, output/error previews) inside `journey_component_runs.telemetry`, powering admin dashboards and log-based observability without additional joins.
- **Admin observability**: `/admin/products` now pulls the runtime overview (`GET /api/v1/products/{id}/journeys`) into the composer sidebar so operators can inspect the latest run statuses, latency, bindings resolved, and runner telemetry with a one-click refresh.
- **Next milestones**: a) hydrate the admin drafts with existing journey assignments when editing an SKU, b) surface component health/usage metrics and registry filters in the UI, c) implement the `JourneyRuntimeService` + queue/worker wiring (validation, retries, telemetry), d) extend storefront/server actions to execute journey steps during checkout and automation flows, e) finish provider orchestration so product configs map to the correct upstream APIs (routing, retries, refills, metrics surfaced to admin & customer order detail).

## Status Update · Journey Runtime Hooks
- **Admin composer previews**: `/admin/products` now exposes per-component preview actions that call the runtime service (`runJourneyComponentPreview`). Operators can queue test executions with the saved bindings/metadata, see success/error feedback inline, and refresh telemetry without leaving the composer.
- **Shared runtime client**: A new `apps/web/src/server/journey-runtime.ts` helper centralizes auth + fetch logic for `POST /api/v1/journey-components/run` and `GET /api/v1/products/{id}/journeys`, ensuring checkout, admin, and automation surfaces use consistent headers and error handling.
- **Orders automation backfill**: `/admin/orders` ships a “Journey automation” form + server action that replays automation/post-checkout/operator stage components for selected products or entire orders. This covers the roadmap ask for automation/backfill hooks that respect telemetry/trigger metadata.
- **Documentation alignment**: The journey runtime runbook now lists checkout, admin preview, and orders automation as supported invocation surfaces, keeping operators aware of the new entry points.
- **Provider telemetry parity**: The public orders API now hydrates each payload with `providerOrders`, so storefront dashboards and downstream automations can see refill/replay history without going through operator-only surfaces.
- **Admin + storefront telemetry surfaces (NEW)**: `/admin/orders` and `/account/orders` now render the embedded `providerOrders` arrays directly. Both screens summarize replays/refills, expose provider-order cards, and rely on the shared DTO normalizer, so automation parity is guaranteed across operator and customer experiences.

## Status Update · Pricing Experiments
- **Automatic storefront telemetry**: PDPs now log exposures the first time a visitor sees an active experiment (deduped per session) and checkout posts conversion/revenue events via `/api/catalog/pricing-experiments/{slug}/events`. This keeps FastAPI metrics in sync without manual admin updates.
- **Variant-aware payloads**: Checkout snapshots the assigned variant per cart line inside `journeyContext.pricingExperiments` and mirrors the same structure under each order item’s `attributes.pricingExperiment`. Success pages and account history read those tags to display “Dynamic pricing lab” badges and to emit analytics events keyed by `{slug, variantKey, assignmentStrategy}`.
- **Docs + runbook alignment**: `docs/storefront-loyalty-context.md` captures the expanded pricing experiment contract, `docs/storefront-platform-roadmap.md` highlights the analytics segmentation flow, and the new `docs/runbooks/feature-flags.md` runbook explains how to seed `NEXT_PUBLIC_FEATURE_FLAGS` per environment so ops can toggle experiments confidently.
- **Operator visibility**: `/admin/onboarding` now consumes the same pricing experiment events, rendering “Active variant” cards on each journey so concierges can triage experiments (and filter stalled journeys) without jumping into other dashboards.

### Outstanding Scope Snapshot

- **Provider execution loop**: ensure each product configuration can target different API providers and payloads, persist run artifacts, trigger refills, and expose delivery telemetry in both the admin experience (aggregate/order views) and storefront order history.
  - ✅ API responses now include `providerOrders`, and both admin/storefront order views consume the same telemetry feed.
  - ⛳ Next: exercise provider retry/refill flows end-to-end (queue → worker → API) and add coverage that replays show up in storefront order history after manual actions.
- **Storefront UX**: tighten the shop flow (home → listings → product detail → upsells) with richer trust blocks, gamification cues, and a cohesive rewards story.
- **Customer journey hand-offs**: allow account dashboards to save platform profiles (e.g., Instagram handle) and deep-link into product ordering with pre-filled configurations.
- **Commerce fundamentals**: persist customer billing/contact information for invoices, expose invoice downloads/order tracking, and wire reporting widgets so customers can “track how their account performs over time.”

## Status Update · Provider Wallets & Rule Builder
- **Wallet telemetry & refills**: `/admin/fulfillment/providers` surfaces live balance snapshots (amount, currency, payload preview) with a manual refresh action wired to `POST /api/v1/fulfillment/providers/{id}/balance/refresh`. The page also lists recent provider orders via `GET /api/v1/fulfillment/providers/{id}/orders`, exposing upstream payloads, refill history, and a CSRF-protected refill form that calls `POST /api/v1/fulfillment/providers/{id}/orders/{orderId}/refill`.
- **Shared automation client**: Endpoint templating/rendering moved into `provider_endpoints.py` and a new `ProviderAutomationService`, so the fulfillment worker, balance job, and admin actions reuse the same template parser, error handling, and balance extraction.
- **Rule-driven overrides**: Add-on metadata now supports structured `serviceRules` (geo/channel/amount/drip conditions + override payloads). The admin composer ships a visual rule builder around these rules, and the storefront/admin preview includes live margin telemetry (customer delta vs provider cost) so operators can validate profitability before publishing.
- **Checkout & order surfacing**: Cart/checkout payloads persist blueprint metadata for each option, and admin order review surfaces render taglines, SLAs, hero assets, and calculator previews alongside raw JSON snapshots.

## Status Update · Provider Service Catalog
- **Structured metadata contract**: Fulfillment service schemas (`apps/api/src/smplat_api/schemas/fulfillment_provider.py`) now enforce typed metadata for cost models, cadence hints, guardrails, payload templates, and default inputs. Responses hydrate these models automatically, so downstream callers never juggle untyped blobs.
- **Shared TS types + normalization**: `packages/types/src/fulfillment/services.ts`, `apps/web/src/types/fulfillment.ts`, and the Next.js fetcher (`apps/web/src/server/fulfillment/providers.ts`) expose the same structure with resilient guards and sane defaults, keeping admin/server parity even for legacy rows.
- **Margin-aware admin UX**: Each service card (`apps/web/src/app/(admin)/admin/fulfillment/providers/ProviderCatalogClient.tsx`) surfaces cost/cadence summaries, payload template hints, and a live margin preview that flags guardrail violations before operators save a change.
- **Fulfillment blueprint composer**: `/admin/products` now pulls the provider catalog directly into add-on pricing. Selecting a service seeds cost, currency, drip, and payload defaults, lets operators tweak preview quantities, and renders live margin/cadence/guardrail summaries so merchandising teams see the downstream impact before publishing.
- **Orchestration parity**: Checkout selections carry preview quantities + payload templates through to the API (`ProductAddOnPricingSnapshot`, cart/on-order payloads), and the fulfillment service includes those values when invoking provider endpoints—so automation templates can reference `{{previewQuantity}}` or custom payload fields without guesswork.
- **Rule builder assists**: The add-on service rule editor autocompletes provider + service IDs from the live catalog, auto-filling provider IDs when you pick a service and exposing preview quantity overrides alongside drip/cost controls for each rule.
- **Verification**: `pnpm --filter @smplat/web typecheck` covers the new shared types + UI logic; FastAPI continues to rely on Pydantic validation for the API contract.

## Status Update · Rich Text Marketing Surfaces
- **Typed Lexical bridge**: Removed `@ts-nocheck` from `apps/web/src/components/rich-text/{custom-converters,marketing-converters,rich-text}.tsx` and tightened the local stubs in `src/types/external-modules.d.ts`, so Payload’s RichText adapter, converter maps, and serialized nodes are all described by a single source of truth.
- **Converter utilities**: Introduced `withFields`/`asArray` helpers that merge CMS payloads with sane defaults, making each marketing block (hero, CTA, feature grid, testimonials, pricing, stats, team, etc.) resilient to partially populated fields while keeping JSX props strongly typed.
- **Renderer parity**: The shared `<RichText>` component now guards against empty Lexical states, stitches together default, marketing, and custom converter sets, and falls back to PortableText for Sanity arrays—ensuring merchandising narratives render identically across admin preview, storefront, and downstream notifications.
- **Future leverage**: With strict typing in place we can safely extend converter cases (e.g., journey-aware callouts, provider telemetry badges) and trust TypeScript to flag schema drift before it reaches production marketing surfaces.

## Iterative Delivery Outline

### Iteration 1 · Structured Asset Management
- **Structured asset contract:** Extend `ProductAssetDraft` (shared via `packages/types/src/product-configurator.ts` and `apps/web/src/types/product.ts`) with `clientId`, `displayOrder`, `isPrimary`, `label`, `altText`, `usageTags[]`, `checksum`, and `storageKey`. Mirror the schema inside FastAPI (`apps/api/src/smplat_api/schemas/product.py`) so `option.media` rows and any future `product_assets` table store the same shape, and keep Prisma/SQLAlchemy models in lockstep.
- **AssetGalleryManager UI:** Build `apps/web/src/components/admin/assets/AssetGalleryManager.tsx` to orchestrate drag-and-drop multi-select uploads, queueing, retry/resume, keyboard-driven reordering, and inline metadata editing. Mount the component inside `ProductsClient`/`OptionMatrixEditor` so operators can curate galleries without leaving the merchandising form, and surface per-asset validation (size, mime, dimension hints) before uploads fire.
- **Server + persistence:** Update `/apps/web/src/server/catalog/products.ts` actions and `/apps/web/src/app/(admin)/admin/products/actions.ts` to accept the structured asset array, validate ordering + uniqueness, and persist to storage. FastAPI should expose a parallel endpoint that stamps storage metadata (S3 bucket, region, key) and records audit info (uploader, checksum) while retaining the current `public/uploads` fallback for local dev. Introduce an Alembic migration (e.g., `product_assets` table with FK to `products`) if we need relational querying, plus seeds/migrations to backfill existing media.
- **Previews + drafts:** Wire `CreationPreview` and storefront `ProductConfigurator` to consume the ordered gallery, display usage tags (“hero”, “detail”, “social proof”), and show upload progress for pending assets. Draft assets should remain editable until the server acknowledges persistence, and preview cards should surface alt text + caption so operators validate accessibility before publishing.
- **Role & security:** Keep CSRF + RBAC enforcement inside the server actions, move signed-upload URL issuance into `/api/merchandising/products/upload-url`, and ensure temp files are cleaned up via a background cron (`asset-upload-cleanup` script) so queues cannot be abused.
- **Verification & docs:** Add `AssetGalleryManager.test.tsx` to assert queue/reorder behaviors, plus FastAPI tests that round-trip the structured payload (including failure cases for invalid ordering, oversized files, or missing metadata). Document the uploader flow and env requirements in `docs/runbooks/asset-uploader.md`, covering storage rotation, checksum verification, and manual remediation steps.

### Iteration 2 · Rich Form-Field Builder & Validation
- **Schema + contracts:** Expand `ProductCustomFieldMetadata` to include `validationRules`, `visibilityRules`, `helperText`, `sampleValues`, and regex snippets. Update the shared contracts in `packages/types/src/product-configurator.ts`, `apps/web/src/types/product.ts`, and `apps/api/src/smplat_api/schemas/product.py`, ensuring Prisma/SQLAlchemy columns store JSONB with migrations + seeds to backfill defaults.
- **Field builder UI:** Introduce a composable `FieldValidationPanel` under `apps/web/src/components/admin/fields/` that lets operators toggle required/optional, set numeric ranges, author regex patterns with inline testers, define default values, and gate visibility by channel/region/add-on. Provide a live storefront preview so changes are validated before publishing.
- **Server enforcement:** Update `updateProductConfigurationAction`, `parseConfigurationPayload`, and the FastAPI merchandising endpoints to validate incoming rules, normalize expressions, and store helper text. Checkout/server actions must re-run the validation schema to prevent client bypasses and emit structured error payloads for storefront rendering.
- **Runtime experience:** Enhance `ProductConfigurator` to hydrate the new validation metadata, render inline errors, and block submission until all required fields pass. Emit telemetry via `serverTelemetry` capturing validation failures, and add feature flags so we can roll out per-product/channel.
- **Verification & docs:** Ship Jest tests (`product-configurator-validation.test.tsx`, `FieldValidationPanel.test.tsx`) to cover serialization + runtime validation, plus FastAPI tests for schema enforcement and error responses. Document available rule types, regex guidance, and rollout steps inside `docs/admin-product-automation-plan.md`, and add a reflection once operators pilot the builder.

### Iteration 3 · Product Configuration Blueprints
- Design “configuration presets” data shape describing bundles such as `100 Followers / €3` with optional imagery.
- Update `OptionMatrixEditor` to allow per-option rich metadata: marketing tagline, fulfillment SLA, calculator hints.
- Introduce calculator builder: define inputs (`amount`, `days`) and expression blocks (e.g. `amount / days`) for short-description synthesis.
- Render preview cards showing computed short descriptions and pricing impacts via `ProductConfigurator`.
- Extend add-on editor UI to surface pricing modes (flat / percentage / service override), validation feedback, and provider hints while keeping legacy price delta fallback synced automatically.
- ✅ OptionMatrixEditor now ships the configuration preset builder + FieldValidationPanel parity, so operators can capture curated bundles, helper text, passthrough flags, and preset-ready defaults while the server action validates option/add-on/plan IDs before persisting.
- ✅ CreationPreview and the storefront merchandising page now surface those presets (hero art, badges, price hints), and saved configurations retain the preset linkage so operators/customers can reapply curated bundles with a single click.
- ✅ Preset cards in the storefront marketing rail now include an “Apply in configurator” CTA that seeds the ProductConfigurator via shared preset state, CreationPreview renders the same selection/add-on summaries operators expect, and cart → checkout payloads carry preset IDs/labels so blueprint analytics can report adoption.
- ✅ The merchandising dashboard now consumes `/api/v1/reporting/blueprint-metrics`, rendering preset/add-on/provider adoption trends with 7d vs 30d run-rate trends so operators can see which blueprints resonate without leaving the control hub; CTA clicks are also proxied through the analytics endpoint for immediate telemetry.
- ✅ Preset CTA/configurator telemetry is aggregated via `/api/v1/analytics/preset-events`, letting operators compare marketing-card applies vs configurator clears per-day directly inside Merchandising without exporting raw checkout logs.

### Iteration 4 · Journey Components
- **Contract + persistence:** Define `JourneyComponentDefinition` inside `packages/types/src/merchandising/journey.ts` capturing trigger fields, script slug, input/output schemas, provider dependencies, timeout/ retry policy, and telemetry labels. Create Alembic migrations for `journey_components` + `product_journey_components` tables and expose Pydantic models in `apps/api/src/smplat_api/schemas/product.py` so FastAPI + Next.js stay aligned.
- **Admin tooling:** Ship a journey designer drawer under `/admin/products` that lists reusable components, allows inline script authoring (Monaco editor with TypeScript hints), and provides “Test run” harnesses that POST to `/api/v1/journey-components/test`. Operators should be able to map product/add-on fields into component inputs, attach provider credentials/secrets, and preview rendered storefront steps before saving.
- **Execution pipeline:** Create a `JourneyRuntimeService` in FastAPI that validates component payloads, persists pending runs, and dispatches work to Celery/BullMQ jobs (shared queue definitions with provider automation). Results should hydrate a `journey_component_runs` log and update the merchandising document with derived data (e.g., Instagram avatar) when applicable.
  - ✅ Runtime service now persists runs + resolved bindings, `JourneyRuntimeExecutor` normalizes inputs (product/productComponent/runtime paths), and both Celery + in-process workers (`JourneyRuntimeWorker`) process the queue with retry-policy-awareness; docs/runbooks/journey-runtime.md captures toggles + manual run guidance.
- **Storefront integration:** Extend the checkout `ProductConfigurator` to insert journey-driven steps when components exist. UI renders forms based on the input schema, calls a server action to execute the script, and surfaces the response (preview, error, quota warnings) before allowing checkout to proceed.
- **Observability + governance:** Emit structured logs/traces for every execution, add rate-limit + timeout guards per component, and expose health cards in the admin journey list so ops can monitor failures. Add unit tests for the component registry plus integration tests walking admin config → storefront execution → backend queue run.

### Iteration 5 · Hardening & Documentation
- Backfill API typings in shared package (`@/types/product`) for new structures.
- Add end-to-end tests (Playwright) covering multi-step configuration and storefront rendering.
- Update operator documentation (`docs/` knowledge base) and in-app `README.md` references.
- Plan phased rollout toggles (feature flags or product-level gating).

## Cross-Cutting Technical Threads
- **Data Contracts:** Coordinate with `apps/api` service to accept richer configuration payloads; version endpoints where needed.
- **State Management:** Consider extracting local state in `OptionMatrixEditor` into dedicated reducer/hooks once complexity increases.
- **Validation & Telemetry:** Expand existing server actions to emit telemetry spans for uploads, configuration publish, and script runs.
- **Accessibility:** Ensure uploader and dynamic components meet a11y requirements (keyboard, ARIA, captions).
- **Provider Governance:** Maintain the fulfillment service registry alongside environment toggles; surface provider capabilities, rate limits, and audit status to operators.
- **Reporting:** Plan dashboards that aggregate `fulfillment_provider_orders` for revenue share, SLA monitoring, and troubleshooting.

## Dependencies & Risks
- Requires storage strategy for larger asset payloads (local uploads may be temporary; plan S3/object storage integration).
- Script harness introduces sandboxing concerns—need evaluation of execution environment and security constraints.
- Calculator expressions must be validated to avoid arbitrary code execution; design safe expression parser.
- Storefront must gracefully handle products missing new metadata to avoid regressions during migration.
- Provider registry is currently static; moving to a persisted model will require admin tooling, migrations, and secure credential management per provider/service pair.

## Immediate Next Steps
1. **Checkout success & receipt parity (Iteration 3 follow-up)**: Extend checkout confirmation/success screens to echo blueprint metadata (tagline, SLA, hero, calculator previews) so customers see the same guidance after payment. ✅ Checkout success, `/account/orders`, `/admin/orders`, and payment-success receipt emails now surface the enriched blueprint snapshots with copy/share links plus JSON exports; fulfillment retry + completion alerts + invoice overdue reminders + weekly digests also attach blueprint snippets to keep operators aligned. `/api/orders/[id]` and the new `/api/orders/export` endpoint reuse the shared receipt payload, so downloadable reports + admin exports stay in sync. An audit on 2025-02-14 confirmed no other customer-facing notifications or exports consume the legacy `selected_options` payload (remaining references live only in internal fulfillment/provider tooling).
2. **Provider health & governance**: Add scheduled health snapshots (cron/worker), rate-limit hints, and documentation so operations can audit provider statuses from the new catalog. ✅ `fulfillment-provider-health` now runs every 15 minutes, pings each provider/service `metadata.health` endpoint (defaults to `/health`), and writes the outcome to `fulfillment_providers` + `fulfillment_services` so the admin catalog surfaces live statuses without manual refresh.
3. **Reporting prep (Milestone 5)**: Define SQL/Materialized views targeting `fulfillment_provider_orders` for revenue, SLA, and failure-rate dashboards; document desired admin/customer transparency surfaces. ✅ `/api/v1/reporting/blueprint-metrics` now aggregates blueprint option/add-on adoption plus provider engagement (backed by the shared receipt snapshots + `fulfillment_provider_orders`). The admin dashboard can call this endpoint to render trend cards without recreating ad-hoc queries.
4. **Provider services as first-class merchandising primitives (NEW)**:
   - **Schema + migrations**: Promote the static registry into persistent `fulfillment_providers`, `fulfillment_services`, and `provider_service_rules` tables (Alembic + Prisma alignment). Capture cost tiers, cadence metadata, supported order payload schemas, and balance endpoints in the DB so automations can reason over live data.
   - **Service modeling UI**: `/admin/fulfillment/services` should let operators author/edit services, upload payload templates, and mark regional/channel availability. Surface inline docs sourced from `provider_endpoints.py` so operators align with backend expectations.
   - **Cost + margin telemetry**: Extend `product-pricing.ts` + `provider-service-insights.ts` to merge customer price, provider cost, FX conversion, and guardrail data. Show real-time warnings in `/admin/products` whenever configured margin < guardrail, and expose the same info via shared types for storefront previews.
   - **Assignment + rule builder**: Upgrade `ServiceRulesEditor` (and the new “Fulfillment blueprint” panel) so operators can map base products/add-ons to services with conditional logic (channel, geo, amount, cadence) and multi-step flows (initial + refill). Persist the mapping via FastAPI endpoints and mirror serialization in `apps/web/src/server/catalog/products.ts`.
   - **Bulk import/export**: Ship a CLI (`tooling/scripts/provider_service_import.py`) that ingests provider CSV/JSON catalogs, validates against the schema, and either calls the API or writes Alembic seeds. Provide export parity so ops can audit live services and share with providers.
   - **Provider funds & endpoints**: Let operators configure auth headers, balance endpoints, and response mappers per provider/service, then surface wallet health in the admin catalog. Store upstream provider order IDs on each `fulfillment_provider_orders` row so refill/cancel actions have the required context, and expose refill payload templates referencing those IDs.
   - **Verification & rollout**: Add FastAPI tests covering CRUD + rule evaluation, Jest tests for the editor UI, and integration tests ensuring order routing follows the configured rules. Document rollout toggles + dependency order inside `docs/admin-provider-services.md`, noting credential management and observability hooks.
5. **Media & validation roadmap**:
   - **Uploader validation**: Layer max size/dimension/mime enforcement into the drag-and-drop pipeline (client + FastAPI) using shared constants (`MAX_MEDIA_BYTES`, `ALLOWED_MEDIA_TYPES`). Record validation failures in telemetry so ops can monitor abuse attempts.
   - **Custom-field enforcement**: Ensure the expanded validation schema (Iteration 2) persists through API contracts, checkout server actions, and analytics exports. Add runtime guards that reject invalid submissions with actionable error codes surfaced in the storefront and logged server-side.
   - **Coverage & docs**: Extend unit/integration coverage for both uploader + custom-field flows, add load tests for multi-upload queues, and produce updated runbooks (`docs/runbooks/asset-uploader.md`, `docs/runbooks/custom-field-validation.md`) plus reflections summarizing risks and operator feedback.

## Current Next Actions (As of Provider Automation pull-up)

1. **Provider Order Replay & Scheduling**
   - ✅ `ProviderOrderReplayWorker` now runs in-process when `PROVIDER_REPLAY_WORKER_ENABLED=true`; remaining work is integrating with the broader job queue (Celery/BullMQ) for horizontal scaling.
   - ✅ `poetry run provider-replay ...` exposes queue-friendly commands for both scheduled batches and single-order replays, so ops can wire BullMQ/Celery jobs without importing FastAPI internals.
   - ✅ Native Celery tasks (`provider_automation.run_replay_batch` / `.evaluate_alerts`) wrap the replay + alert workers, providing queue names, env toggles, and beat-ready schedules documented in `docs/provider-automation-queue-integration.md`.
   - ✅ Admin UI now surfaces automation status cards with “Run now” controls that call the new API endpoints to execute replay/alert workers on-demand, alongside existing per-order replay/schedule forms.
   - ⏸️ Future: richer mock automation loops (stateful provider payload transforms, replay/refill deltas) are deferred; we will revisit only if production integration lacks the required signal, since the cost of increasingly complex mocks outweighs their test utility right now.

2. **Provider Rule Insights**
   - ✅ Telemetry helpers now aggregate replay outcomes and guardrail posture per provider service, with the provider catalog, order-level drill-down, and the `/admin/orders` analytics header all surfacing these aggregates so operators and leads see automation health in context; next milestone is piping the same data into dedicated analytics dashboards and runbooks.
   - ✅ Replay + scheduled entries now persist rule metadata (labels, conditions, overrides) alongside `ruleIds`, so ProviderOrderCard chips and automation snapshots can render human-readable guardrail context without reparsing payloads.
- ✅ `/api/v1/fulfillment/providers/automation/snapshot` now exposes the same telemetry bundle for internal clients/runbooks, and `/admin/orders` consumes this endpoint instead of fanning out per-provider requests.
- ✅ `ProviderAutomationAlertWorker` consumes the snapshot on a cadence and dispatches Slack/email alerts (configure via `PROVIDER_AUTOMATION_ALERT_*` env vars) whenever guardrail fails/warns or replay failures exceed thresholds, so ops has proactive signal without watching dashboards. `poetry run provider-alerts` mirrors the same run loop for cron/queue integrations.
- ✅ Cohort load alerts from `BlueprintMetricsService` (7/30/90d windows) now flow into the same worker + UI, emailing admins whenever a single provider carries >60% of a preset’s traffic in the 7-day window versus the 90-day baseline.
- ✅ Load alert digests now embed `/admin/merchandising`, `/admin/fulfillment/providers`, and `/admin/orders` deep links. AutomationStatusPanel, the Orders callout, and Provider Cohort analytics render matching CTA buttons, and Slack/email templates expose the same URLs so responders can jump straight into preset/provider runbooks.
- ✅ Admin automation analytics now pair guardrail incidents with recorded rule overrides per provider/service, and order detail surfaces inline warnings whenever margins fall below configured guardrails.
- ✅ Fulfillment tasks/workers now log the rule IDs + labels for every replay so audit trails capture which automation path ran.
- ✅ Automation dashboards now pull both the latest run status and a historical log (stored in Redis + surfaced via `/automation/status/history`) so ops can verify replay/alert cadence directly from `/admin/orders` and `/admin/fulfillment/providers`, with inline “Run now” controls that call the new API endpoints.
   - ✅ `provider_automation_runs` now persists every replay/alert batch (type, summary JSON, backlog totals, next scheduled ETA, alert digests), and `/automation/status` backfills its Redis payloads from this history so backlog + alert details remain visible even if workers or Redis recycle.

3. **Storefront Blueprint Enhancements**
   - Continue orchestrating provider-aware add-ons so selectors can preview margin impacts in real time (multi-currency, scheduled runs, rule conflicts).
   - ✅ Storefront `ProductConfigurator` now surfaces provider margin badges, FX-awareness, and channel conflict warnings for service override add-ons, so operators and customers see real-time margin telemetry, cost currencies, and rule coverage directly in the configurator UI.
   - ✅ FX conversions are configurable via `NEXT_PUBLIC_FX_RATES` (JSON rate table), refreshed through `pnpm fx:refresh` (hits `https://open.er-api.com` by default and rewrites `apps/web/src/data/fx-rates.json`; override via `FX_RATES_API_URL` / `FX_RATES_SYMBOLS` envs). The script also prints an updated `NEXT_PUBLIC_FX_RATES` snippet for env rotation.
   - ✅ The admin product preview now includes a channel selector powered by the same FX-aware margin helper, guaranteeing parity between operator telemetry and the storefront experience.

4. **Automation Infrastructure**
   - Stand up queue/cron definitions for provider order retries, balance refreshes, and cadence monitoring, reusing the new replay metadata.
   - **Queue wiring:** Define BullMQ queues (`provider:replay`, `provider:balance`, `provider:cadence`) and Celery equivalents with explicit `CONCURRENCY` + `RETRY_LIMIT` env vars. Each worker should call into `ProviderAutomationService` helpers so admin-triggered and scheduled runs share code.
   - **Cron + env contracts:** Document recommended schedules (.github Actions, systemd timers, Celery beat) and required env (`PROVIDER_BALANCE_WORKER_ENABLED`, `PROVIDER_AUTOMATION_QUEUE_URL`, `REDIS_AUTOMATION_NAMESPACE`). Provide sample manifests referencing the new CLI entry points (`poetry run provider-replay --queue`, `poetry run provider-balance --queue`).
   - **Runbooks & monitors:** Update `docs/provider-automation-queue-integration.md` with queue diagrams, failure handling, alert hooks, and dashboard links (Grafana/Datadog). Ensure `/automation/status` exposes queue depth + next-run ETA so ops can verify wiring without shell access.
   - **Verification:** Add pytest coverage for Celery task wrappers + balance/replay scheduling, and wire smoke tests that push synthetic jobs through BullMQ in CI to guard against contract drift.
   - ✅ Provider automation run exports now run hourly via `.github/workflows/provider-automation-export.yml`, which pulls from `/automation/status/history`, parameterizes `SMPLAT_API_BASE_URL` / `SMPLAT_AUTOMATION_EXPORT_DIR` per environment, sources bearer tokens from the `SMPLAT_AUTOMATION_API_TOKEN` secret, and uploads artifacts for BI ingest.
   - ✅ Environment propagation: Helm overlays under `infra/helm/values-staging.yaml` and `infra/helm/values-production.yaml` now mirror the `PROVIDER_LOAD_ALERT_*` defaults (and keep `PROVIDER_AUTOMATION_ALERT_WORKER_ENABLED=true`) so staging/prod secrets stay aligned with `.env.example`.

This document should evolve alongside implementation; update after each iteration to reflect scope changes, decisions, and lessons learned.

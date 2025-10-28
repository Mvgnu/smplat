# Checkout trust content model

This document captures the Payload CMS schema for checkout trust experiences and how those fields connect to live metrics.

## Collection overview

- **Slug:** `checkout-trust-experiences`
- **Environment support:** every document includes the shared `environment` select so draft experiences can be scoped to development, test, or production.
- **Draft preview:** operator preview routes (see `/trust-preview/[id]`) render both CMS draft copy and live metric overlays.

## Fields

| Field | Description |
| --- | --- |
| `name` | Internal label for operators. |
| `slug` | Unique identifier (e.g. `checkout`). |
| `guaranteeHeadline` / `guaranteeDescription` | Primary trust copy that anchors the assurance list. |
| `assurancePoints[]` | Array of cards shown in checkout and preview. Each entry supports: `id`, `title`, `description`, `evidence`, and `metric`. |
| `supportChannels[]` | Concierge touch points with `channel`, `label`, `target`, and optional `availability`. |
| `performanceSnapshots[]` | Numerical highlights rendered alongside the order summary. Each entry supports a `fallbackValue` and `metric` binding. |
| `testimonials[]` | Social proof snippets with optional `segment` tags for future personalization. |
| `bundleOffers[]` | Hard-coded bundles that will later be replaced by the recommendation service. |

### Metric group

Both assurance points and performance snapshots include a `metric` group with the following fields:

- `metricId` – canonical metric identifier (e.g. `fulfillment_sla_on_time_pct`, `fulfillment_backlog_minutes`, `fulfillment_staffing_coverage_pct`, `fulfillment_delivery_sla_forecast`).
- `metricSource` – provenance string used for the tooltip badge (`fulfillment`, `operator_staffing`, or `support_analytics`).
- `freshnessWindowMinutes` – maximum tolerated staleness before the UI downgrades the module to `stale`.
- `previewState` – operator override for preview displays (`fresh`, `stale`, or `missing`).
- `provenanceNote` – free-form context surfaced in checkout tooltips and preview panels.
- `fallbackValue` – (performance snapshots only) text rendered when no live metric is available.
- `metadata` – populated at runtime with diagnostic payloads (e.g. backlog minutes, staffing lookback counts) for UI copy or tooltips.

### Delivery confidence metrics

- `fulfillment_backlog_minutes` aggregates overdue minutes for active tasks, exposing `total_backlog_minutes`, `average_backlog_minutes`, and task counts so operators can message queue depth accurately.
- `fulfillment_staffing_coverage_pct` compares completed versus scheduled work across the last 24 hours. Metadata includes `scheduled_tasks`, `completed_tasks`, and `lookback_hours` to back up staffing copy.
- `fulfillment_delivery_sla_forecast` blends live backlog counts with historical task durations and the `fulfillment_staffing_shifts` roster to forecast SLA clearance windows. Metadata includes `overall_percentile_bands`, per-SKU breakdowns, and an optional `forecast` payload with staffing windows for storefront messaging.
- Both metrics inherit the trust cache contract, meaning provenance includes cache layer, refreshed/expiry timestamps, TTL diagnostics, percentile bands, and unsupported guardrails for preview tooling.

## Live metric binding

1. The storefront requests `/api/v1/trust/experiences` with metric IDs and desired freshness windows.
2. FastAPI resolves those IDs through `FulfillmentMetricsService`, returning verification metadata (`verification_state`, `computed_at`, `formatted_value`, `sample_size`, `source`).
3. `apps/web/src/server/cms/trust.ts` merges the CMS payload with fallback values, applies metric resolutions, and exposes enriched data via `getCheckoutTrustExperience()`.
4. Checkout renders badges with tooltips summarising provenance, freshness, and sample size while respecting fallback values when metrics are missing or stale.

## Preview workflow

- Operators can open `/trust-preview/checkout?token=<CHECKOUT_PREVIEW_TOKEN>` to compare draft content with live overlays.
- The preview route uses `getCheckoutTrustExperienceDraft(slug)` for CMS data (without resolving live metrics) and `getCheckoutTrustExperience()` for the live snapshot.
- Preview badges mirror verification states, highlighting stale or missing metrics so operators can adjust copy or investigate underlying data quality.

Keep this document current whenever the trust schema evolves or new metric identifiers are introduced.
